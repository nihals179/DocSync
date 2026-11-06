// Route tests for /api/docs/:docId/comments. Prisma and auth/RBAC middleware are replaced in
// require.cache, so these run without a database. The fake Prisma understands exactly the
// query shapes comments.routes.js uses.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const src = (rel) => require.resolve(path.join(__dirname, '..', 'src', rel));

const state = {};

function resetState() {
  state.docs = new Map([
    ['doc-1', { id: 'doc-1', tenantId: 'tenant-1' }],
    ['other', { id: 'other', tenantId: 'tenant-2' }],
  ]);
  state.versions = [];
  state.comments = [];
  state.retentionDays = null;
  state.clock = Date.parse('2026-10-01T00:00:00Z');
}

function tick() {
  state.clock += 1000;
  return new Date(state.clock);
}

const matches = (row, where = {}) => Object.entries(where).every(([key, condition]) => {
  if (condition && typeof condition === 'object' && 'in' in condition) return condition.in.includes(row[key]);
  if (condition && typeof condition === 'object' && 'gte' in condition) return row[key] >= condition.gte;
  return (row[key] ?? null) === (condition ?? null);
});

const prisma = {
  document: {
    findUnique: async ({ where }) => state.docs.get(where.id) || null,
  },
  version: {
    findFirst: async ({ where }) => [...state.versions]
      .filter((v) => matches(v, where))
      .sort((a, b) => b.savedAt - a.savedAt)[0] || null,
  },
  comment: {
    findMany: async ({ where }) => state.comments.filter((c) => matches(c, where)),
    create: async ({ data }) => {
      const row = { ...data, createdAt: tick(), updatedAt: new Date(state.clock) };
      state.comments.push(row);
      return { ...row };
    },
    deleteMany: async ({ where }) => {
      const before = state.comments.length;
      state.comments = state.comments.filter((c) => !matches(c, where));
      return { count: before - state.comments.length };
    },
  },
  user: {
    findMany: async () => [{ id: 'user-1', name: 'Ava' }, { id: 'user-2', name: 'Ben' }],
  },
};

function stub(rel, exports) {
  const id = src(rel);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

stub('db/client.js', { prisma });
stub('store/index.js', { getVersionHistoryRetentionDays: async () => state.retentionDays });
stub('middleware/auth/core.js', {
  requireAuth: (req, _res, next) => {
    req.user = { id: 'user-1', name: 'Ava' };
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

const commentsRoutes = require('../src/routes/comments.routes');

const app = express();
app.use(express.json());
app.use('/api/docs/:docId/comments', commentsRoutes);

beforeEach(resetState);

const addVersion = (id) => state.versions.push({ id, docId: 'doc-1', savedAt: tick() });
const post = (text, docId = 'doc-1') => request(app).post(`/api/docs/${docId}/comments`).send({ text });

test('POST pins the comment to the newest version', async () => {
  addVersion('v1');
  addVersion('v2');
  const res = await post('Looks good');
  assert.equal(res.status, 201);
  assert.equal(res.body.comment.versionId, 'v2');
  assert.equal(res.body.comment.userName, 'Ava');
  assert.equal(state.comments[0].versionId, 'v2');
});

test('POST on a document with no versions makes a draft comment', async () => {
  const res = await post('First thoughts');
  assert.equal(res.status, 201);
  assert.equal(res.body.comment.versionId, null);
});

test('GET returns each comment with its version and the current version id', async () => {
  addVersion('v1');
  await post('On v1');
  addVersion('v2');
  await post('On v2');
  const res = await request(app).get('/api/docs/doc-1/comments');
  assert.equal(res.status, 200);
  assert.equal(res.body.currentVersionId, 'v2');
  assert.deepEqual(res.body.comments.map((c) => [c.text, c.versionId]), [['On v1', 'v1'], ['On v2', 'v2']]);
});

test('GET reports no current version for a document without versions', async () => {
  const res = await request(app).get('/api/docs/doc-1/comments');
  assert.equal(res.status, 200);
  assert.equal(res.body.currentVersionId, null);
  assert.deepEqual(res.body.comments, []);
});

test('POST rejects empty text', async () => {
  const res = await post('   ');
  assert.equal(res.status, 400);
});

test('another tenant\'s document is not found', async () => {
  assert.equal((await post('Hi', 'other')).status, 404);
  assert.equal((await request(app).get('/api/docs/other/comments')).status, 404);
});

test('after a restore, the restored version is current and new comments go on it', async () => {
  addVersion('v1');
  addVersion('v2');
  state.docs.get('doc-1').baseVersionId = 'v1';
  const res = await post('On the restored version');
  assert.equal(res.body.comment.versionId, 'v1');
  const list = await request(app).get('/api/docs/doc-1/comments');
  assert.equal(list.body.currentVersionId, 'v1');
});

test('a deleted base version falls back to the newest version', async () => {
  addVersion('v1');
  addVersion('v2');
  state.docs.get('doc-1').baseVersionId = 'gone';
  const list = await request(app).get('/api/docs/doc-1/comments');
  assert.equal(list.body.currentVersionId, 'v2');
  assert.equal((await post('Hi')).body.comment.versionId, 'v2');
});

const DAY = 86400000;
const addAged = (id, daysAgo) => state.versions.push({ id, docId: 'doc-1', savedAt: new Date(Date.now() - daysAgo * DAY) });

test('a base version outside the history window falls back to the newest retained one', async () => {
  addAged('old', 40);
  addAged('mid', 10);
  addAged('new', 5);
  state.docs.get('doc-1').baseVersionId = 'old';
  state.retentionDays = 30;
  const list = await request(app).get('/api/docs/doc-1/comments');
  assert.equal(list.body.currentVersionId, 'new');
  assert.equal((await post('Hi')).body.comment.versionId, 'new');
});

test('with every version outside the history window, new comments are drafts', async () => {
  addAged('old', 40);
  state.docs.get('doc-1').baseVersionId = 'old';
  state.retentionDays = 30;
  const list = await request(app).get('/api/docs/doc-1/comments');
  assert.equal(list.body.currentVersionId, null);
  assert.equal((await post('Hi')).body.comment.versionId, null);
});
