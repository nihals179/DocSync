const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');

const { requireAuth } = require('../middleware/auth/core');
const { requirePermission, resolveTenantContext } = require('../middleware/rbac');
const { getDoc } = require('../middleware/todos');

const router = express.Router({ mergeParams: true });

function docTodoScopeId(docId) {
  return `doc:${docId}`;
}

function mapDbTodoToApiTodo(row) {
  return {
    id: row.id,
    text: row.title,
    done: Boolean(row.completed),
  };
}

async function getTodosForDoc(docId, tenantId) {
  const scopedId = docTodoScopeId(docId);
  const rows = await prisma.todo.findMany({
    where: {
      OR: [
        { workspaceId: scopedId },
        { workspaceId: docId },
      ],
      tenantId,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      title: true,
      completed: true,
    },
  });

  return rows.map(mapDbTodoToApiTodo);
}

/**
 * GET /api/docs/:docId/todos
 */
router.get('/', requireAuth, resolveTenantContext, requirePermission('document.todo.read'), async (req, res) => {
  if (!await getDoc(req.params.docId, req.tenant.id, res)) return;
  const list = await getTodosForDoc(req.params.docId, req.tenant.id);
  res.json({ todos: list });
});

/**
 * POST /api/docs/:docId/todos
 * Body: { text }
 */
router.post('/', requireAuth, resolveTenantContext, requirePermission('document.todo.write'), async (req, res) => {
  if (!await getDoc(req.params.docId, req.tenant.id, res)) return;
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text is required.' });

  const created = await prisma.todo.create({
    data: {
      id: uuidv4(),
      workspaceId: docTodoScopeId(req.params.docId),
      tenantId: req.tenant.id,
      userId: req.user.id,
      title: text.trim(),
      completed: false,
    },
    select: {
      id: true,
      title: true,
      completed: true,
    },
  });

  res.status(201).json({ todo: mapDbTodoToApiTodo(created) });
});

/**
 * PUT /api/docs/:docId/todos/:todoId
 * Body: { done?, text? }
 */
router.put('/:todoId', requireAuth, resolveTenantContext, requirePermission('document.todo.write'), async (req, res) => {
  if (!await getDoc(req.params.docId, req.tenant.id, res)) return;
  const scopedId = docTodoScopeId(req.params.docId);
  const existing = await prisma.todo.findFirst({
    where: {
      id: req.params.todoId,
      OR: [
        { workspaceId: scopedId },
        { workspaceId: req.params.docId },
      ],
      tenantId: req.tenant.id,
    },
    select: { id: true },
  });
  if (!existing) return res.status(404).json({ error: 'Todo not found.' });

  const data = {};
  if (req.body.done !== undefined) data.completed = Boolean(req.body.done);
  if (req.body.text !== undefined && req.body.text.trim()) data.title = req.body.text.trim();
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update.' });
  }

  const updated = await prisma.todo.update({
    where: { id: req.params.todoId },
    data,
    select: {
      id: true,
      title: true,
      completed: true,
    },
  });

  res.json({ todo: mapDbTodoToApiTodo(updated) });
});

/**
 * DELETE /api/docs/:docId/todos/:todoId
 */
router.delete('/:todoId', requireAuth, resolveTenantContext, requirePermission('document.todo.delete'), async (req, res) => {
  if (!await getDoc(req.params.docId, req.tenant.id, res)) return;
  const scopedId = docTodoScopeId(req.params.docId);
  const deleted = await prisma.todo.deleteMany({
    where: {
      id: req.params.todoId,
      OR: [
        { workspaceId: scopedId },
        { workspaceId: req.params.docId },
      ],
      tenantId: req.tenant.id,
    },
  });
  if (deleted.count === 0) return res.status(404).json({ error: 'Todo not found.' });
  res.json({ message: 'Todo deleted.' });
});

module.exports = router;
