// Tests for GET /api/editor/:docId/bootstrap. Prisma, the store and the auth middleware
// are stubbed so the route runs against in-memory rows.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const src = (rel) => require.resolve(path.join(__dirname, '..', 'src', rel));

const state = {};

function resetState() {
  state.docs = [];
  state.versions = [];
  state.workspaces = [];
  state.retentionDays = null;
}

function addDoc(doc) {
  state.docs.push({
    userId: 'user-1',
    tenantId: 'tenant-1',
    workspaceId: 'ws-1',
    parentId: null,
    sortOrder: 0,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    ...doc,
  });
}

function addVersion(version) {
  state.versions.push({ title: null, isPublished: false, ...version });
}

const prisma = {
  document: {
    findFirst: async ({ where }) => state.docs.find((d) => d.id === where.id && d.tenantId === where.tenantId) || null,
  },
  version: {
    findMany: async ({ where }) => state.versions
      .filter((v) => v.docId === where.docId)
      .sort((a, b) => b.savedAt - a.savedAt),
  },
  workspace: {
    findMany: async ({ where }) => state.workspaces
      .filter((w) => where.OR.some((scope) => scope.tenantId === w.tenantId)),
  },
  // The only raw query on these routes is the document list.
  $queryRaw: async (_strings, previewLength, tenantId) => state.docs
    .filter((d) => d.tenantId === tenantId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(({ content, ...rest }) => ({ ...rest, previewSource: content.slice(0, previewLength) })),
};

function stub(rel, exports) {
  const id = src(rel);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

stub('db/client.js', { prisma, basePrisma: prisma });
stub('store/index.js', {
  ensureWorkspaceForUserProvisioned: async () => {},
  getVersionHistoryRetentionDays: async () => state.retentionDays,
  canCreateDocuments: async () => ({ allowed: true }),
  canUpdateDocuments: async () => ({ allowed: true }),
  consumeDocumentUpdates: async () => ({ allowed: true }),
});
stub('middleware/auth/core.js', {
  requireAuth: (req, _res, next) => {
    req.user = { id: 'user-1' };
    next();
  },
});
stub('middleware/rbac/index.js', {
  resolveTenantContext: (req, _res, next) => {
    req.tenant = { id: 'tenant-1' };
    next();
  },
  requirePermission: () => (_req, _res, next) => next(),
});
stub('middleware/entitlements/index.js', { attachEntitlements: (_req, _res, next) => next() });
stub('lib/audit.js', { writeAuditLog: () => {} });

const app = express();
app.use(express.json());
app.use('/api/docs', require('../src/routes/docs.routes'));
app.use('/api/editor', require('../src/routes/editor.routes'));

beforeEach(resetState);

function seed() {
  addDoc({
    id: 'doc-1',
    title: 'Meeting Notes',
    content: '<h1>Meeting Notes</h1><p>Product &amp; Delivery</p>',
    updatedAt: new Date('2026-10-03T00:00:00Z'),
  });
  addDoc({
    id: 'doc-2',
    title: 'Plain',
    content: 'Just text',
    updatedAt: new Date('2026-10-02T00:00:00Z'),
  });
  addDoc({
    id: 'doc-other',
    tenantId: 'tenant-2',
    title: 'Elsewhere',
    content: '<p>Other tenant</p>',
    updatedAt: new Date('2026-10-04T00:00:00Z'),
  });
}

test('returns 404 for a missing document', async () => {
  seed();
  const res = await request(app).get('/api/editor/nope/bootstrap');
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'Document not found.' });
});

test('returns 404 for a document in another tenant', async () => {
  seed();
  const res = await request(app).get('/api/editor/doc-other/bootstrap');
  assert.equal(res.status, 404);
});

test('returns the document with its content and a decoded preview', async () => {
  seed();
  const res = await request(app).get('/api/editor/doc-1/bootstrap');
  assert.equal(res.status, 200);
  assert.equal(res.body.doc.content, '<h1>Meeting Notes</h1><p>Product &amp; Delivery</p>');
  assert.equal(res.body.doc.preview, 'Meeting Notes Product & Delivery');
});

test('lists the tenant\'s documents without content, matching GET /api/docs', async () => {
  seed();
  const [bootstrap, list] = await Promise.all([
    request(app).get('/api/editor/doc-1/bootstrap'),
    request(app).get('/api/docs'),
  ]);
  assert.equal(bootstrap.status, 200);
  assert.deepEqual(bootstrap.body.docs.map((d) => d.id), ['doc-1', 'doc-2']);
  for (const doc of bootstrap.body.docs) assert.equal('content' in doc, false);
  assert.deepEqual(bootstrap.body.docs, list.body.docs);
});

test('returns retained versions newest first and the newest as latestVersion', async () => {
  seed();
  addVersion({ id: 'v-old', docId: 'doc-1', content: '<p>old</p>', savedAt: new Date('2020-01-01T00:00:00Z') });
  addVersion({ id: 'v-mid', docId: 'doc-1', content: '<p>mid</p>', savedAt: new Date(Date.now() - 2 * 86400000), isPublished: true });
  addVersion({ id: 'v-new', docId: 'doc-1', content: '<p>new</p>', savedAt: new Date(Date.now() - 86400000) });
  addVersion({ id: 'v-elsewhere', docId: 'doc-2', content: '<p>x</p>', savedAt: new Date() });
  state.retentionDays = 30;

  const res = await request(app).get('/api/editor/doc-1/bootstrap');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.versions.map((v) => [v.id, v.isPublished]), [['v-new', false], ['v-mid', true]]);
  assert.deepEqual(res.body.latestVersion, { content: '<p>new</p>', isPublished: false });
});

test('latestVersion is null when there are no versions', async () => {
  seed();
  const res = await request(app).get('/api/editor/doc-2/bootstrap');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.versions, []);
  assert.equal(res.body.latestVersion, null);
});

const addThree = () => {
  addVersion({ id: 'v1', docId: 'doc-1', content: '<p>one</p>', savedAt: new Date(Date.now() - 3 * 86400000) });
  addVersion({ id: 'v2', docId: 'doc-1', content: '<p>two</p>', savedAt: new Date(Date.now() - 2 * 86400000) });
  addVersion({ id: 'v3', docId: 'doc-1', content: '<p>three</p>', savedAt: new Date(Date.now() - 86400000) });
};

test('currentVersion is the restored base version, with its content', async () => {
  seed();
  addThree();
  state.docs.find((d) => d.id === 'doc-1').baseVersionId = 'v1';
  const res = await request(app).get('/api/editor/doc-1/bootstrap');
  assert.deepEqual(res.body.currentVersion, { id: 'v1', content: '<p>one</p>' });
  assert.equal(res.body.doc.baseVersionId, 'v1');
});

test('currentVersion leaves out the content when it is the newest version', async () => {
  seed();
  addThree();
  state.docs.find((d) => d.id === 'doc-1').baseVersionId = 'v3';
  const res = await request(app).get('/api/editor/doc-1/bootstrap');
  assert.deepEqual(res.body.currentVersion, { id: 'v3' });
});

test('currentVersion falls back to the newest version when the base is gone', async () => {
  seed();
  addThree();
  state.docs.find((d) => d.id === 'doc-1').baseVersionId = 'deleted';
  const res = await request(app).get('/api/editor/doc-1/bootstrap');
  assert.deepEqual(res.body.currentVersion, { id: 'v3' });
});

test('currentVersion is null when there are no versions', async () => {
  seed();
  const res = await request(app).get('/api/editor/doc-2/bootstrap');
  assert.equal(res.body.currentVersion, null);
});

test('currentVersion ignores a base version outside the history window', async () => {
  seed();
  addVersion({ id: 'aged', docId: 'doc-1', content: '<p>aged</p>', savedAt: new Date(Date.now() - 40 * 86400000) });
  addVersion({ id: 'recent', docId: 'doc-1', content: '<p>recent</p>', savedAt: new Date(Date.now() - 86400000) });
  state.docs.find((d) => d.id === 'doc-1').baseVersionId = 'aged';
  state.retentionDays = 30;
  const res = await request(app).get('/api/editor/doc-1/bootstrap');
  assert.deepEqual(res.body.currentVersion, { id: 'recent' });
});
