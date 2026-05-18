const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');

const { requireAuth } = require('../middleware/auth/core');
const { requirePermission, resolveOrganizationContext } = require('../middleware/rbac');

const router = express.Router({ mergeParams: true });

async function getDocForOrg(docId, organizationId, res) {
  const doc = await prisma.document.findUnique({ where: { id: docId } });
  if (!doc) {
    res.status(404).json({ error: 'Document not found.' });
    return null;
  }
  if (doc.organizationId !== organizationId) {
    res.status(403).json({ error: 'Access denied.' });
    return null;
  }
  return doc;
}

/**
 * GET /api/docs/:docId/comments
 */
router.get('/', requireAuth, resolveOrganizationContext, requirePermission('document.comment.read'), async (req, res) => {
  if (!await getDocForOrg(req.params.docId, req.organization.id, res)) return;
  const rows = await prisma.comment.findMany({
    where: { docId: req.params.docId },
    orderBy: { createdAt: 'asc' },
  });
  const list = rows.map((row) => ({
    id: row.id,
    text: row.text,
    userId: row.userId,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  }));
  res.json({ comments: list });
});

/**
 * POST /api/docs/:docId/comments
 * Body: { text }
 */
router.post('/', requireAuth, resolveOrganizationContext, requirePermission('document.comment.write'), async (req, res) => {
  if (!await getDocForOrg(req.params.docId, req.organization.id, res)) return;
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
    createdAt: created.createdAt instanceof Date ? created.createdAt.toISOString() : created.createdAt,
    updatedAt: created.updatedAt instanceof Date ? created.updatedAt.toISOString() : created.updatedAt,
  };
  res.status(201).json({ comment });
});

/**
 * DELETE /api/docs/:docId/comments/:commentId
 */
router.delete('/:commentId', requireAuth, resolveOrganizationContext, requirePermission('document.comment.delete'), async (req, res) => {
  if (!await getDocForOrg(req.params.docId, req.organization.id, res)) return;
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
