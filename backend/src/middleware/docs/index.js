const { prisma } = require('../../db/client');

const PREVIEW_LENGTH = 100;
// Raw HTML spends most of its first characters on tags and inline styles, so the list
// query reads this many characters of content to build a 100-character text preview.
const PREVIEW_SOURCE_LENGTH = 4000;

const HTML_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function bytes(value) {
  return Buffer.byteLength(String(value || ''), 'utf8');
}

function decodeHtmlEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function buildPreview(content) {
  // The list query reads a content prefix, which can end inside a long tag (table tokens
  // carry kilobytes of attribute data); drop that unterminated tag before stripping tags.
  const text = String(content || '').replace(/<[^>]*$/, '').replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(text).replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LENGTH);
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function formatDocSummary(doc, previewSource = doc.content) {
  return {
    id: doc.id,
    title: doc.title,
    userId: doc.userId,
    tenantId: doc.tenantId,
    workspaceId: doc.workspaceId ?? null,
    parentId: doc.parentId ?? null,
    sortOrder: Number(doc.sortOrder ?? 0),
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
    preview: buildPreview(previewSource),
  };
}

function formatDoc(doc) {
  return { ...formatDocSummary(doc), content: doc.content };
}

/**
 * Summaries of every document in a tenant, most recently updated first. Only a content
 * prefix is read from the database to build each preview.
 */
async function listDocSummaries(tenantId) {
  const rows = await prisma.$queryRaw`
    SELECT id, title, "userId", "tenantId", "workspaceId", "parentId", "sortOrder", "createdAt", "updatedAt",
      LEFT(content, ${PREVIEW_SOURCE_LENGTH}::int) AS "previewSource"
    FROM documents
    WHERE "tenantId" = ${tenantId}
    ORDER BY "updatedAt" DESC
  `;
  return rows.map((row) => formatDocSummary(row, row.previewSource));
}

module.exports = {
  bytes,
  buildPreview,
  formatDoc,
  formatDocSummary,
  listDocSummaries,
  toIso,
};
