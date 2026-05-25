const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');

const {
  canCreateDocuments,
  canUpdateDocuments,
  consumeDocumentUpdates,
  getOrganizationEntitlements,
} = require('../store');
const { requireAuth } = require('../middleware/auth/core');
const { requirePermission, resolveOrganizationContext } = require('../middleware/rbac');
const { attachEntitlements } = require('../middleware/entitlements');
const { bytes } = require('../middleware/docs');
const { writeAuditLog } = require('../lib/audit');

const router = express.Router();

function formatDoc(doc) {
  return {
    id: doc.id,
    title: doc.title,
    content: doc.content,
    userId: doc.userId,
    organizationId: doc.organizationId,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
    parentId: null,
    workspaceId: doc.workspaceId ?? null,
    sortOrder: 0,
    preview: String(doc.content || '').replace(/<[^>]+>/g, '').slice(0, 100),
  };
}

async function getDocForOrgDb(docId, organizationId) {
  return prisma.document.findFirst({ where: { id: docId, organizationId } });
}

function hasWorkspaceAccess(workspace, userId) {
  if (!workspace) return false;
  if (workspace.ownerId === userId) return true;
  if (Array.isArray(workspace.memberIds) && workspace.memberIds.includes(userId)) return true;
  return false;
}

async function resolveWorkspaceForOrganization(workspaceId, organizationId, userId) {
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
    select: { id: true, organizationId: true, ownerId: true, memberIds: true },
  });

  const inAllowedScope = workspace
    && (workspace.organizationId === organizationId || workspace.organizationId === userId);

  if (!workspace || !inAllowedScope || !hasWorkspaceAccess(workspace, userId)) {
    return { ok: false, error: 'Workspace not found for organization.' };
  }

  return { ok: true, workspaceId: workspace.id };
}

async function calculateOrganizationStorageBytesDb(organizationId) {
  const docs = await prisma.document.findMany({
    where: { organizationId },
    select: { content: true },
  });
  return docs.reduce((total, doc) => total + bytes(doc.content), 0);
}

/**
 * POST /api/docs
 * Create a new document.
 * Body: { title?, content? }
 */
router.post('/', requireAuth, resolveOrganizationContext, requirePermission('document.create'), attachEntitlements, async (req, res) => {
  const { title = 'Untitled', content = '' } = req.body;
  const workspaceResolution = await resolveWorkspaceForOrganization(
    req.body.workspaceId ?? null,
    req.organization.id,
    req.user.id,
  );
  if (!workspaceResolution.ok) {
    return res.status(400).json({ error: workspaceResolution.error });
  }

  const createCheck = await canCreateDocuments(req.organization.id, 1);
  if (!createCheck.allowed) {
    return res.status(402).json({
      error: createCheck.reason,
      code: 'document_limit_exceeded',
    });
  }

  const entitlements = await getOrganizationEntitlements(req.organization.id);
  if (!entitlements) return res.status(404).json({ error: 'Organization entitlements unavailable.' });

  const currentStorage = await calculateOrganizationStorageBytesDb(req.organization.id);
  const incomingBytes = bytes(content);
  const limitBytes = entitlements.limits.storageBytes;
  if (currentStorage + incomingBytes > limitBytes) {
    return res.status(402).json({
      error: `Storage limit exceeded (${currentStorage}/${limitBytes} bytes used).`,
      code: 'storage_quota_exceeded',
    });
  }

  const id = uuidv4();
  const created = await prisma.document.create({
    data: {
      id,
      title,
      content,
      userId: req.user.id,
      organizationId: req.organization.id,
      workspaceId: workspaceResolution.workspaceId,
    },
  });
  const doc = formatDoc(created);

  writeAuditLog({
    userId: req.user.id,
    organizationId: req.organization.id,
    action: 'document.create',
    metadata: { docId: doc.id, title: doc.title },
  });
  res.status(201).json({ doc });
});

/**
 * GET /api/docs
 * List all documents belonging to the current user.
 */
router.get('/', requireAuth, resolveOrganizationContext, requirePermission('document.read'), async (req, res) => {
  const rows = await prisma.document.findMany({
    where: { organizationId: req.organization.id },
    orderBy: { updatedAt: 'desc' },
  });
  const docs = rows.map((doc) => ({
    id: doc.id,
    title: doc.title,
    userId: doc.userId,
    organizationId: doc.organizationId,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
    parentId: null,
    workspaceId: doc.workspaceId ?? null,
    sortOrder: 0,
    preview: String(doc.content || '').replace(/<[^>]+>/g, '').slice(0, 100),
  }));
  writeAuditLog({
    userId: req.user.id,
    organizationId: req.organization.id,
    action: 'document.list',
    metadata: { count: docs.length },
  });
  res.json({ docs });
});

/**
 * GET /api/docs/:id
 * Fetch a single document.
 */
router.get('/:id', requireAuth, resolveOrganizationContext, requirePermission('document.read'), async (req, res) => {
  const row = await getDocForOrgDb(req.params.id, req.organization.id);
  if (!row) return res.status(404).json({ error: 'Document not found.' });
  const doc = formatDoc(row);
  writeAuditLog({
    userId: req.user.id,
    organizationId: req.organization.id,
    action: 'document.read',
    metadata: { docId: doc.id },
  });
  res.json({ doc });
});

/**
 * PUT /api/docs/:id
 * Update title and/or content.
 * Body: { title?, content? }
 */
router.put('/:id', requireAuth, resolveOrganizationContext, requirePermission('document.update'), attachEntitlements, async (req, res) => {
  const existing = await getDocForOrgDb(req.params.id, req.organization.id);
  if (!existing) return res.status(404).json({ error: 'Document not found.' });

  const workspaceResolution = await resolveWorkspaceForOrganization(
    req.body.workspaceId,
    req.organization.id,
    req.user.id,
  );
  if (!workspaceResolution.ok) {
    return res.status(400).json({ error: workspaceResolution.error });
  }

  const updateCheck = await canUpdateDocuments(req.organization.id, 1);
  if (!updateCheck.allowed) {
    return res.status(402).json({
      error: updateCheck.reason,
      code: 'document_update_limit_exceeded',
    });
  }

  if (req.body.content !== undefined) {
    const entitlements = await getOrganizationEntitlements(req.organization.id);
    if (!entitlements) return res.status(404).json({ error: 'Organization entitlements unavailable.' });

    const currentStorage = await calculateOrganizationStorageBytesDb(req.organization.id);
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

  const updated = await prisma.document.update({
    where: { id: existing.id },
    data: {
      ...(req.body.title !== undefined ? { title: req.body.title } : {}),
      ...(req.body.content !== undefined ? { content: req.body.content } : {}),
      ...(workspaceResolution.workspaceId !== undefined ? { workspaceId: workspaceResolution.workspaceId } : {}),
    },
  });
  await consumeDocumentUpdates(req.organization.id, 1);
  const doc = formatDoc(updated);
  writeAuditLog({
    userId: req.user.id,
    organizationId: req.organization.id,
    action: 'document.update',
    metadata: { docId: doc.id },
  });
  res.json({ doc });
});

/**
 * DELETE /api/docs/:id
 * Delete a document.
 */
router.delete('/:id', requireAuth, resolveOrganizationContext, requirePermission('document.delete'), attachEntitlements, async (req, res) => {
  const row = await getDocForOrgDb(req.params.id, req.organization.id);
  if (!row) return res.status(404).json({ error: 'Document not found.' });

  await prisma.document.delete({ where: { id: row.id } });
  writeAuditLog({
    userId: req.user.id,
    organizationId: req.organization.id,
    action: 'document.delete',
    metadata: { docId: row.id },
  });
  res.json({ message: 'Document deleted.' });
});

module.exports = router;
