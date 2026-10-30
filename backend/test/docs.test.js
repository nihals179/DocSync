// Route tests for /api/docs. Prisma, the billing store, auth/RBAC/entitlements middleware and
// the audit log are replaced in require.cache, so these run without a database. The fake
// Prisma understands exactly the query shapes docs.routes.js uses.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const src = (rel) => require.resolve(path.join(__dirname, '..', 'src', rel));

const state = {};

function resetState() {
  state.docs = new Map();
  state.comments = [];
  state.versions = [];
  state.workspaces = [];
  state.createCheck = { allowed: true };
  state.updateCheck = { allowed: true };
  state.consumed = 0;
  state.audit = [];
  state.entitlements = { limits: { storageBytes: null } };
  state.clock = Date.parse('2026-10-01T00:00:00Z');
}

function tick() {
  state.clock += 1000;
  return new Date(state.clock);
}

function addDoc(doc) {
  const row = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    workspaceId: null,
    parentId: null,
    sortOrder: 0,
    title: 'Untitled',
    content: '',
    createdAt: tick(),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...doc,
  };
  state.docs.set(row.id, row);
  return row;
}

function matches(row, where = {}) {
  return Object.entries(where).every(([key, condition]) => {
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('in' in condition) return condition.in.includes(row[key]);
      if ('not' in condition) return row[key] !== condition.not;
    }
    return (row[key] ?? null) === (condition ?? null);
  });
}

function pick(row, select) {
  if (!row || !select) return row ? { ...row } : null;
  return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
}

const docs = () => [...state.docs.values()];

const prisma = {
  document: {
    findFirst: async ({ where, select }) => pick(docs().find((d) => matches(d, where)), select),
    findMany: async ({ where, select, orderBy }) => {
      const rows = docs().filter((d) => matches(d, where));
      if (orderBy) rows.sort((a, b) => (a.sortOrder - b.sortOrder) || (b.createdAt - a.createdAt));
      return rows.map((row) => pick(row, select));
    },
    aggregate: async ({ where }) => {
      const orders = docs().filter((d) => matches(d, where)).map((d) => d.sortOrder);
      return { _min: { sortOrder: orders.length ? Math.min(...orders) : null } };
    },
    create: async ({ data }) => addDoc({ ...data, updatedAt: tick() }),
    update: async ({ where, data }) => {
      const next = { ...state.docs.get(where.id), ...data, updatedAt: tick() };
      state.docs.set(where.id, next);
      return next;
    },
    deleteMany: async ({ where }) => {
      const doomed = docs().filter((d) => matches(d, where));
      for (const d of doomed) state.docs.delete(d.id);
      const dangling = docs().find((d) => d.parentId && !state.docs.has(d.parentId));
      if (dangling) throw new Error(`foreign key violation: ${dangling.id} has a deleted parent`);
      return { count: doomed.length };
    },
  },
  comment: {
    deleteMany: async ({ where }) => {
      state.comments = state.comments.filter((c) => !matches(c, where));
      return {};
    },
  },
  version: {
    deleteMany: async ({ where }) => {
      state.versions = state.versions.filter((v) => !matches(v, where));
      return {};
    },
  },
  workspace: {
    findFirst: async ({ where }) => state.workspaces.find((w) => w.id === where.id
      && where.OR.some((scope) => scope.tenantId === w.tenantId)) || null,
  },
  $transaction: async (work) => (typeof work === 'function' ? work(prisma) : Promise.all(work)),
  $queryRaw: async (strings, ...values) => {
    const sql = strings.join('?');
    if (sql.includes('WITH RECURSIVE subtree')) {
      const [rootId, tenantId] = values;
      const root = docs().find((d) => d.id === rootId && d.tenantId === tenantId);
      if (!root) return [];
      const ids = [root.id];
      for (let i = 0; i < ids.length; i += 1) {
        for (const d of docs()) if (d.parentId === ids[i] && d.tenantId === tenantId) ids.push(d.id);
      }
      return ids.map((id) => ({ id }));
    }
    if (sql.includes('FOR UPDATE')) return [];
    if (sql.includes('SUM(')) {
      const rows = docs().filter((d) => d.tenantId === values[0]);
      return [{ total: BigInt(rows.reduce((n, d) => n + Buffer.byteLength(d.content), 0)) }];
    }
    const [previewLength, tenantId] = values;
    return docs()
      .filter((d) => d.tenantId === tenantId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ content, ...rest }) => ({ ...rest, previewSource: content.slice(0, previewLength) }));
  },
  $executeRaw: async (strings, ...values) => {
    const sql = strings.join('?');
    if (sql.includes('unnest(')) {
      const [ids, orders] = values;
      ids.forEach((id, i) => { state.docs.get(id).sortOrder = orders[i]; });
    } else if (sql.includes('SET "parentId"')) {
      const [parentId, id] = values;
      state.docs.get(id).parentId = parentId;
    } else if (sql.includes('SET "workspaceId"')) {
      const [workspaceId, ids] = values;
      ids.forEach((id) => { state.docs.get(id).workspaceId = workspaceId; });
    } else {
      throw new Error(`unexpected $executeRaw: ${sql}`);
    }
    return 1;
  },
};

function stub(rel, exports) {
  const id = src(rel);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

stub('db/client.js', { prisma });
stub('store/index.js', {
  canCreateDocuments: async () => state.createCheck,
  canUpdateDocuments: async () => state.updateCheck,
  consumeDocumentUpdates: async (_tenantId, count) => {
    state.consumed += count;
    return { allowed: true };
  },
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
stub('middleware/entitlements/index.js', {
  attachEntitlements: (req, _res, next) => {
    req.entitlements = state.entitlements;
    next();
  },
});
stub('lib/audit.js', { writeAuditLog: (entry) => state.audit.push(entry) });

const docsRoutes = require('../src/routes/docs.routes');

const app = express();
app.use(express.json());
app.use('/api/docs', docsRoutes);

beforeEach(resetState);

/** Titles of a sibling group in display order. */
function group(workspaceId, parentId) {
  return docs()
    .filter((d) => d.tenantId === 'tenant-1' && d.workspaceId === workspaceId && d.parentId === parentId)
    .sort((a, b) => (a.sortOrder - b.sortOrder) || (b.createdAt - a.createdAt))
    .map((d) => `${d.id}:${d.sortOrder}`);
}

// ─── Validation, limits and quota ───────────────────────────────────────────────

test('POST rejects a non-string or empty title with 400 instead of a database error', async () => {
  for (const title of [null, 42, { a: 1 }, '   ']) {
    const res = await request(app).post('/api/docs').send({ title });
    assert.equal(res.status, 400, `title ${JSON.stringify(title)}`);
    assert.match(res.body.error, /title/);
  }
  const tooLong = await request(app).post('/api/docs').send({ title: 'x'.repeat(256) });
  assert.equal(tooLong.status, 400);
  assert.equal(state.docs.size, 0);
});

test('POST rejects non-string content, workspaceId and parentId', async () => {
  assert.equal((await request(app).post('/api/docs').send({ content: ['a'] })).status, 400);
  assert.equal((await request(app).post('/api/docs').send({ workspaceId: 5 })).status, 400);
  assert.equal((await request(app).post('/api/docs').send({ parentId: 5 })).status, 400);
});

test('POST creates with defaults and a trimmed title', async () => {
  const res = await request(app).post('/api/docs').send({ title: '  Plan  ' });
  assert.equal(res.status, 201);
  assert.equal(res.body.doc.title, 'Plan');
  assert.equal(res.body.doc.content, '');
  assert.equal(res.body.doc.workspaceId, null);
  assert.equal(res.body.doc.parentId, null);
});

test('POST returns 402 when the plan document limit is reached', async () => {
  state.createCheck = { allowed: false, reason: 'Document limit reached (25/25) for Free plan.' };
  const res = await request(app).post('/api/docs').send({ title: 'One too many' });
  assert.equal(res.status, 402);
  assert.equal(res.body.code, 'document_limit_exceeded');
  assert.equal(state.docs.size, 0);
});

test('a null storage limit means unlimited, a finite one is enforced', async () => {
  state.entitlements = { limits: { storageBytes: null } };
  assert.equal((await request(app).post('/api/docs').send({ content: 'hello' })).status, 201);

  state.entitlements = { limits: { storageBytes: 8 } };
  const over = await request(app).post('/api/docs').send({ content: 'more than eight bytes' });
  assert.equal(over.status, 402);
  assert.equal(over.body.code, 'storage_quota_exceeded');
});

test('POST only accepts a workspace in the tenant (or personal) that the user can see', async () => {
  state.workspaces = [
    { id: 'ws-team', tenantId: 'tenant-1', ownerId: 'user-2', memberIds: ['user-2', 'user-1'] },
    { id: 'ws-private', tenantId: 'tenant-1', ownerId: 'user-2', memberIds: ['user-2', 'user-3'] },
    { id: 'ws-personal', tenantId: 'user-1', ownerId: 'user-1', memberIds: ['user-1'] },
    { id: 'ws-other-tenant', tenantId: 'tenant-2', ownerId: 'user-1', memberIds: ['user-1', 'user-9'] },
  ];
  assert.equal((await request(app).post('/api/docs').send({ workspaceId: 'ws-team' })).status, 201);
  assert.equal((await request(app).post('/api/docs').send({ workspaceId: 'ws-personal' })).status, 201);
  assert.equal((await request(app).post('/api/docs').send({ workspaceId: 'ws-private' })).status, 400);
  assert.equal((await request(app).post('/api/docs').send({ workspaceId: 'ws-other-tenant' })).status, 400);
});

test('PUT that changes nothing returns the doc without using quota or writing an audit entry', async () => {
  addDoc({ id: 'doc-1', title: 'Plan', content: '<p>x</p>' });
  for (const body of [{}, { title: 'Plan' }, { content: '<p>x</p>' }, { workspaceId: null }, { parentId: 'doc-2', sortOrder: 3 }]) {
    const res = await request(app).put('/api/docs/doc-1').send(body);
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(res.body.doc.title, 'Plan');
  }
  assert.equal(state.consumed, 0);
  assert.equal(state.audit.length, 0);
  assert.equal(state.docs.get('doc-1').updatedAt.toISOString(), '2026-10-01T00:00:00.000Z');
});

test('PUT counts title/content edits toward the update quota, but not workspace moves', async () => {
  state.workspaces = [{ id: 'ws-team', tenantId: 'tenant-1', ownerId: 'user-1', memberIds: [] }];
  addDoc({ id: 'doc-1', title: 'Plan' });

  const moved = await request(app).put('/api/docs/doc-1').send({ workspaceId: 'ws-team' });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.doc.workspaceId, 'ws-team');
  assert.equal(state.consumed, 0);

  const edited = await request(app).put('/api/docs/doc-1').send({ title: 'Plan v2' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.doc.title, 'Plan v2');
  assert.equal(state.consumed, 1);
});

test('PUT returns 402 when the monthly update limit is reached', async () => {
  addDoc({ id: 'doc-1', title: 'Plan' });
  state.updateCheck = { allowed: false, reason: 'Document update limit reached (100/100) for Free plan.' };
  const res = await request(app).put('/api/docs/doc-1').send({ title: 'Plan v2' });
  assert.equal(res.status, 402);
  assert.equal(res.body.code, 'document_update_limit_exceeded');
  assert.equal(state.docs.get('doc-1').title, 'Plan');
});

test('PUT validates the body and 404s for documents of another tenant', async () => {
  addDoc({ id: 'doc-1' });
  addDoc({ id: 'doc-other', tenantId: 'tenant-2' });
  assert.equal((await request(app).put('/api/docs/doc-1').send({ title: '' })).status, 400);
  assert.equal((await request(app).put('/api/docs/doc-other').send({ title: 'x' })).status, 404);
});

// ─── List and previews ──────────────────────────────────────────────────────────

test('GET list omits content, returns tree fields and a plain-text preview with entities decoded', async () => {
  addDoc({
    id: 'doc-1',
    sortOrder: 3,
    content: '<h1><span style="font-family:Montserrat">Meeting Notes</span></h1><p>Product &amp; Delivery&nbsp;Sync &#8212; &lt;Q4&gt;</p>',
  });
  addDoc({ id: 'doc-2', parentId: 'doc-1', sortOrder: 1 });
  const res = await request(app).get('/api/docs');
  assert.equal(res.status, 200);
  const byId = Object.fromEntries(res.body.docs.map((d) => [d.id, d]));
  assert.equal('content' in byId['doc-1'], false);
  assert.equal(byId['doc-1'].preview, 'Meeting Notes Product & Delivery Sync — <Q4>');
  assert.equal(byId['doc-1'].sortOrder, 3);
  assert.equal(byId['doc-2'].parentId, 'doc-1');
});

test('GET list preview drops a tag cut off by the content prefix', async () => {
  addDoc({
    id: 'doc-1',
    content: `<p>Case Study</p><div data-docsync-table-token="${'x'.repeat(5000)}"><table></table></div>`,
  });
  const res = await request(app).get('/api/docs');
  assert.equal(res.body.docs[0].preview, 'Case Study');
});

// ─── Tree: create, move, delete ─────────────────────────────────────────────────

test('POST places new documents at the top of their sibling list', async () => {
  addDoc({ id: 'a', sortOrder: 1 });
  addDoc({ id: 'b', sortOrder: 2 });
  const res = await request(app).post('/api/docs').send({ title: 'New' });
  assert.equal(res.status, 201);
  assert.equal(group(null, null)[0], `${res.body.doc.id}:0`);
});

test('POST with a parent creates a child in the parent workspace, at the top', async () => {
  state.workspaces = [{ id: 'ws-team', tenantId: 'tenant-1', ownerId: 'user-1', memberIds: [] }];
  addDoc({ id: 'parent', workspaceId: 'ws-team' });
  addDoc({ id: 'older-child', workspaceId: 'ws-team', parentId: 'parent', sortOrder: 1 });

  const res = await request(app).post('/api/docs').send({ title: 'Child', parentId: 'parent' });
  assert.equal(res.status, 201);
  assert.equal(res.body.doc.parentId, 'parent');
  assert.equal(res.body.doc.workspaceId, 'ws-team');
  assert.ok(res.body.doc.sortOrder < 1);
});

test('POST rejects a parent from another tenant or another workspace', async () => {
  state.workspaces = [{ id: 'ws-team', tenantId: 'tenant-1', ownerId: 'user-1', memberIds: [] }];
  addDoc({ id: 'foreign', tenantId: 'tenant-2' });
  addDoc({ id: 'root-doc' });
  assert.equal((await request(app).post('/api/docs').send({ parentId: 'foreign' })).status, 400);
  assert.equal((await request(app).post('/api/docs').send({ parentId: 'missing' })).status, 400);
  const mismatch = await request(app).post('/api/docs').send({ parentId: 'root-doc', workspaceId: 'ws-team' });
  assert.equal(mismatch.status, 400);
  assert.match(mismatch.body.error, /workspace/);
});

test('move reorders within the same group and renumbers it 1..n', async () => {
  addDoc({ id: 'a', sortOrder: 1 });
  addDoc({ id: 'b', sortOrder: 2 });
  addDoc({ id: 'c', sortOrder: 3 });
  const res = await request(app).post('/api/docs/c/move').send({ parentId: null, index: 0 });
  assert.equal(res.status, 200);
  assert.deepEqual(group(null, null), ['c:1', 'a:2', 'b:3']);
});

test('move nests a document and renumbers both the old and the new sibling groups', async () => {
  addDoc({ id: 'a', sortOrder: 1 });
  addDoc({ id: 'b', sortOrder: 2 });
  addDoc({ id: 'c', sortOrder: 3 });
  addDoc({ id: 'b-child', parentId: 'b', sortOrder: 1 });

  const res = await request(app).post('/api/docs/a/move').send({ parentId: 'b', index: 1 });
  assert.equal(res.status, 200);
  assert.equal(res.body.doc.parentId, 'b');
  assert.deepEqual(group(null, 'b'), ['b-child:1', 'a:2']);
  assert.deepEqual(group(null, null), ['b:1', 'c:2']);
});

test('move clamps an index past the end to the last position', async () => {
  addDoc({ id: 'a', sortOrder: 1 });
  addDoc({ id: 'b', sortOrder: 2 });
  await request(app).post('/api/docs/a/move').send({ parentId: null, index: 99 });
  assert.deepEqual(group(null, null), ['b:1', 'a:2']);
});

test('move into itself or its own descendant is rejected and changes nothing', async () => {
  addDoc({ id: 'a', sortOrder: 1 });
  addDoc({ id: 'child', parentId: 'a', sortOrder: 1 });
  addDoc({ id: 'grandchild', parentId: 'child', sortOrder: 1 });

  for (const parentId of ['a', 'child', 'grandchild']) {
    const res = await request(app).post('/api/docs/a/move').send({ parentId, index: 0 });
    assert.equal(res.status, 400, parentId);
    assert.equal(res.body.error, 'Cannot move a document inside itself.');
  }
  assert.equal(state.docs.get('a').parentId, null);
});

test('move to another workspace carries the whole subtree along', async () => {
  state.workspaces = [{ id: 'ws-team', tenantId: 'tenant-1', ownerId: 'user-1', memberIds: [] }];
  addDoc({ id: 'a', sortOrder: 1 });
  addDoc({ id: 'child', parentId: 'a', sortOrder: 1 });
  addDoc({ id: 'grandchild', parentId: 'child', sortOrder: 1 });
  addDoc({ id: 'existing', workspaceId: 'ws-team', sortOrder: 1 });

  const res = await request(app).post('/api/docs/a/move').send({ workspaceId: 'ws-team', parentId: null, index: 0 });
  assert.equal(res.status, 200);
  for (const id of ['a', 'child', 'grandchild']) assert.equal(state.docs.get(id).workspaceId, 'ws-team', id);
  assert.equal(state.docs.get('child').parentId, 'a');
  assert.deepEqual(group('ws-team', null), ['a:1', 'existing:2']);
});

test('PUT workspace change moves the subtree to the top of the target workspace', async () => {
  state.workspaces = [{ id: 'ws-team', tenantId: 'tenant-1', ownerId: 'user-1', memberIds: [] }];
  addDoc({ id: 'a', sortOrder: 1 });
  addDoc({ id: 'child', parentId: 'a', sortOrder: 1 });
  addDoc({ id: 'existing', workspaceId: 'ws-team', sortOrder: 1 });

  const res = await request(app).put('/api/docs/a').send({ workspaceId: 'ws-team' });
  assert.equal(res.status, 200);
  assert.equal(state.docs.get('child').workspaceId, 'ws-team');
  assert.deepEqual(group('ws-team', null), ['a:1', 'existing:2']);
});

test('move validates its body, the parent and the document', async () => {
  addDoc({ id: 'a', sortOrder: 1 });
  addDoc({ id: 'foreign', tenantId: 'tenant-2' });
  assert.equal((await request(app).post('/api/docs/a/move').send({ index: 0 })).status, 400);
  assert.equal((await request(app).post('/api/docs/a/move').send({ parentId: null, index: -1 })).status, 400);
  assert.equal((await request(app).post('/api/docs/a/move').send({ parentId: null, index: 1.5 })).status, 400);
  assert.equal((await request(app).post('/api/docs/a/move').send({ parentId: 'foreign', index: 0 })).status, 400);
  assert.equal((await request(app).post('/api/docs/missing/move').send({ parentId: null, index: 0 })).status, 404);
});

test('moves do not use the edit quota or change updatedAt, and are audited', async () => {
  addDoc({ id: 'a', sortOrder: 1 });
  addDoc({ id: 'b', sortOrder: 2 });
  await request(app).post('/api/docs/b/move').send({ parentId: 'a', index: 0 });
  assert.equal(state.consumed, 0);
  assert.equal(state.docs.get('b').updatedAt.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(state.audit.at(-1).action, 'document.move');
});

test('DELETE removes the document, its subtree and their comments and versions only', async () => {
  addDoc({ id: 'a', sortOrder: 1 });
  addDoc({ id: 'child', parentId: 'a', sortOrder: 1 });
  addDoc({ id: 'grandchild', parentId: 'child', sortOrder: 1 });
  addDoc({ id: 'sibling', sortOrder: 2 });
  state.comments = [{ id: 'c1', docId: 'child' }, { id: 'c2', docId: 'sibling' }];
  state.versions = [{ id: 'v1', docId: 'grandchild' }, { id: 'v2', docId: 'sibling' }];

  const res = await request(app).delete('/api/docs/a');
  assert.equal(res.status, 200);
  assert.equal(res.body.deletedCount, 3);
  assert.deepEqual(docs().map((d) => d.id), ['sibling']);
  assert.deepEqual(state.comments.map((c) => c.id), ['c2']);
  assert.deepEqual(state.versions.map((v) => v.id), ['v2']);
});
