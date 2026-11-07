// Route tests for POST /api/workspaces/current. Prisma and auth/RBAC middleware are replaced
// in require.cache, so these run without a database.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const src = (rel) => require.resolve(path.join(__dirname, '..', 'src', rel));

const state = {};

function resetState() {
  state.workspaces = new Map([
    ['member', { id: 'member', tenantId: 'tenant-1', ownerId: 'user-2', memberIds: [] }],
    ['inactive', { id: 'inactive', tenantId: 'tenant-2', ownerId: 'user-2', memberIds: [] }],
    ['stranger', { id: 'stranger', tenantId: 'tenant-3', ownerId: 'user-2', memberIds: [] }],
    ['hidden', { id: 'hidden', tenantId: 'tenant-1', ownerId: 'user-2', memberIds: ['user-2', 'user-3'] }],
    ['personal', { id: 'personal', tenantId: 'user-1', ownerId: 'user-1', memberIds: ['user-1'] }],
  ]);
  state.memberships = [
    { tenantId: 'tenant-1', userId: 'user-1', status: 'active' },
    { tenantId: 'tenant-2', userId: 'user-1', status: 'removed' },
    { tenantId: 'dedicated-1', userId: 'user-1', status: 'active' },
  ];
  state.tenants = new Map([
    ['dedicated-1', { id: 'dedicated-1', databaseMode: 'dedicated', databaseStatus: 'active' }],
    ['tenant-1', { id: 'tenant-1', databaseMode: 'shared', databaseStatus: 'shared' }],
  ]);
  state.dedicatedWorkspaces = new Map([
    ['dedicated-only', { id: 'dedicated-only', tenantId: 'dedicated-1', ownerId: 'user-2', memberIds: [] }],
  ]);
  state.currentTenantId = 'start';
}

const prisma = {
  workspace: {
    findUnique: async ({ where }) => state.workspaces.get(where.id) || null,
  },
  tenantMembership: {
    findFirst: async ({ where }) => state.memberships.find((m) => m.tenantId === where.tenantId
      && m.userId === where.userId
      && m.status === where.status) || null,
  },
  tenant: {
    findUnique: async ({ where }) => state.tenants.get(where.id) || null,
  },
  user: {
    update: async ({ data }) => {
      state.currentTenantId = data.currentTenantId;
      return {};
    },
  },
};

function stub(rel, exports) {
  const id = src(rel);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

const pass = (_req, _res, next) => next();

stub('db/client.js', { prisma });
stub('db/tenant-client.js', {
  tenantPrisma: prisma,
  isDedicatedTenant: (tenant) => tenant?.databaseMode === 'dedicated' && tenant?.databaseStatus === 'active',
  getTenantClient: async () => ({
    workspace: { findUnique: async ({ where }) => state.dedicatedWorkspaces.get(where.id) || null },
  }),
});
stub('store/index.js', { ensureWorkspaceForUserProvisioned: async () => null });
stub('middleware/auth/core.js', {
  requireAuth: (req, _res, next) => {
    req.user = { id: 'user-1', name: 'Ava', currentTenantId: state.currentTenantId };
    next();
  },
});
stub('middleware/rbac/index.js', { requirePermission: () => pass, resolveTenantContext: pass });
stub('middleware/entitlements/index.js', { attachEntitlements: pass });

const app = express();
app.use(express.json());
app.use('/api/workspaces', require('../src/routes/workspaces.routes'));

const setCurrent = (workspaceId) => request(app).post('/api/workspaces/current').send({ workspaceId });

beforeEach(resetState);

test('switches to the tenant of a workspace the user is a member of', async () => {
  const res = await setCurrent('member');
  assert.equal(res.status, 200);
  assert.equal(state.currentTenantId, 'tenant-1');
});

test('does not switch to a tenant the user does not belong to', async () => {
  const res = await setCurrent('stranger');
  assert.equal(res.status, 404);
  assert.equal(state.currentTenantId, 'start');
});

test('does not switch to a tenant where the membership is not active', async () => {
  const res = await setCurrent('inactive');
  assert.equal(res.status, 404);
  assert.equal(state.currentTenantId, 'start');
});

test('does not switch to a workspace the user cannot see', async () => {
  const res = await setCurrent('hidden');
  assert.equal(res.status, 404);
  assert.equal(state.currentTenantId, 'start');
});

test('a personal workspace leaves the current tenant alone', async () => {
  const res = await setCurrent('personal');
  assert.equal(res.status, 200);
  assert.equal(state.currentTenantId, 'start');
});

test('finds a workspace that only exists in the current dedicated tenant database', async () => {
  state.currentTenantId = 'dedicated-1';
  const res = await setCurrent('dedicated-only');
  assert.equal(res.status, 200);
  assert.equal(state.currentTenantId, 'dedicated-1');
});

test('does not look in a dedicated database from a shared tenant', async () => {
  state.currentTenantId = 'tenant-1';
  const res = await setCurrent('dedicated-only');
  assert.equal(res.status, 404);
  assert.equal(state.currentTenantId, 'tenant-1');
});

test('an unknown workspace is a 404', async () => {
  const res = await setCurrent('missing');
  assert.equal(res.status, 404);
  assert.equal(state.currentTenantId, 'start');
});
