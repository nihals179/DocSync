const { PrismaClient } = require('@prisma/client');
const { getSecret } = require('../config/key-vault');
const { basePrisma } = require('./client');
const { AsyncLocalStorage } = require('node:async_hooks');

const clients = new Map();
const tenantClientStorage = new AsyncLocalStorage();
const MAX_CLIENTS = Number(process.env.TENANT_DB_MAX_CLIENTS || 100);

function isDedicatedTenant(tenant) {
  return tenant?.databaseMode === 'dedicated' && tenant?.databaseStatus === 'active';
}

async function getTenantClient(tenant) {
  if (!isDedicatedTenant(tenant)) return basePrisma;
  if (!tenant.databaseSecretName) {
    throw new Error(`Dedicated database secret is not configured for tenant ${tenant.id}.`);
  }

  const existing = clients.get(tenant.id);
  if (existing) return existing.client;
  if (clients.size >= MAX_CLIENTS) {
    throw new Error('The tenant database connection limit has been reached.');
  }

  const databaseUrl = await getSecret(tenant.databaseSecretName);
  const client = new PrismaClient({
    datasourceUrl: databaseUrl,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
  await client.$connect();
  clients.set(tenant.id, { client, secretName: tenant.databaseSecretName });
  return client;
}

async function disconnectTenantClient(tenantId) {
  const entry = clients.get(tenantId);
  if (!entry) return;
  clients.delete(tenantId);
  await entry.client.$disconnect();
}

async function disconnectAllTenantClients() {
  await Promise.all([...clients.keys()].map(disconnectTenantClient));
}

const tenantPrisma = new Proxy({}, {
  get(_target, property) {
    const client = tenantClientStorage.getStore() || basePrisma;
    const value = client[property];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

function runWithTenantClient(client, callback) {
  return tenantClientStorage.run(client, callback);
}

module.exports = {
  disconnectAllTenantClients,
  disconnectTenantClient,
  getTenantClient,
  isDedicatedTenant,
  runWithTenantClient,
  tenantPrisma,
};
