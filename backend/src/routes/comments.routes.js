const express = require('express');
const { v4: uuidv4 } = require('uuid');

const { comments } = require('../store');
const { requireAuth } = require('../middleware/auth/core');
const { requirePermission, resolveOrganizationContext } = require('../middleware/rbac');
const { getDoc } = require('../middleware/comments');

const router = express.Router({ mergeParams: true });

/**
 * GET /api/docs/:docId/comments
 */
router.get('/', requireAuth, resolveOrganizationContext, requirePermission('document.comment.read'), (req, res) => {
  if (!getDoc(req.params.docId, req.organization.id, res)) return;
  res.json({ comments: comments.get(req.params.docId) ?? [] });
});

/**
 * POST /api/docs/:docId/comments
 * Body: { text }
 */
router.post('/', requireAuth, resolveOrganizationContext, requirePermission('document.comment.write'), (req, res) => {
  if (!getDoc(req.params.docId, req.organization.id, res)) return;
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text is required.' });

  const comment = {
    id: uuidv4(),
    text: text.trim(),
    userId: req.user.id,
    userName: req.user.name,
    createdAt: new Date().toISOString(),
  };
  const list = comments.get(req.params.docId) ?? [];
  list.push(comment);
  comments.set(req.params.docId, list);
  res.status(201).json({ comment });
});

/**
 * DELETE /api/docs/:docId/comments/:commentId
 */
router.delete('/:commentId', requireAuth, resolveOrganizationContext, requirePermission('document.comment.delete'), (req, res) => {
  if (!getDoc(req.params.docId, req.organization.id, res)) return;
  const list = comments.get(req.params.docId) ?? [];
  const idx = list.findIndex((c) => c.id === req.params.commentId);
  if (idx === -1) return res.status(404).json({ error: 'Comment not found.' });
  list.splice(idx, 1);
  comments.set(req.params.docId, list);
  res.json({ message: 'Comment deleted.' });
});

module.exports = router;
