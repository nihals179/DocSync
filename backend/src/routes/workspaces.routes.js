const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');

const { ensureWorkspaceForUserProvisioned } = require('../store');
const { requireAuth } = require('../middleware/auth/core');
const { requirePermission, resolveOrganizationContext } = require('../middleware/rbac');
const { attachEntitlements } = require('../middleware/entitlements');
const { isWorkspaceVisibleToUser, sortWorkspacesForUser } = require('../middleware/workspaces');

const router = express.Router();

/**
 * GET /api/workspaces
 * Returns all workspaces the current user can access.
 */
router.get('/', requireAuth, resolveOrganizationContext, requirePermission('workspace.read'), async (req, res) => {
  try {
    await ensureWorkspaceForUserProvisioned(req.user);
  } catch {
    return res.status(500).json({ error: 'Failed to initialize workspace.' });
  }

  const rows = await prisma.workspace.findMany({
    where: {
      OR: [
        { organizationId: req.organization.id },
        { organizationId: req.user.id },
      ],
    },
    orderBy: { updatedAt: 'desc' },
  });

  const items = sortWorkspacesForUser(rows.map((row) => ({
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    memberIds: Array.isArray(row.memberIds) ? row.memberIds : [],
    organizationId: row.organizationId,
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
router.post('/', requireAuth, resolveOrganizationContext, requirePermission('workspace.create'), attachEntitlements, async (req, res) => {
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
    organizationId: req.organization.id,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const saved = await prisma.workspace.create({
      data: {
        id: workspace.id,
        name: workspace.name,
        ownerId: workspace.ownerId,
        organizationId: workspace.organizationId,
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

module.exports = router;
