const { prisma } = require('../../db/client');

async function getDoc(docId, organizationId, res) {
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

module.exports = {
  getDoc,
};
