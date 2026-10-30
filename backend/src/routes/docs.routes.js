const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');

const {
  canCreateDocuments,
  canUpdateDocuments,
  consumeDocumentUpdates,
  getTenantEntitlements,
} = require('../store');
const { requireAuth } = require('../middleware/auth/core');
const { requirePermission, resolveTenantContext } = require('../middleware/rbac');
const { attachEntitlements } = require('../middleware/entitlements');
const { bytes } = require('../middleware/docs');
const { writeAuditLog } = require('../lib/audit');

const router = express.Router();

// Guards the recursive subtree query; real trees are far shallower.
const MAX_TREE_DEPTH = 100;

/** An error with an HTTP status, thrown inside tree operations and turned into a response. */
class DocRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function formatDoc(doc) {
  return {
    id: doc.id,
    title: doc.title,
    content: doc.content,
    userId: doc.userId,
    tenantId: doc.tenantId,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
    parentId: doc.parentId ?? null,
    workspaceId: doc.workspaceId ?? null,
    sortOrder: doc.sortOrder ?? 0,
    preview: String(doc.content || '').replace(/<[^>]+>/g, '').slice(0, 100),
  };
}

function sendDocRequestError(res, err) {
  if (err instanceof DocRequestError) {
    return res.status(err.status).json({ error: err.message });
  }
  throw err;
}

async function getDocForTenantDb(docId, tenantId, db = prisma) {
  return db.document.findFirst({ where: { id: docId, tenantId } });
}

function hasWorkspaceAccess(workspace, userId) {
  if (!workspace) return false;
  if (workspace.ownerId === userId) return true;
  if (Array.isArray(workspace.memberIds) && workspace.memberIds.includes(userId)) return true;
  return false;
}

async function resolveWorkspaceForTenant(workspaceId, tenantId, userId) {
  if (workspaceId === undefined) {
    return { ok: true, workspaceId: undefined };
  }
  if (workspaceId === null) {
    return { ok: true, workspaceId: null };
  }

  const normalizedWorkspaceId = String(workspaceId || '').trim();
  if (!normalizedWorkspaceId) {
    return { ok: false, error: 'Invalid workspaceId.' };
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: normalizedWorkspaceId },
    select: { id: true, tenantId: true, ownerId: true, memberIds: true },
  });

  const inAllowedScope = workspace
    && (workspace.tenantId === tenantId || workspace.tenantId === userId);

  if (!workspace || !inAllowedScope || !hasWorkspaceAccess(workspace, userId)) {
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
 * POST /api/docs
 * Create a new document at the top of its sibling list.
 * Body: { title?, content?, workspaceId?, parentId? }
 * A child takes its parent's workspace.
 */
router.post('/', requireAuth, resolveTenantContext, requirePermission('document.create'), attachEntitlements, async (req, res) => {
  const { title = 'Untitled', content = '' } = req.body;
  const parentId = req.body.parentId ?? null;
  if (parentId !== null && typeof parentId !== 'string') {
    return res.status(400).json({ error: 'parentId must be a string or null.' });
  }
  const workspaceResolution = await resolveWorkspaceForTenant(
    parentId ? req.body.workspaceId : (req.body.workspaceId ?? null),
    req.tenant.id,
    req.user.id,
  );
  if (!workspaceResolution.ok) {
    return res.status(400).json({ error: workspaceResolution.error });
  }

  let { workspaceId } = workspaceResolution;
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

  const entitlements = req.entitlements;
  if (!entitlements) return res.status(404).json({ error: 'Tenant entitlements unavailable.' });

  const currentStorage = await calculateTenantStorageBytesDb(req.tenant.id);
  const incomingBytes = bytes(content);
  const limitBytes = entitlements.limits.storageBytes;
  if (currentStorage + incomingBytes > limitBytes) {
    return res.status(402).json({
      error: `Storage limit exceeded (${currentStorage}/${limitBytes} bytes used).`,
      code: 'storage_quota_exceeded',
    });
  }

  const id = uuidv4();
  const sortOrder = await topSortOrder(prisma, { tenantId: req.tenant.id, workspaceId, parentId });
  const created = await prisma.document.create({
    data: {
      id,
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
 * List all documents belonging to the current user.
 */
router.get('/', requireAuth, resolveTenantContext, requirePermission('document.read'), async (req, res) => {

  const rows = await prisma.document.findMany({
    where: { tenantId: req.tenant.id },
    orderBy: { updatedAt: 'desc' },
  });
  const docs = rows.map((doc) => ({
    id: doc.id,
    title: doc.title,
    userId: doc.userId,
    tenantId: doc.tenantId,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
    parentId: doc.parentId ?? null,
    workspaceId: doc.workspaceId ?? null,
    sortOrder: doc.sortOrder ?? 0,
    preview: String(doc.content || '').replace(/<[^>]+>/g, '').slice(0, 100),
  }));

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
 * Changing the workspace moves the document and its subtree to the top level of that workspace.
 */
router.put('/:id', requireAuth, resolveTenantContext, requirePermission('document.update'), attachEntitlements, async (req, res) => {
  const existing = await getDocForTenantDb(req.params.id, req.tenant.id);
  if (!existing) return res.status(404).json({ error: 'Document not found.' });

  const workspaceResolution = await resolveWorkspaceForTenant(
    req.body.workspaceId,
    req.tenant.id,
    req.user.id,
  );
  if (!workspaceResolution.ok) {
    return res.status(400).json({ error: workspaceResolution.error });
  }

  const updateCheck = await canUpdateDocuments(req.tenant.id, 1);
  if (!updateCheck.allowed) {
    return res.status(402).json({
      error: updateCheck.reason,
      code: 'document_update_limit_exceeded',
    });
  }

  if (req.body.content !== undefined) {
    const entitlements = await getTenantEntitlements(req.tenant.id);
    if (!entitlements) return res.status(404).json({ error: 'Tenant entitlements unavailable.' });

    const currentStorage = await calculateTenantStorageBytesDb(req.tenant.id);
    const nextBytes = bytes(req.body.content);
    const previousBytes = bytes(existing.content);
    const projectedStorage = currentStorage - previousBytes + nextBytes;
    if (projectedStorage > entitlements.limits.storageBytes) {
      return res.status(402).json({
        error: `Storage limit exceeded (${projectedStorage}/${entitlements.limits.storageBytes} bytes).`,
        code: 'storage_quota_exceeded',
      });
    }
  }

  if (workspaceResolution.workspaceId !== undefined
    && workspaceResolution.workspaceId !== (existing.workspaceId ?? null)) {
    // Children always live in their parent's workspace, so the whole subtree moves,
    // to the top level of the target workspace.
    await prisma.$transaction((tx) => moveDocument(tx, {
      doc: existing,
      tenantId: req.tenant.id,
      workspaceId: workspaceResolution.workspaceId,
      parentId: null,
      index: 0,
    }));
  }

  const updated = await prisma.document.update({
    where: { id: existing.id },
    data: {
      ...(req.body.title !== undefined ? { title: req.body.title } : {}),
      ...(req.body.content !== undefined ? { content: req.body.content } : {}),
    },
  });
  await consumeDocumentUpdates(req.tenant.id, 1);
  const doc = formatDoc(updated);
  writeAuditLog({
    userId: req.user.id,
    tenantId: req.tenant.id,
    action: 'document.update',
    metadata: { docId: doc.id },
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
