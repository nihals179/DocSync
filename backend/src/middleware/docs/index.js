const { documents } = require('../../store');

function getDocForOrg(docId, organizationId) {
  const doc = documents.get(docId);
  if (!doc) return null;
  return doc.organizationId === organizationId ? doc : null;
}

function bytes(value) {
  return Buffer.byteLength(String(value || ''), 'utf8');
}

module.exports = {
  getDocForOrg,
  bytes,
};
