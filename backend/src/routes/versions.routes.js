const express = require('express');
const { v4: uuidv4 } = require('uuid');

const { documents, versions } = require('../store');
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
 * GET /api/docs/:docId/versions
 */
router.get('/', requireAuth, resolveOrganizationContext, requirePermission('document.version.read'), (req, res) => {
  if (!getDoc(req.params.docId, req.organization.id, res)) return;
  const list = (versions.get(req.params.docId) ?? []).map(({ id, preview, savedAt }) => ({ id, preview, savedAt }));
  res.json({ versions: list });
});

/**
 * POST /api/docs/:docId/versions
 * Body: { preview?, content }
 */
router.post('/', requireAuth, resolveOrganizationContext, requirePermission('document.version.write'), (req, res) => {
  const doc = getDoc(req.params.docId, req.organization.id, res);
  if (!doc) return;
  const { content, preview } = req.body;
  if (content === undefined) return res.status(400).json({ error: 'content is required.' });

  const version = {
    id: uuidv4(),
    preview: (preview ?? content.replace(/<[^>]+>/g, '').trim()).slice(0, 90),
    content,
    savedAt: new Date().toLocaleString(),
  };
  const list = versions.get(req.params.docId) ?? [];
  list.unshift(version);
  // Keep latest 20 versions
  if (list.length > 20) list.splice(20);
  versions.set(req.params.docId, list);
  res.status(201).json({ version: { id: version.id, preview: version.preview, savedAt: version.savedAt } });
});

/**
 * POST /api/docs/:docId/versions/:versionId/restore
 * Overwrites document content with this version's content.
 */
router.post('/:versionId/restore', requireAuth, resolveOrganizationContext, requirePermission('document.version.restore'), (req, res) => {
  const doc = getDoc(req.params.docId, req.organization.id, res);
  if (!doc) return;
  const list = versions.get(req.params.docId) ?? [];
  const version = list.find((v) => v.id === req.params.versionId);
  if (!version) return res.status(404).json({ error: 'Version not found.' });

  doc.content = version.content;
  doc.updatedAt = new Date().toISOString();
  documents.set(doc.id, doc);
  res.json({ doc });
});

/**
 * DELETE /api/docs/:docId/versions/:versionId
 */
router.delete('/:versionId', requireAuth, resolveOrganizationContext, requirePermission('document.version.delete'), (req, res) => {
  if (!getDoc(req.params.docId, req.organization.id, res)) return;
  const list = versions.get(req.params.docId) ?? [];
  const idx = list.findIndex((v) => v.id === req.params.versionId);
  if (idx === -1) return res.status(404).json({ error: 'Version not found.' });
  list.splice(idx, 1);
  versions.set(req.params.docId, list);
  res.json({ message: 'Version deleted.' });
});

module.exports = router;
