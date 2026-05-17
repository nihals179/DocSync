const { documents } = require('../../store');

function parseSavedAtMs(savedAt) {
  const ts = Date.parse(String(savedAt || ''));
  return Number.isFinite(ts) ? ts : 0;
}

function getRetentionCutoffMs(retentionDays) {
  if (retentionDays === null || retentionDays === undefined) return null;
  const days = Number(retentionDays);
  if (!Number.isFinite(days) || days <= 0) return Date.now();
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function filterVersionsByRetention(versionsList, retentionDays) {
  const cutoffMs = getRetentionCutoffMs(retentionDays);
  if (cutoffMs === null) return versionsList;
  return versionsList.filter((item) => parseSavedAtMs(item.savedAt) >= cutoffMs);
}

function getDoc(docId, organizationId, res) {
  const doc = documents.get(docId);
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

module.exports = {
  parseSavedAtMs,
  getRetentionCutoffMs,
  filterVersionsByRetention,
  getDoc,
};
