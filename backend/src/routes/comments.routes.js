const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');

const { requireAuth } = require('../middleware/auth/core');
const { requirePermission, resolveTenantContext } = require('../middleware/rbac');

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

/**
 * GET /api/docs/:docId/comments
 */
router.get('/', requireAuth, resolveTenantContext, requirePermission('document.comment.read'), async (req, res) => {
  if (!await getDocForTenant(req.params.docId, req.tenant.id, res)) return;
  const rows = await prisma.comment.findMany({
    where: { docId: req.params.docId },
    orderBy: { createdAt: 'asc' },
  });

  const userIds = [...new Set(rows.map((row) => row.userId))];
  const users = userIds.length
    ? await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    })
    : [];
  const userNameById = new Map(users.map((user) => [user.id, user.name]));

  const list = rows.map((row) => ({
    id: row.id,
    text: row.text,
    userId: row.userId,
    userName: userNameById.get(row.userId) || 'Unknown user',
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  }));
  res.json({ comments: list });
});

/**
 * POST /api/docs/:docId/comments
 * Body: { text }
 */
router.post('/', requireAuth, resolveTenantContext, requirePermission('document.comment.write'), async (req, res) => {
  if (!await getDocForTenant(req.params.docId, req.tenant.id, res)) return;
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text is required.' });

  const created = await prisma.comment.create({
    data: {
      id: uuidv4(),
      docId: req.params.docId,
      userId: req.user.id,
      text: text.trim(),
    },
  });
  const comment = {
    id: created.id,
    text: created.text,
    userId: created.userId,
    userName: String(req.user?.name || 'Unknown user'),
    createdAt: created.createdAt instanceof Date ? created.createdAt.toISOString() : created.createdAt,
    updatedAt: created.updatedAt instanceof Date ? created.updatedAt.toISOString() : created.updatedAt,
  };
  res.status(201).json({ comment });
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
