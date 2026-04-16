const express = require('express');
const { v4: uuidv4 } = require('uuid');

const { documents } = require('../store');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, resolveOrganizationContext } = require('../middleware/rbac');

const router = express.Router();

function getDocForOrg(docId, organizationId) {
  const doc = documents.get(docId);
  if (!doc) return null;
  return doc.organizationId === organizationId ? doc : null;
}

/**
 * POST /api/docs
 * Create a new document.
 * Body: { title?, content? }
 */
router.post('/', requireAuth, resolveOrganizationContext, requirePermission('document.create'), (req, res) => {
  const { title = 'Untitled', content = '', parentId = null, workspaceId = null } = req.body;
  const id = uuidv4();
  const now = new Date().toISOString();
  // sortOrder = max sortOrder among siblings + 1 so new docs always append
  const siblings = [...documents.values()].filter(
    (d) =>
      d.organizationId === req.organization.id &&
      (d.workspaceId ?? null) === (workspaceId ?? null) &&
      (d.parentId ?? null) === (parentId ?? null),
  );
  const sortOrder = siblings.reduce((max, d) => Math.max(max, d.sortOrder ?? 0), 0) + 1;
  const doc = {
    id,
    title,
    content,
    parentId,
    workspaceId,
    sortOrder,
    userId: req.user.id,
    organizationId: req.organization.id,
    createdAt: now,
    updatedAt: now,
  };
  documents.set(id, doc);
  res.status(201).json({ doc });
});

/**
 * GET /api/docs
 * List all documents belonging to the current user.
 */
router.get('/', requireAuth, resolveOrganizationContext, requirePermission('document.read'), (req, res) => {
  const docs = [...documents.values()]
    .filter((d) => d.organizationId === req.organization.id)
    .map(({ id, title, userId, createdAt, updatedAt, content, parentId, workspaceId, sortOrder, organizationId }) => ({
      id,
      title,
      userId,
      organizationId,
      createdAt,
      updatedAt,
      parentId: parentId ?? null,
      workspaceId: workspaceId ?? null,
      sortOrder: sortOrder ?? 0,
      preview: content.replace(/<[^>]+>/g, '').slice(0, 100),
    }))
    .sort((a, b) => {
      if ((a.workspaceId ?? '') !== (b.workspaceId ?? '')) {
        return (a.workspaceId ?? '').localeCompare(b.workspaceId ?? '');
      }
      return a.sortOrder - b.sortOrder;
    });
  res.json({ docs });
});

/**
 * GET /api/docs/:id
 * Fetch a single document.
 */
router.get('/:id', requireAuth, resolveOrganizationContext, requirePermission('document.read'), (req, res) => {
  const doc = getDocForOrg(req.params.id, req.organization.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  res.json({ doc });
});

/**
 * PUT /api/docs/:id
 * Update title and/or content.
 * Body: { title?, content? }
 */
router.put('/:id', requireAuth, resolveOrganizationContext, requirePermission('document.update'), (req, res) => {
  const doc = getDocForOrg(req.params.id, req.organization.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });

  if (req.body.title !== undefined) doc.title = req.body.title;
  if (req.body.content !== undefined) doc.content = req.body.content;
  if (req.body.parentId !== undefined) doc.parentId = req.body.parentId;
  if (req.body.workspaceId !== undefined) doc.workspaceId = req.body.workspaceId;
  if (req.body.sortOrder !== undefined) doc.sortOrder = req.body.sortOrder;
  doc.updatedAt = new Date().toISOString();
  documents.set(doc.id, doc);
  res.json({ doc });
});

/**
 * DELETE /api/docs/:id
 * Delete a document.
 */
router.delete('/:id', requireAuth, resolveOrganizationContext, requirePermission('document.delete'), (req, res) => {
  const doc = getDocForOrg(req.params.id, req.organization.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });
  documents.delete(req.params.id);
  res.json({ message: 'Document deleted.' });
});

module.exports = router;
