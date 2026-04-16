const express = require('express');
const { v4: uuidv4 } = require('uuid');

const { workspaces } = require('../store');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, resolveOrganizationContext } = require('../middleware/rbac');

const router = express.Router();

/**
 * GET /api/workspaces
 * Returns all workspaces the current user can access.
 */
router.get('/', requireAuth, resolveOrganizationContext, requirePermission('workspace.read'), (req, res) => {
  const items = [...workspaces.values()]
    .filter((w) => w.organizationId === req.organization.id)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  res.json({ workspaces: items });
});

/**
 * POST /api/workspaces
 * Creates a workspace owned by current user.
 * Body: { name? }
 */
router.post('/', requireAuth, resolveOrganizationContext, requirePermission('workspace.create'), (req, res) => {
  const name = typeof req.body?.name === 'string' && req.body.name.trim().length > 0
    ? req.body.name.trim()
    : 'New Workspace';

  const now = new Date().toISOString();
  const workspace = {
    id: uuidv4(),
    name,
    ownerId: req.user.id,
    memberIds: [req.user.id],
    organizationId: req.organization.id,
    createdAt: now,
    updatedAt: now,
  };

  workspaces.set(workspace.id, workspace);
  res.status(201).json({ workspace });
});

module.exports = router;
