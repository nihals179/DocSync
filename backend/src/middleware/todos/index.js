const { prisma } = require('../../db/client');

async function getDoc(docId, tenantId, res) {
  const doc = await prisma.document.findUnique({ where: { id: docId } });
  if (!doc) {
    res.status(404).json({ error: 'Document not found.' });
    return null;
  }
  if (doc.tenantId !== tenantId ) {
    res.status(404).json({ error: 'Document not found.' });
    return null;
  }
  return doc;
}

module.exports = {
  getDoc,
};
