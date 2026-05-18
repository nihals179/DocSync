const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');

const { requireAuth } = require('../middleware/auth/core');
const { requirePermission, resolveOrganizationContext } = require('../middleware/rbac');
const { getDoc } = require('../middleware/todos');

const router = express.Router({ mergeParams: true });
const DOC_TODOS_MAP = 'doc_todos';

function normalizeTodoList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: String(item.id || ''),
      text: String(item.text || ''),
      done: Boolean(item.done),
    }))
    .filter((item) => item.id && item.text);
}

async function getTodosForDoc(docId) {
  const row = await prisma.localStoreEntry.findUnique({
    where: {
      mapName_entryKey: {
        mapName: DOC_TODOS_MAP,
        entryKey: docId,
      },
    },
    select: { value: true },
  });
  return normalizeTodoList(row?.value);
}

async function saveTodosForDoc(docId, list) {
  await prisma.localStoreEntry.upsert({
    where: {
      mapName_entryKey: {
        mapName: DOC_TODOS_MAP,
        entryKey: docId,
      },
    },
    update: {
      value: list,
    },
    create: {
      mapName: DOC_TODOS_MAP,
      entryKey: docId,
      value: list,
    },
  });
}

/**
 * GET /api/docs/:docId/todos
 */
router.get('/', requireAuth, resolveOrganizationContext, requirePermission('document.todo.read'), async (req, res) => {
  if (!await getDoc(req.params.docId, req.organization.id, res)) return;
  const list = await getTodosForDoc(req.params.docId);
  res.json({ todos: list });
});

/**
 * POST /api/docs/:docId/todos
 * Body: { text }
 */
router.post('/', requireAuth, resolveOrganizationContext, requirePermission('document.todo.write'), async (req, res) => {
  if (!await getDoc(req.params.docId, req.organization.id, res)) return;
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text is required.' });

  const todo = { id: uuidv4(), text: text.trim(), done: false };
  const list = await getTodosForDoc(req.params.docId);
  list.push(todo);
  await saveTodosForDoc(req.params.docId, list);
  res.status(201).json({ todo });
});

/**
 * PUT /api/docs/:docId/todos/:todoId
 * Body: { done?, text? }
 */
router.put('/:todoId', requireAuth, resolveOrganizationContext, requirePermission('document.todo.write'), async (req, res) => {
  if (!await getDoc(req.params.docId, req.organization.id, res)) return;
  const list = await getTodosForDoc(req.params.docId);
  const todo = list.find((t) => t.id === req.params.todoId);
  if (!todo) return res.status(404).json({ error: 'Todo not found.' });

  if (req.body.done !== undefined) todo.done = Boolean(req.body.done);
  if (req.body.text !== undefined && req.body.text.trim()) todo.text = req.body.text.trim();
  await saveTodosForDoc(req.params.docId, list);
  res.json({ todo });
});

/**
 * DELETE /api/docs/:docId/todos/:todoId
 */
router.delete('/:todoId', requireAuth, resolveOrganizationContext, requirePermission('document.todo.delete'), async (req, res) => {
  if (!await getDoc(req.params.docId, req.organization.id, res)) return;
  const list = await getTodosForDoc(req.params.docId);
  const idx = list.findIndex((t) => t.id === req.params.todoId);
  if (idx === -1) return res.status(404).json({ error: 'Todo not found.' });
  list.splice(idx, 1);
  await saveTodosForDoc(req.params.docId, list);
  res.json({ message: 'Todo deleted.' });
});

module.exports = router;
