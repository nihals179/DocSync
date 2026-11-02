// Route tests for /api/docs/:docId/versions. Prisma, the billing store and auth/RBAC
// middleware are replaced in require.cache, so these run without a database. The fake
// Prisma understands exactly the query shapes versions.routes.js uses.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const src = (rel) => require.resolve(path.join(__dirname, '..', 'src', rel));

const state = {};

function resetState() {
  state.docs = new Map([
    ['doc-1', { id: 'doc-1', tenantId: 'tenant-1', title: 'Project Plan', content: '' }],
    ['other', { id: 'other', tenantId: 'tenant-2', title: 'Elsewhere', content: '' }],
  ]);
  state.versions = [];
  state.clock = Date.parse('2026-10-01T00:00:00Z');
}

function tick() {
  state.clock += 1000;
  return new Date(state.clock);
}

function addVersion(version) {
  const row = {
    docId: 'doc-1',
    userId: null,
    tenantId: null,
    title: null,
    isPublished: false,
    docTitle: null,
    savedAt: tick(),
    ...version,
  };
  state.versions.push(row);
  return row;
}

function matches(row, where = {}) {
  return Object.entries(where).every(([key, condition]) => {
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('in' in condition) return condition.in.includes(row[key]);
    }
    return (row[key] ?? null) === (condition ?? null);
  });
}

const newestFirst = (rows) => [...rows].sort((a, b) => b.savedAt - a.savedAt);

const prisma = {
  document: {
    findUnique: async ({ where }) => state.docs.get(where.id) || null,
  },
  version: {
    findFirst: async ({ where }) => newestFirst(state.versions.filter((v) => matches(v, where)))[0] || null,
    findMany: async ({ where, skip = 0, select }) => newestFirst(state.versions.filter((v) => matches(v, where)))
      .slice(skip)
      .map((v) => (select ? { id: v.id } : { ...v })),
    create: async ({ data }) => addVersion({ ...data, savedAt: tick() }),
    update: async ({ where, data }) => {
      const row = state.versions.find((v) => v.id === where.id);
      Object.assign(row, data);
      return { ...row };
    },
    deleteMany: async ({ where }) => {
      state.versions = state.versions.filter((v) => !matches(v, where));
      return {};
    },
  },
};

function stub(rel, exports) {
  const id = src(rel);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

stub('db/client.js', { prisma });
stub('store/index.js', { getVersionHistoryRetentionDays: async () => null });
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

const versionsRoutes = require('../src/routes/versions.routes');

const app = express();
app.use(express.json());
app.use('/api/docs/:docId/versions', versionsRoutes);

beforeEach(resetState);

const save = (body, docId = 'doc-1') => request(app).post(`/api/docs/${docId}/versions`).send(body);

test('POST commits new content with the author and tenant recorded', async () => {
  const res = await save({ content: '<p>First</p>', preview: 'first commit' });
  assert.equal(res.status, 201);
  assert.equal(res.body.version.preview, 'first commit');
  assert.equal(res.body.version.isPublished, false);
  assert.equal(state.versions.length, 1);
  assert.equal(state.versions[0].userId, 'user-1');
  assert.equal(state.versions[0].tenantId, 'tenant-1');
  assert.equal(state.versions[0].docTitle, null);
});

test('POST refuses a commit identical to the latest version with 409 NO_CHANGES', async () => {
  addVersion({ id: 'v1', content: '<p>Same</p>' });
  // Surrounding whitespace is not a change.
  const res = await save({ content: '  <p>Same</p>\n' });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'NO_CHANGES');
  assert.equal(state.versions.length, 1);
});

test('POST compares against the latest version only, so an older identical one does not block', async () => {
  addVersion({ id: 'v1', content: '<p>A</p>' });
  addVersion({ id: 'v2', content: '<p>B</p>' });
  const res = await save({ content: '<p>A</p>' });
  assert.equal(res.status, 201);
  assert.equal(state.versions.length, 3);
});

test('POST publishes new content as a published version that records the document title', async () => {
  addVersion({ id: 'v1', content: '<p>Old</p>' });
  const res = await save({ content: '<p>New</p>', published: true });
  assert.equal(res.status, 201);
  assert.equal(res.body.version.isPublished, true);
  const created = state.versions.find((v) => v.id === res.body.version.id);
  assert.equal(created.isPublished, true);
  assert.equal(created.docTitle, 'Project Plan');
});

test('POST publishing unchanged content marks the latest version as published instead of duplicating it', async () => {
  addVersion({ id: 'v1', content: '<p>Committed</p>' });
  const res = await save({ content: '<p>Committed</p>', published: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.promoted, true);
  assert.equal(res.body.version.id, 'v1');
  assert.equal(state.versions.length, 1);
  assert.equal(state.versions[0].isPublished, true);
  assert.equal(state.versions[0].docTitle, 'Project Plan');
});

test('POST publishing content that is already published returns 409 NO_CHANGES', async () => {
  addVersion({ id: 'v1', content: '<p>Live</p>', isPublished: true });
  const res = await save({ content: '<p>Live</p>', published: true });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'NO_CHANGES');
  assert.match(res.body.error, /Already published/);
});

test('POST rejects a non-boolean published flag', async () => {
  const res = await save({ content: '<p>x</p>', published: 'yes' });
  assert.equal(res.status, 400);
  assert.equal(state.versions.length, 0);
});

test('POST returns 404 for a document in another tenant', async () => {
  const res = await save({ content: '<p>x</p>' }, 'other');
  assert.equal(res.status, 404);
});

test('the 20-version cap prunes only unpublished versions', async () => {
  addVersion({ id: 'published-old', content: '<p>p</p>', isPublished: true });
  for (let i = 0; i < 20; i += 1) addVersion({ id: `c${i}`, content: `<p>${i}</p>` });

  const res = await save({ content: '<p>newest</p>' });
  assert.equal(res.status, 201);

  const ids = state.versions.map((v) => v.id);
  assert.ok(ids.includes('published-old'), 'published version survives pruning');
  assert.ok(!ids.includes('c0'), 'oldest unpublished version is pruned');
  assert.equal(state.versions.filter((v) => !v.isPublished).length, 20);
});

test('GET lists versions with their published flag', async () => {
  addVersion({ id: 'v1', content: '<p>a</p>', title: 'one' });
  addVersion({ id: 'v2', content: '<p>b</p>', title: 'two', isPublished: true });
  const res = await request(app).get('/api/docs/doc-1/versions');
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.versions.map((v) => [v.id, v.isPublished]),
    [['v2', true], ['v1', false]],
  );
});
