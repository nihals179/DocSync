const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');

const { ensureWorkspaceForUserProvisioned, workspaces } = require('../store');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, resolveOrganizationContext } = require('../middleware/rbac');
const { attachEntitlements } = require('../middleware/entitlements');

const router = express.Router();

function isWorkspaceVisibleToUser(workspace, userId) {
  const memberIds = Array.isArray(workspace.memberIds) ? workspace.memberIds : null;

  // Personal workspace: owner-scope key or explicit single-member ownership.
  if (workspace.organizationId === workspace.ownerId) {
    return workspace.ownerId === userId;
  }

  // Legacy personal workspace representation.
  if (memberIds && memberIds.length === 1 && memberIds[0] === workspace.ownerId) {
    return workspace.ownerId === userId;
  }

  // Organization-shared workspace: no explicit member list.
  if (!memberIds || memberIds.length === 0) return true;

  return memberIds.includes(userId);
}

function sortWorkspacesForUser(items, userId) {
  return [...items].sort((a, b) => {
    const aIsPersonal = a.ownerId === userId && a.organizationId === userId;
    const bIsPersonal = b.ownerId === userId && b.organizationId === userId;

    if (aIsPersonal !== bIsPersonal) {
      return aIsPersonal ? -1 : 1;
    }

    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

/**
 * GET /api/workspaces
 * Returns all workspaces the current user can access.
 */
router.get('/', requireAuth, resolveOrganizationContext, requirePermission('workspace.read'), async (req, res) => {
  try {
    await ensureWorkspaceForUserProvisioned(req.user, req.organization.id);
  } catch {
    return res.status(500).json({ error: 'Failed to initialize workspace.' });
  }

  if (process.env.DATABASE_URL) {
    return prisma.workspace.findMany({
      where: {
        OR: [
          { organizationId: req.organization.id },
          { organizationId: req.user.id },
        ],
      },
      orderBy: { updatedAt: 'desc' },
    }).then((rows) => {
      const items = sortWorkspacesForUser(rows.map((row) => ({
        id: row.id,
        name: row.name,
        ownerId: row.ownerId,
        memberIds: Array.isArray(row.memberIds) ? row.memberIds : [],
        organizationId: row.organizationId,
        createdAt: new Date(row.createdAt).toISOString(),
        updatedAt: new Date(row.updatedAt).toISOString(),
      })).filter((workspace) => isWorkspaceVisibleToUser(workspace, req.user.id)), req.user.id);
      for (const item of items) workspaces.set(item.id, item);
      res.json({ workspaces: items });
    }).catch(() => {
      const items = sortWorkspacesForUser([...workspaces.values()]
        .filter((w) => w.organizationId === req.organization.id || w.organizationId === req.user.id)
        .filter((workspace) => isWorkspaceVisibleToUser(workspace, req.user.id))
      , req.user.id);
      res.json({ workspaces: items });
    });
  }

  const items = sortWorkspacesForUser([...workspaces.values()]
    .filter((w) => w.organizationId === req.organization.id || w.organizationId === req.user.id)
    .filter((workspace) => isWorkspaceVisibleToUser(workspace, req.user.id))
  , req.user.id);

  return res.json({ workspaces: items });
});

/**
 * POST /api/workspaces
 * Creates a workspace owned by current user.
 * Body: { name? }
 */
router.post('/', requireAuth, resolveOrganizationContext, requirePermission('workspace.create'), attachEntitlements, async (req, res) => {
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

  if (process.env.DATABASE_URL) {
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
  }

  workspaces.set(workspace.id, workspace);
  return res.status(201).json({ workspace });
});

module.exports = router;
