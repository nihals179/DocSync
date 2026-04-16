const express = require('express');
const { v4: uuidv4 } = require('uuid');

const { documents, todos } = require('../store');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, resolveOrganizationContext } = require('../middleware/rbac');

const router = express.Router({ mergeParams: true });

function getDoc(docId, organizationId, res) {
  const doc = documents.get(docId);
  if (!doc) { res.status(404).json({ error: 'Document not found.' }); return null; }
  if (doc.organizationId !== organizationId) { res.status(403).json({ error: 'Access denied.' }); return null; }
  return doc;
}

/**
 * GET /api/docs/:docId/todos
 */
router.get('/', requireAuth, resolveOrganizationContext, requirePermission('document.todo.read'), (req, res) => {
  if (!getDoc(req.params.docId, req.organization.id, res)) return;
  res.json({ todos: todos.get(req.params.docId) ?? [] });
});

/**
 * POST /api/docs/:docId/todos
 * Body: { text }
 */
router.post('/', requireAuth, resolveOrganizationContext, requirePermission('document.todo.write'), (req, res) => {
  if (!getDoc(req.params.docId, req.organization.id, res)) return;
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text is required.' });

  const todo = { id: uuidv4(), text: text.trim(), done: false };
  const list = todos.get(req.params.docId) ?? [];
  list.push(todo);
  todos.set(req.params.docId, list);
  res.status(201).json({ todo });
});

/**
 * PUT /api/docs/:docId/todos/:todoId
 * Body: { done?, text? }
 */
router.put('/:todoId', requireAuth, resolveOrganizationContext, requirePermission('document.todo.write'), (req, res) => {
  if (!getDoc(req.params.docId, req.organization.id, res)) return;
  const list = todos.get(req.params.docId) ?? [];
  const todo = list.find((t) => t.id === req.params.todoId);
  if (!todo) return res.status(404).json({ error: 'Todo not found.' });

  if (req.body.done !== undefined) todo.done = Boolean(req.body.done);
  if (req.body.text !== undefined && req.body.text.trim()) todo.text = req.body.text.trim();
  todos.set(req.params.docId, list);
  res.json({ todo });
});

/**
 * DELETE /api/docs/:docId/todos/:todoId
 */
router.delete('/:todoId', requireAuth, resolveOrganizationContext, requirePermission('document.todo.delete'), (req, res) => {
  if (!getDoc(req.params.docId, req.organization.id, res)) return;
  const list = todos.get(req.params.docId) ?? [];
  const idx = list.findIndex((t) => t.id === req.params.todoId);
  if (idx === -1) return res.status(404).json({ error: 'Todo not found.' });
  list.splice(idx, 1);
  todos.set(req.params.docId, list);
  res.json({ message: 'Todo deleted.' });
});

module.exports = router;
