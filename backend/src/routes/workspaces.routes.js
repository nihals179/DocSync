const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');

const { ensureWorkspaceForUserProvisioned } = require('../store');
const { requireAuth } = require('../middleware/auth/core');
const { requirePermission, resolveTenantContext } = require('../middleware/rbac');
const { attachEntitlements } = require('../middleware/entitlements');
const { isWorkspaceVisibleToUser, sortWorkspacesForUser } = require('../middleware/workspaces');

const router = express.Router();

/**
 * GET /api/workspaces
 * Returns all workspaces the current user can access.
 */
router.get('/', requireAuth, resolveTenantContext, requirePermission('workspace.read'), async (req, res) => {
  try {
    await ensureWorkspaceForUserProvisioned(req.user);
  } catch {
    return res.status(500).json({ error: 'Failed to initialize workspace.' });
  }

  const rows = await prisma.workspace.findMany({
    where: {
      OR: [
        { tenantId: req.tenant.id },
        { ownerId: req.user.id },
      ],
    },
    orderBy: { updatedAt: 'desc' },
  });

  const items = sortWorkspacesForUser(rows.map((row) => ({
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    memberIds: Array.isArray(row.memberIds) ? row.memberIds : [],
    tenantId: row.tenantId,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  })).filter((workspace) => isWorkspaceVisibleToUser(workspace, req.user.id)), req.user.id);
  return res.json({ workspaces: items });
});

/**
 * POST /api/workspaces
 * Creates a workspace owned by current user.
 * Body: { name? }
 */
router.post('/', requireAuth, resolveTenantContext, requirePermission('workspace.create'), attachEntitlements, async (req, res) => {
  const planId = String(req.entitlements?.billing?.planId || 'free').toLowerCase();
  if (planId === 'free') {
    return res.status(402).json({
      error: 'Workspace creation is available on paid plans. Please upgrade to continue.',
      code: 'workspace_creation_requires_paid_plan',
    });
  }

  const name = typeof req.body?.name === 'string' && req.body.name.trim().length > 0
    ? req.body.name.trim()
    : 'New Workspace';

  const now = new Date().toISOString();
  const workspace = {
    id: uuidv4(),
    name,
    ownerId: req.user.id,
    memberIds: [],
    tenantId: req.tenant.id,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const saved = await prisma.workspace.create({
      data: {
        id: workspace.id,
        name: workspace.name,
        ownerId: workspace.ownerId,
        tenantId: workspace.tenantId,
        memberIds: workspace.memberIds,
        createdAt: new Date(workspace.createdAt),
      },
    });
    workspace.createdAt = new Date(saved.createdAt).toISOString();
    workspace.updatedAt = new Date(saved.updatedAt).toISOString();
  } catch {
    return res.status(500).json({ error: 'Failed to create workspace.' });
  }

  return res.status(201).json({ workspace });
});

/**
 * POST /api/workspaces/current
 * Updates the user's current workspace (currentTenantId).
 * Body: { workspaceId }
 */
router.post('/current', requireAuth, async (req, res) => {
  const workspaceId = String(req.body?.workspaceId || '').trim();
  if (!workspaceId) {
    return res.status(400).json({ error: 'Workspace ID is required.' });
  }

  try {
    // Verify the workspace exists and user has access
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
    });

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found.' });
    }

    // Update user's currentTenantId
    await prisma.user.update({
      where: { id: req.user.id },
      data: { currentTenantId: workspace.tenantId },
    });

    res.json({ message: 'Current workspace updated.' });
  } catch (err) {
    console.error('Failed to update current workspace:', err);
    res.status(500).json({ error: 'Failed to update current workspace.' });
  }
});

/**
 * DELETE /api/workspaces/:workspaceId
 * Deletes a workspace visible to the current user and clears workspace links from documents.
 */
router.delete('/:workspaceId', requireAuth, resolveTenantContext, requirePermission('workspace.delete'), async (req, res) => {
  const workspaceId = String(req.params.workspaceId || '').trim();
  if (!workspaceId) {
    return res.status(400).json({ error: 'Workspace id is required.' });
  }

  const row = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!row) {
    return res.status(404).json({ error: 'Workspace not found.' });
  }

  const workspace = {
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    memberIds: Array.isArray(row.memberIds) ? row.memberIds : [],
    tenantId: row.tenantId,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
  if (!isWorkspaceVisibleToUser(workspace, req.user.id)) {
    return res.status(404).json({ error: 'Workspace not found.' });
  }

  try {
    await prisma.$transaction([
      // The workspace's top-level chapters join the tenant's no-workspace chapters; shift
      // them so they keep their order and sit above the existing ones. Subtrees move intact.
      prisma.$executeRaw`
        UPDATE documents
        SET "sortOrder" = "sortOrder"
          - (SELECT COALESCE(MAX("sortOrder"), 0) FROM documents
             WHERE "tenantId" = ${req.tenant.id} AND "workspaceId" = ${workspaceId} AND "parentId" IS NULL)
          + (SELECT COALESCE(MIN("sortOrder"), 1) FROM documents
             WHERE "tenantId" = ${req.tenant.id} AND "workspaceId" IS NULL AND "parentId" IS NULL)
          - 1
        WHERE "tenantId" = ${req.tenant.id} AND "workspaceId" = ${workspaceId} AND "parentId" IS NULL
      `,
      prisma.document.updateMany({
        where: {
          workspaceId,
          tenantId: req.tenant.id,
        },
        data: { workspaceId: null },
      }),
      prisma.workspace.delete({ where: { id: workspaceId } }),
    ]);
  } catch {
    return res.status(500).json({ error: 'Failed to delete workspace.' });
  }

  return res.json({ message: 'Workspace deleted.' });
});

module.exports = router;
