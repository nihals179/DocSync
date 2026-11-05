const express = require('express');
const { prisma } = require('../db/client');

const { ensureWorkspaceForUserProvisioned, getVersionHistoryRetentionDays } = require('../store');
const { requireAuth } = require('../middleware/auth/core');
const { requirePermission, resolveTenantContext } = require('../middleware/rbac');
const { formatDoc, listDocSummaries, toIso } = require('../middleware/docs');
const { filterVersionsByRetention, pickCurrentVersionId } = require('../middleware/versions');
const { isWorkspaceVisibleToUser, sortWorkspacesForUser } = require('../middleware/workspaces');

const router = express.Router();

function mapWorkspace(row) {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    memberIds: Array.isArray(row.memberIds) ? row.memberIds : [],
    tenantId: row.tenantId,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/**
 * GET /api/editor/:docId/bootstrap
 * Everything the editor needs to open a document: the document, its retained versions,
 * the newest version's content, the version the document is on (currentVersion, with its
 * content only when that isn't the newest version), the sidebar list (the same summaries GET /api/docs
 * returns, without content) and the workspaces the user can see.
 */
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

    const [docRow, docs, versionRows] = await Promise.all([
      prisma.document.findFirst({ where: { id: docId, tenantId: req.tenant.id } }),
      listDocSummaries(req.tenant.id),
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

    const [latest] = retainedVersions;
    // The same rule comments use, so the editor and the Comments panel agree on "This version".
    // Retained versions only, so the current one is always in the Saved Versions list.
    const currentVersionId = pickCurrentVersionId(docRow.baseVersionId, retainedVersions);
    const currentRow = retainedVersions.find((item) => item.id === currentVersionId);
    const response = {
      doc: formatDoc(docRow),
      versions: retainedVersions.map((item) => ({
        id: item.id,
        preview: item.title || String(item.content || '').replace(/<[^>]+>/g, '').trim().slice(0, 90),
        savedAt: toIso(item.savedAt),
        isPublished: Boolean(item.isPublished),
      })),
      // What the editor compares against to tell whether there is anything to commit.
      latestVersion: latest ? { content: latest.content, isPublished: Boolean(latest.isPublished) } : null,
      // What a restore would discard edits against; content is left out when it is latestVersion's.
      currentVersion: currentRow
        ? { id: currentRow.id, ...(currentRow.id === latest?.id ? {} : { content: currentRow.content }) }
        : null,
      docs,
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
