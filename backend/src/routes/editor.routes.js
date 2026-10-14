const express = require('express');
const { prisma } = require('../db/client');

const { ensureWorkspaceForUserProvisioned, getVersionHistoryRetentionDays } = require('../store');
const { requireAuth } = require('../middleware/auth/core');
const { requirePermission, resolveTenantContext } = require('../middleware/rbac');
const { filterVersionsByRetention } = require('../middleware/versions');
const { isWorkspaceVisibleToUser, sortWorkspacesForUser } = require('../middleware/workspaces');

const router = express.Router();

function mapDocPreview(content) {
  return String(content || '').replace(/<[^>]+>/g, '').slice(0, 100);
}

function mapDoc(row) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    userId: row.userId,
    tenantId: row.tenantId,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    parentId: null,
    workspaceId: row.workspaceId ?? null,
    sortOrder: 0,
    preview: mapDocPreview(row.content),
  };
}

function mapWorkspace(row) {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    memberIds: Array.isArray(row.memberIds) ? row.memberIds : [],
    tenantId: row.tenantId,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}

router.get(
  '/:docId/bootstrap',
  requireAuth,
  resolveTenantContext,
  requirePermission('document.read'),
  requirePermission('document.version.read'),
  requirePermission('workspace.read'),
  async (req, res) => {
    const docId = String(req.params.docId || '').trim();
    if (!docId) return res.status(400).json({ error: 'Document id is required.' });

    const [docRow, docsRows, versionRows] = await Promise.all([
      prisma.document.findFirst({ where: { id: docId, tenantId: req.tenant.id } }),
      prisma.document.findMany({
        where: { tenantId: req.tenant.id },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.version.findMany({
        where: { docId },
        orderBy: { savedAt: 'desc' },
      }),
    ]);

    if (!docRow) return res.status(404).json({ error: 'Document not found.' });

    let workspaceRows = [];
    try {
      await ensureWorkspaceForUserProvisioned(req.user);
      workspaceRows = await prisma.workspace.findMany({
        where: {
          OR: [
            { tenantId: req.tenant.id },
            { tenantId: req.user.id },
          ],
        },
        orderBy: { updatedAt: 'desc' },
      });
    } catch {
      return res.status(500).json({ error: 'Failed to load workspaces.' });
    }

    const retentionDays = await getVersionHistoryRetentionDays(req.tenant.id);
    const retainedVersions = filterVersionsByRetention(versionRows, retentionDays);

    const response = {
      doc: mapDoc(docRow),
      versions: retainedVersions.map((item) => ({
        id: item.id,
        preview: item.title || String(item.content || '').replace(/<[^>]+>/g, '').trim().slice(0, 90),
        savedAt: item.savedAt instanceof Date ? item.savedAt.toISOString() : item.savedAt,
      })),
      docs: docsRows.map(mapDoc),
      workspaces: sortWorkspacesForUser(
        workspaceRows.map(mapWorkspace).filter((workspace) => isWorkspaceVisibleToUser(workspace, req.user.id)),
        req.user.id,
      ).map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        ownerId: workspace.ownerId,
        memberIds: workspace.memberIds,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      })),
    };

    return res.json(response);
  },
);

module.exports = router;
