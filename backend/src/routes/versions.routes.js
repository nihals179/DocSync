const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');

const { getVersionHistoryRetentionDays } = require('../store');
const { requireAuth } = require('../middleware/auth/core');
const { requirePermission, resolveTenantContext } = require('../middleware/rbac');
const { filterVersionsByRetention } = require('../middleware/versions');

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
 * GET /api/docs/:docId/versions
 */
router.get('/', requireAuth, resolveTenantContext, requirePermission('document.version.read'), async (req, res) => {
  if (!await getDocForTenant(req.params.docId, req.tenant.id, res)) return;
  const retentionDays = await getVersionHistoryRetentionDays(req.tenant.id);
  const rows = await prisma.version.findMany({
    where: { docId: req.params.docId },
    orderBy: { savedAt: 'desc' },
  });
  const retained = filterVersionsByRetention(rows, retentionDays);
  const list = retained.map((item) => ({
    id: item.id,
    preview: item.title || String(item.content || '').replace(/<[^>]+>/g, '').trim().slice(0, 90),
    savedAt: item.savedAt instanceof Date ? item.savedAt.toISOString() : item.savedAt,
  }));
  res.json({ versions: list });
});

/**
 * POST /api/docs/:docId/versions
 * Body: { preview?, content }
 */
router.post('/', requireAuth, resolveTenantContext, requirePermission('document.version.write'), async (req, res) => {
  const doc = await getDocForTenant(req.params.docId, req.tenant.id, res);
  if (!doc) return;
  const { content, preview } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content is required.' });

  const derivedPreview = (preview ?? content.replace(/<[^>]+>/g, '').trim()).slice(0, 90);
  const created = await prisma.version.create({
    data: {
      id: uuidv4(),
      docId: doc.id,
      title: derivedPreview,
      content,
      savedAt: new Date(),
    },
  });

  const overflow = await prisma.version.findMany({
    where: { docId: req.params.docId },
    orderBy: { savedAt: 'desc' },
    skip: 20,
    select: { id: true },
  });
  if (overflow.length) {
    await prisma.version.deleteMany({
      where: { id: { in: overflow.map((item) => item.id) } },
    });
  }

  res.status(201).json({
    version: {
      id: created.id,
      preview: created.title,
      savedAt: created.savedAt instanceof Date ? created.savedAt.toISOString() : created.savedAt,
    },
  });
});

/**
 * POST /api/docs/:docId/versions/:versionId/restore
 * Overwrites document content with this version's content.
 */
router.post('/:versionId/restore', requireAuth, resolveTenantContext, requirePermission('document.version.restore'), async (req, res) => {
  const doc = await getDocForTenant(req.params.docId, req.tenant.id, res);
  if (!doc) return;

  const version = await prisma.version.findFirst({
    where: {
      id: req.params.versionId,
      docId: req.params.docId,
    },
  });
  if (!version) {
    return res.status(404).json({ error: 'Version not found.' });
  }

  const retentionDays = await getVersionHistoryRetentionDays(req.tenant.id);
  const retainedList = filterVersionsByRetention([version], retentionDays);
  if (!retainedList.length) {
    return res.status(404).json({ error: 'Version not found.' });
  }

  const updatedDoc = await prisma.document.update({
    where: { id: doc.id },
    data: { content: version.content },
  });
  res.json({ doc: updatedDoc });
});

/**
 * DELETE /api/docs/:docId/versions/:versionId
 */
router.delete('/:versionId', requireAuth, resolveTenantContext, requirePermission('document.version.delete'), async (req, res) => {
  if (!await getDocForTenant(req.params.docId, req.tenant.id, res)) return;

  const version = await prisma.version.findFirst({
    where: {
      id: req.params.versionId,
      docId: req.params.docId,
    },
  });
  if (!version) return res.status(404).json({ error: 'Version not found.' });

  const retentionDays = await getVersionHistoryRetentionDays(req.tenant.id);
  const retained = filterVersionsByRetention([version], retentionDays);
  if (!retained.length) {
    return res.status(404).json({ error: 'Version not found.' });
  }

  await prisma.version.delete({ where: { id: req.params.versionId } });
  res.json({ message: 'Version deleted.' });
});

module.exports = router;
