const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');

const {
  canCreateDocuments,
  canUpdateDocuments,
  consumeDocumentUpdates,
} = require('../store');
const { requireAuth } = require('../middleware/auth/core');
const { requirePermission, resolveTenantContext } = require('../middleware/rbac');
const { attachEntitlements } = require('../middleware/entitlements');
const { bytes } = require('../middleware/docs');
const { isWorkspaceVisibleToUser } = require('../middleware/workspaces');
const { writeAuditLog } = require('../lib/audit');

const router = express.Router();

const MAX_TITLE_LENGTH = 255;
const PREVIEW_LENGTH = 100;
// Raw HTML spends most of its first characters on tags and inline styles, so the list
// query reads this many characters of content to build a 100-character text preview.
const PREVIEW_SOURCE_LENGTH = 4000;
// Guards the recursive subtree query; real trees are far shallower.
const MAX_TREE_DEPTH = 100;

const HTML_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** An error with an HTTP status, thrown inside tree operations and turned into a response. */
class DocRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function decodeHtmlEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function buildPreview(content) {
  // The list query reads a content prefix, which can end inside a long tag (table tokens
  // carry kilobytes of attribute data); drop that unterminated tag before stripping tags.
  const text = String(content || '').replace(/<[^>]*$/, '').replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(text).replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LENGTH);
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function formatDocSummary(doc, previewSource = doc.content) {
  return {
    id: doc.id,
    title: doc.title,
    userId: doc.userId,
    tenantId: doc.tenantId,
    workspaceId: doc.workspaceId ?? null,
    parentId: doc.parentId ?? null,
    sortOrder: Number(doc.sortOrder ?? 0),
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
    preview: buildPreview(previewSource),
  };
}

function formatDoc(doc) {
  return { ...formatDocSummary(doc), content: doc.content };
}

function sendDocRequestError(res, err) {
  if (err instanceof DocRequestError) {
    return res.status(err.status).json({ error: err.message });
  }
  throw err;
}

/**
 * Validates a create (partial = false) or update (partial = true) body.
 * Returns { error } or { value } holding only the fields that were provided.
 */
function validateDocInput(body, { partial }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be a JSON object.' };
  }

  const value = {};

  if (body.title !== undefined) {
    if (typeof body.title !== 'string') return { error: 'title must be a string.' };
    const title = body.title.trim();
    if (!title) return { error: 'title cannot be empty.' };
    if (title.length > MAX_TITLE_LENGTH) {
      return { error: `title must be at most ${MAX_TITLE_LENGTH} characters.` };
    }
    value.title = title;
  } else if (!partial) {
    value.title = 'Untitled';
  }

  if (body.content !== undefined) {
    if (typeof body.content !== 'string') return { error: 'content must be a string.' };
    value.content = body.content;
  } else if (!partial) {
    value.content = '';
  }

  if (body.workspaceId !== undefined) {
    if (body.workspaceId !== null && typeof body.workspaceId !== 'string') {
      return { error: 'workspaceId must be a string or null.' };
    }
    value.workspaceId = body.workspaceId;
  }

  // Only creates take a parent; updates change the tree through POST /:id/move.
  if (!partial && body.parentId !== undefined) {
    if (body.parentId !== null && typeof body.parentId !== 'string') {
      return { error: 'parentId must be a string or null.' };
    }
    value.parentId = body.parentId;
  }

  return { value };
}

function validateMoveInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be a JSON object.' };
  }
  if (body.parentId === undefined || (body.parentId !== null && typeof body.parentId !== 'string')) {
    return { error: 'parentId must be a string or null.' };
  }
  if (!Number.isInteger(body.index) || body.index < 0) {
    return { error: 'index must be a non-negative integer.' };
  }
  if (body.workspaceId !== undefined && body.workspaceId !== null && typeof body.workspaceId !== 'string') {
    return { error: 'workspaceId must be a string or null.' };
  }
  return { value: { parentId: body.parentId, index: body.index, workspaceId: body.workspaceId } };
}

async function getDocForTenantDb(docId, tenantId, db = prisma) {
  return db.document.findFirst({ where: { id: docId, tenantId } });
}

/**
 * Resolves a workspaceId from the request body. Documents may live in a workspace of the
 * current tenant or in the user's personal workspace (tenantId === userId), and the user
 * must be able to see it under the same rule the workspace list uses.
 */
async function resolveWorkspaceForTenant(workspaceId, tenantId, userId) {
  if (workspaceId === undefined) {
    return { ok: true, workspaceId: undefined };
  }
  if (workspaceId === null) {
    return { ok: true, workspaceId: null };
  }

  const normalizedWorkspaceId = workspaceId.trim();
  if (!normalizedWorkspaceId) {
    return { ok: false, error: 'Invalid workspaceId.' };
  }

  const workspace = await prisma.workspace.findFirst({
    where: {
      id: normalizedWorkspaceId,
      OR: [{ tenantId }, { tenantId: userId }],
    },
    select: { id: true, tenantId: true, ownerId: true, memberIds: true },
  });

  if (!workspace || !isWorkspaceVisibleToUser(workspace, userId)) {
    return { ok: false, error: 'Workspace not found for tenant.' };
  }

  return { ok: true, workspaceId: workspace.id };
}

/** Ids of a document and all of its descendants. */
async function getSubtreeIds(db, rootId, tenantId) {
  const rows = await db.$queryRaw`
    WITH RECURSIVE subtree AS (
      SELECT id, 0 AS depth FROM documents WHERE id = ${rootId} AND "tenantId" = ${tenantId}
      UNION ALL
      SELECT d.id, s.depth + 1 FROM documents d
      JOIN subtree s ON d."parentId" = s.id
      WHERE d."tenantId" = ${tenantId} AND s.depth < ${MAX_TREE_DEPTH}::int
    )
    SELECT id FROM subtree
  `;
  return rows.map((row) => row.id);
}

/**
 * Loads a parent for a document that is created or moved under it. The parent must be in
 * the same tenant, and its workspace is the child's workspace: when the caller names a
 * workspace too, the two must agree.
 */
async function resolveParent(db, { parentId, tenantId, workspaceId }) {
  const parent = await db.document.findFirst({
    where: { id: parentId, tenantId },
    select: { id: true, workspaceId: true },
  });
  if (!parent) throw new DocRequestError(400, 'Invalid parentId.');
  const parentWorkspaceId = parent.workspaceId ?? null;
  if (workspaceId !== undefined && workspaceId !== parentWorkspaceId) {
    throw new DocRequestError(400, 'parentId must be in the target workspace.');
  }
  return { workspaceId: parentWorkspaceId };
}

/** The sortOrder that places a new document above all of its siblings. */
async function topSortOrder(db, group) {
  const { _min: min } = await db.document.aggregate({
    where: group,
    _min: { sortOrder: true },
  });
  return min.sortOrder === null || min.sortOrder === undefined ? 0 : min.sortOrder - 1;
}

async function listSiblings(db, group, excludeId) {
  return db.document.findMany({
    where: { ...group, id: { not: excludeId } },
    select: { id: true, sortOrder: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
  });
}

function isSameGroup(a, b) {
  return a.workspaceId === b.workspaceId && a.parentId === b.parentId;
}

/** Locks the sibling rows of both groups, in id order, so concurrent moves serialize. */
async function lockSiblingGroups(db, tenantId, a, b) {
  await db.$queryRaw`
    SELECT id FROM documents
    WHERE "tenantId" = ${tenantId}
      AND (
        ("workspaceId" IS NOT DISTINCT FROM ${a.workspaceId}::text AND "parentId" IS NOT DISTINCT FROM ${a.parentId}::text)
        OR ("workspaceId" IS NOT DISTINCT FROM ${b.workspaceId}::text AND "parentId" IS NOT DISTINCT FROM ${b.parentId}::text)
      )
    ORDER BY id
    FOR UPDATE
  `;
}

/** Numbers siblings 1..n in their current order and writes only the values that change. */
async function renumberSiblings(db, siblings) {
  const changed = siblings
    .map((sibling, i) => ({ id: sibling.id, sortOrder: i + 1, previous: sibling.sortOrder }))
    .filter((sibling) => sibling.sortOrder !== sibling.previous);
  if (!changed.length) return;
  // Raw SQL so tree changes do not touch updatedAt (Prisma's @updatedAt would).
  await db.$executeRaw`
    UPDATE documents AS d
    SET "sortOrder" = v.ord
    FROM unnest(${changed.map((s) => s.id)}::text[], ${changed.map((s) => s.sortOrder)}::int[]) AS v(id, ord)
    WHERE d.id = v.id
  `;
}

/**
 * Moves a document (with its whole subtree) under `parentId` in `workspaceId`, at
 * position `index` among its new siblings, and renumbers both sibling groups.
 * Must run inside a transaction; never changes updatedAt.
 */
async function moveDocument(db, { doc, tenantId, workspaceId, parentId, index }) {
  let targetWorkspaceId = workspaceId === undefined ? (doc.workspaceId ?? null) : workspaceId;
  if (parentId !== null) {
    ({ workspaceId: targetWorkspaceId } = await resolveParent(db, { parentId, tenantId, workspaceId }));
  }

  const subtreeIds = await getSubtreeIds(db, doc.id, tenantId);
  if (parentId !== null && subtreeIds.includes(parentId)) {
    throw new DocRequestError(400, 'Cannot move a document inside itself.');
  }

  const source = { tenantId, workspaceId: doc.workspaceId ?? null, parentId: doc.parentId ?? null };
  const target = { tenantId, workspaceId: targetWorkspaceId, parentId };
  await lockSiblingGroups(db, tenantId, source, target);

  const destination = await listSiblings(db, target, doc.id);
  const position = Math.min(index, destination.length);
  destination.splice(position, 0, { id: doc.id, sortOrder: null });
  await renumberSiblings(db, destination);
  if (!isSameGroup(source, target)) {
    await renumberSiblings(db, await listSiblings(db, source, doc.id));
  }

  await db.$executeRaw`
    UPDATE documents SET "parentId" = ${parentId}::text WHERE id = ${doc.id}
  `;
  if (targetWorkspaceId !== source.workspaceId) {
    // Children always live in their parent's workspace, so the whole subtree moves.
    await db.$executeRaw`
      UPDATE documents SET "workspaceId" = ${targetWorkspaceId}::text WHERE id = ANY(${subtreeIds}::text[])
    `;
  }

  return getDocForTenantDb(doc.id, tenantId, db);
}

async function calculateTenantStorageBytesDb(tenantId) {
  try {
    const rows = await prisma.$queryRaw`
      SELECT COALESCE(SUM(OCTET_LENGTH(content)), 0)::bigint AS total
      FROM documents
      WHERE "tenantId" = ${tenantId}
    `;
    const total = Array.isArray(rows) && rows[0] ? rows[0].total : 0;
    if (typeof total === 'bigint') return Number(total);
    return Number(total || 0);
  } catch {
    // Fallback for environments where SQL aggregation support varies.
    const docs = await prisma.document.findMany({
      where: { tenantId },
      select: { content: true },
    });
    return docs.reduce((total, doc) => total + bytes(doc.content), 0);
  }
}

/**
 * Returns a 402 payload when replacing `previousBytes` with `nextBytes` would exceed the
 * tenant's storage limit, or null when it fits. A null limit means unlimited storage.
 */
async function checkStorageQuota(tenantId, limits, nextBytes, previousBytes = 0) {
  const limitBytes = limits?.storageBytes;
  if (limitBytes === null || limitBytes === undefined) return null;
  if (nextBytes <= previousBytes) return null;

  const currentStorage = await calculateTenantStorageBytesDb(tenantId);
  const projectedStorage = currentStorage - previousBytes + nextBytes;
  if (projectedStorage <= limitBytes) return null;
  return {
    error: `Storage limit exceeded (${projectedStorage}/${limitBytes} bytes).`,
    code: 'storage_quota_exceeded',
  };
}

/**
 * POST /api/docs
 * Create a new document at the top of its sibling list.
 * Body: { title?, content?, workspaceId?, parentId? }
 * A child takes its parent's workspace.
 */
router.post('/', requireAuth, resolveTenantContext, requirePermission('document.create'), attachEntitlements, async (req, res) => {
  const input = validateDocInput(req.body, { partial: false });
  if (input.error) return res.status(400).json({ error: input.error });
  const { title, content } = input.value;
  const parentId = input.value.parentId ?? null;

  const workspaceResolution = await resolveWorkspaceForTenant(
    parentId ? input.value.workspaceId : (input.value.workspaceId ?? null),
    req.tenant.id,
    req.user.id,
  );
  if (!workspaceResolution.ok) {
    return res.status(400).json({ error: workspaceResolution.error });
  }

  let workspaceId = workspaceResolution.workspaceId;
  try {
    if (parentId) {
      ({ workspaceId } = await resolveParent(prisma, { parentId, tenantId: req.tenant.id, workspaceId }));
    }
  } catch (err) {
    return sendDocRequestError(res, err);
  }

  const createCheck = await canCreateDocuments(req.tenant.id, 1);
  if (!createCheck.allowed) {
    return res.status(402).json({
      error: createCheck.reason,
      code: 'document_limit_exceeded',
    });
  }

  const storageError = await checkStorageQuota(req.tenant.id, req.entitlements.limits, bytes(content));
  if (storageError) return res.status(402).json(storageError);

  const sortOrder = await topSortOrder(prisma, { tenantId: req.tenant.id, workspaceId, parentId });
  const created = await prisma.document.create({
    data: {
      id: uuidv4(),
      title,
      content,
      userId: req.user.id,
      tenantId: req.tenant.id,
      workspaceId,
      parentId,
      sortOrder,
    },
  });
  const doc = formatDoc(created);

  writeAuditLog({
    userId: req.user.id,
    tenantId: req.tenant.id,
    action: 'document.create',
    metadata: { docId: doc.id, title: doc.title, parentId },
  });
  res.status(201).json({ doc });
});

/**
 * GET /api/docs
 * List all documents in the current tenant, most recently updated first. Each carries
 * parentId and sortOrder so clients can build the chapter tree.
 * Only a content prefix is read from the database to build each preview.
 */
router.get('/', requireAuth, resolveTenantContext, requirePermission('document.read'), async (req, res) => {
  const rows = await prisma.$queryRaw`
    SELECT id, title, "userId", "tenantId", "workspaceId", "parentId", "sortOrder", "createdAt", "updatedAt",
      LEFT(content, ${PREVIEW_SOURCE_LENGTH}::int) AS "previewSource"
    FROM documents
    WHERE "tenantId" = ${req.tenant.id}
    ORDER BY "updatedAt" DESC
  `;
  const docs = rows.map((row) => formatDocSummary(row, row.previewSource));

  writeAuditLog({
    userId: req.user.id,
    tenantId: req.tenant.id,
    action: 'document.list',
    metadata: { count: docs.length },
  });
  res.json({ docs });
});

/**
 * GET /api/docs/:id
 * Fetch a single document.
 */
router.get('/:id', requireAuth, resolveTenantContext, requirePermission('document.read'), async (req, res) => {
  const row = await getDocForTenantDb(req.params.id, req.tenant.id);
  if (!row) return res.status(404).json({ error: 'Document not found.' });
  const doc = formatDoc(row);
  writeAuditLog({
    userId: req.user.id,
    tenantId: req.tenant.id,
    action: 'document.read',
    metadata: { docId: doc.id },
  });
  res.json({ doc });
});

/**
 * POST /api/docs/:id/move
 * Move a document, with its subtree, under a new parent and/or into another workspace,
 * at a position among its new siblings.
 * Body: { parentId: string | null, index: number, workspaceId? }
 * Does not count toward the monthly document update quota or change updatedAt.
 */
router.post('/:id/move', requireAuth, resolveTenantContext, requirePermission('document.update'), attachEntitlements, async (req, res) => {
  const input = validateMoveInput(req.body);
  if (input.error) return res.status(400).json({ error: input.error });

  const workspaceResolution = await resolveWorkspaceForTenant(input.value.workspaceId, req.tenant.id, req.user.id);
  if (!workspaceResolution.ok) {
    return res.status(400).json({ error: workspaceResolution.error });
  }

  let moved;
  try {
    moved = await prisma.$transaction(async (tx) => {
      const doc = await getDocForTenantDb(req.params.id, req.tenant.id, tx);
      if (!doc) throw new DocRequestError(404, 'Document not found.');
      return moveDocument(tx, {
        doc,
        tenantId: req.tenant.id,
        workspaceId: workspaceResolution.workspaceId,
        parentId: input.value.parentId,
        index: input.value.index,
      });
    });
  } catch (err) {
    return sendDocRequestError(res, err);
  }

  const doc = formatDoc(moved);
  writeAuditLog({
    userId: req.user.id,
    tenantId: req.tenant.id,
    action: 'document.move',
    metadata: { docId: doc.id, parentId: doc.parentId, workspaceId: doc.workspaceId, sortOrder: doc.sortOrder },
  });
  res.json({ doc });
});

/**
 * PUT /api/docs/:id
 * Update title, content and/or workspace.
 * Body: { title?, content?, workspaceId? }
 * Changing the workspace moves the document and its subtree to the top level of that
 * workspace. Only title/content changes count toward the monthly document update quota;
 * a request that changes nothing returns the current document without touching it.
 */
router.put('/:id', requireAuth, resolveTenantContext, requirePermission('document.update'), attachEntitlements, async (req, res) => {
  const input = validateDocInput(req.body, { partial: true });
  if (input.error) return res.status(400).json({ error: input.error });

  const existing = await getDocForTenantDb(req.params.id, req.tenant.id);
  if (!existing) return res.status(404).json({ error: 'Document not found.' });

  const workspaceResolution = await resolveWorkspaceForTenant(
    input.value.workspaceId,
    req.tenant.id,
    req.user.id,
  );
  if (!workspaceResolution.ok) {
    return res.status(400).json({ error: workspaceResolution.error });
  }

  const changes = {};
  if (input.value.title !== undefined && input.value.title !== existing.title) {
    changes.title = input.value.title;
  }
  if (input.value.content !== undefined && input.value.content !== existing.content) {
    changes.content = input.value.content;
  }
  const movesWorkspace = workspaceResolution.workspaceId !== undefined
    && workspaceResolution.workspaceId !== (existing.workspaceId ?? null);

  if (Object.keys(changes).length === 0 && !movesWorkspace) {
    return res.json({ doc: formatDoc(existing) });
  }

  const countsAsEdit = Object.keys(changes).length > 0;
  if (countsAsEdit) {
    const updateCheck = await canUpdateDocuments(req.tenant.id, 1);
    if (!updateCheck.allowed) {
      return res.status(402).json({
        error: updateCheck.reason,
        code: 'document_update_limit_exceeded',
      });
    }
  }

  if (changes.content !== undefined) {
    const storageError = await checkStorageQuota(
      req.tenant.id,
      req.entitlements.limits,
      bytes(changes.content),
      bytes(existing.content),
    );
    if (storageError) return res.status(402).json(storageError);
  }

  let updated = existing;
  if (movesWorkspace) {
    updated = await prisma.$transaction((tx) => moveDocument(tx, {
      doc: existing,
      tenantId: req.tenant.id,
      workspaceId: workspaceResolution.workspaceId,
      parentId: null,
      index: 0,
    }));
  }
  if (countsAsEdit) {
    updated = await prisma.document.update({
      where: { id: existing.id },
      data: changes,
    });
    await consumeDocumentUpdates(req.tenant.id, 1);
  }

  const doc = formatDoc(updated);
  writeAuditLog({
    userId: req.user.id,
    tenantId: req.tenant.id,
    action: 'document.update',
    metadata: { docId: doc.id, fields: [...Object.keys(changes), ...(movesWorkspace ? ['workspaceId'] : [])] },
  });
  res.json({ doc });
});

/**
 * DELETE /api/docs/:id
 * Delete a document and its whole subtree, together with their comments and versions.
 */
router.delete('/:id', requireAuth, resolveTenantContext, requirePermission('document.delete'), attachEntitlements, async (req, res) => {
  const row = await getDocForTenantDb(req.params.id, req.tenant.id);
  if (!row) return res.status(404).json({ error: 'Document not found.' });

  const deletedCount = await prisma.$transaction(async (tx) => {
    const ids = await getSubtreeIds(tx, row.id, req.tenant.id);
    await tx.comment.deleteMany({ where: { docId: { in: ids } } });
    await tx.version.deleteMany({ where: { docId: { in: ids } } });
    // One statement for the whole subtree, so the parentId foreign key never sees a
    // child whose parent is already gone.
    const { count } = await tx.document.deleteMany({ where: { id: { in: ids }, tenantId: req.tenant.id } });
    return count;
  });

  writeAuditLog({
    userId: req.user.id,
    tenantId: req.tenant.id,
    action: 'document.delete',
    metadata: { docId: row.id, deletedCount },
  });
  res.json({ message: 'Document deleted.', deletedCount });
});

module.exports = router;
