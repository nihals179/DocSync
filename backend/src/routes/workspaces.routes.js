const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');
const { getTenantClient, isDedicatedTenant, tenantPrisma } = require('../db/tenant-client');

const { ensureWorkspaceForUserProvisioned } = require('../store');
const { requireAuth } = require('../middleware/auth/core');
const { requirePermission, resolveTenantContext } = require('../middleware/rbac');
const { attachEntitlements } = require('../middleware/entitlements');
const { isWorkspaceVisibleToUser } = require('../middleware/workspaces');

const router = express.Router();

/**
 * Finds a workspace in the shared database, then in the dedicated database of the user's
 * current tenant, where workspaces created after provisioning live.
 */
async function findWorkspaceForUser(user, workspaceId) {
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (workspace || !user.currentTenantId) return workspace;

  const tenant = await prisma.tenant.findUnique({ where: { id: user.currentTenantId } });
  if (!isDedicatedTenant(tenant)) return null;

  const tenantDb = await getTenantClient(tenant);
  return tenantDb.workspace.findUnique({ where: { id: workspaceId } });
}

/**
 * GET /api/workspaces
 * Returns all workspaces the current user can access.
 */
router.get('/', requireAuth, resolveTenantContext, requirePermission('workspace.read'), async (req, res) => {
  try {
    if (req.tenant.databaseMode !== 'dedicated') {
      await ensureWorkspaceForUserProvisioned(req.user);
    }
  } catch {
    return res.status(500).json({ error: 'Failed to initialize workspace.' });
  }

  const rows = await tenantPrisma.$queryRaw`
    SELECT "id", "name", "ownerId", "memberIds", "tenantId", "createdAt", "updatedAt"
    FROM "workspaces"
    WHERE (
        "tenantId" = ${req.tenant.id}
        OR (
          "ownerId" = ${req.user.id}
          -- Provisioning leaves a copy of a dedicated tenant's rows in the shared database.
          AND NOT EXISTS (
            SELECT 1 FROM "tenants" t
            WHERE t."id" = "workspaces"."tenantId"
              AND t."databaseMode" = 'dedicated'
              AND t."databaseStatus" = 'active'
          )
        )
      )
      AND (
        ("tenantId" = "ownerId" AND "ownerId" = ${req.user.id})
        OR (
          CASE WHEN jsonb_typeof("memberIds") = 'array'
            THEN jsonb_array_length("memberIds") = 1
            ELSE "memberIds" IS NULL
          END
          AND "memberIds"->>0 = "ownerId"
          AND "ownerId" = ${req.user.id}
        )
        OR "memberIds" IS NULL
        OR jsonb_typeof("memberIds") <> 'array'
        OR CASE WHEN jsonb_typeof("memberIds") = 'array'
          THEN jsonb_array_length("memberIds") = 0
          ELSE false
        END
        OR "memberIds" @> to_jsonb(ARRAY[${req.user.id}]::text[])
      )
    ORDER BY ("ownerId" = ${req.user.id} AND "tenantId" = ${req.user.id}) DESC, "updatedAt" DESC
  `;

  const items = rows.map((row) => ({
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    memberIds: Array.isArray(row.memberIds) ? row.memberIds : [],
    tenantId: row.tenantId,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  }));
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
    const saved = await tenantPrisma.workspace.create({
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
    const workspace = await findWorkspaceForUser(req.user, workspaceId);

    if (!workspace || !isWorkspaceVisibleToUser(workspace, req.user.id)) {
      return res.status(404).json({ error: 'Workspace not found.' });
    }

    // A personal workspace belongs to the user, so there is no tenant to switch to.
    if (workspace.tenantId === req.user.id) {
      return res.json({ message: 'Current workspace updated.' });
    }

    const membership = await prisma.tenantMembership.findFirst({
      where: { tenantId: workspace.tenantId, userId: req.user.id, status: 'active' },
    });
    if (!membership) {
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

  const row = await tenantPrisma.workspace.findUnique({ where: { id: workspaceId } });
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
    await tenantPrisma.$transaction([
      // The workspace's top-level chapters join the tenant's no-workspace chapters; shift
      // them so they keep their order and sit above the existing ones. Subtrees move intact.
      tenantPrisma.$executeRaw`
        UPDATE documents
        SET "sortOrder" = "sortOrder"
          - (SELECT COALESCE(MAX("sortOrder"), 0) FROM documents
             WHERE "tenantId" = ${req.tenant.id} AND "workspaceId" = ${workspaceId} AND "parentId" IS NULL)
          + (SELECT COALESCE(MIN("sortOrder"), 1) FROM documents
             WHERE "tenantId" = ${req.tenant.id} AND "workspaceId" IS NULL AND "parentId" IS NULL)
          - 1
        WHERE "tenantId" = ${req.tenant.id} AND "workspaceId" = ${workspaceId} AND "parentId" IS NULL
      `,
      tenantPrisma.document.updateMany({
        where: {
          workspaceId,
          tenantId: req.tenant.id,
        },
        data: { workspaceId: null },
      }),
      tenantPrisma.workspace.delete({ where: { id: workspaceId } }),
    ]);
  } catch {
    return res.status(500).json({ error: 'Failed to delete workspace.' });
  }

  return res.json({ message: 'Workspace deleted.' });
});

module.exports = router;
