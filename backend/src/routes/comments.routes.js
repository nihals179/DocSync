const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { basePrisma } = require('../db/client');
const { tenantPrisma: prisma } = require('../db/tenant-client');

const { requireAuth } = require('../middleware/auth/core');
const { requirePermission, resolveTenantContext } = require('../middleware/rbac');
const { getCurrentVersionId } = require('../middleware/versions');
const { getVersionHistoryRetentionDays } = require('../store');

const router = express.Router({ mergeParams: true });

async function getDocForTenant(docId, tenantId, res) {
  const doc = await prisma.document.findUnique({ where: { id: docId } });
  if (!doc) {
    res.status(404).json({ error: 'Document not found.' });
    return null;
  }
  if (doc.tenantId !== tenantId) {
    res.status(404).json({ error: 'Document not found.' });
    return null;
  }
  return doc;
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function formatComment(row, userName) {
  return {
    id: row.id,
    text: row.text,
    userId: row.userId,
    userName: userName || 'Unknown user',
    versionId: row.versionId ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/**
 * GET /api/docs/:docId/comments
 * Every comment on the document. Each one carries the version it was written on (null when
 * the document had no versions yet); currentVersionId is the version the document is on now,
 * so the client can show that version's comments first and group the rest by version.
 */
router.get('/', requireAuth, resolveTenantContext, requirePermission('document.comment.read'), async (req, res) => {
  const doc = await getDocForTenant(req.params.docId, req.tenant.id, res);
  if (!doc) return;
  const [rows, currentVersionId] = await Promise.all([
    prisma.comment.findMany({
      where: { docId: req.params.docId },
      orderBy: { createdAt: 'asc' },
    }),
    getVersionHistoryRetentionDays(req.tenant.id).then((days) => getCurrentVersionId(doc, days)),
  ]);

  const userIds = [...new Set(rows.map((row) => row.userId))];
  const users = userIds.length
    ? await basePrisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    })
    : [];
  const userNameById = new Map(users.map((user) => [user.id, user.name]));

  res.json({
    comments: rows.map((row) => formatComment(row, userNameById.get(row.userId))),
    currentVersionId,
  });
});

/**
 * POST /api/docs/:docId/comments
 * Body: { text }
 * The comment is pinned to the version the document is on (see getCurrentVersionId). With no
 * versions yet it is a draft comment, which the document's first commit adopts.
 */
router.post('/', requireAuth, resolveTenantContext, requirePermission('document.comment.write'), async (req, res) => {
  const doc = await getDocForTenant(req.params.docId, req.tenant.id, res);
  if (!doc) return;
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text is required.' });

  const created = await prisma.comment.create({
    data: {
      id: uuidv4(),
      docId: req.params.docId,
      userId: req.user.id,
      text: text.trim(),
      versionId: await getCurrentVersionId(doc, await getVersionHistoryRetentionDays(req.tenant.id)),
    },
  });
  res.status(201).json({ comment: formatComment(created, String(req.user?.name || '')) });
});

/**
 * DELETE /api/docs/:docId/comments/:commentId
 */
router.delete('/:commentId', requireAuth, resolveTenantContext, requirePermission('document.comment.delete'), async (req, res) => {
  if (!await getDocForTenant(req.params.docId, req.tenant.id, res)) return;
  const result = await prisma.comment.deleteMany({
    where: {
      id: req.params.commentId,
      docId: req.params.docId,
    },
  });
  if (!result.count) return res.status(404).json({ error: 'Comment not found.' });
  res.json({ message: 'Comment deleted.' });
});

module.exports = router;
