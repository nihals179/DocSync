const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { encryptPassword } = require('./helpers/password-crypto');
const { resetTestState } = require('./helpers/reset-state');

const app = require('../src/app');
const {
  auditLogs,
  authSessions,
  authTokens,
  comments,
  documents,
  invoices,
  organizationUsage,
  organizationInvites,
  organizationMemberships,
  organizations,
  processedWebhookEvents,
  todos,
  users,
  versions,
  webhookJobs,
  workspaces,
} = require('../src/store');

async function registerVerifyLogin(client, { name, email, password = 'Password123!' }) {
  const registerRes = await client
    .post('/api/auth/register')
    .send({ name, email, passwordEncrypted: encryptPassword(password) })
    .expect(201);

  await client
    .post('/api/auth/verify-email')
    .send({ token: registerRes.body.verificationTokenPreview })
    .expect(200);

  const loginRes = await client
    .post('/api/auth/login')
    .send({ email, passwordEncrypted: encryptPassword(password), remember: false })
    .expect(200);

  return {
    token: loginRes.body.accessToken,
    user: loginRes.body.user,
  };
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

test.beforeEach(async () => {
  await resetTestState();
});

test('cross-tenant organization security read is denied', async () => {
  const client = request(app);

  const alpha = await registerVerifyLogin(client, {
    name: 'Alpha Owner',
    email: 'alpha-owner@example.com',
  });
  const beta = await registerVerifyLogin(client, {
    name: 'Beta Owner',
    email: 'beta-owner@example.com',
  });

  const alphaOrgRes = await client
    .get('/api/organizations/current')
    .set(authHeader(alpha.token))
    .expect(200);

  const alphaOrgId = alphaOrgRes.body.organization.id;
  assert.equal(typeof alphaOrgId, 'string');

  await client
    .get('/api/organizations/current/security')
    .set(authHeader(beta.token))
    .set('x-organization-id', alphaOrgId)
    .expect(403);
});

test('cross-tenant organization audit export is denied', async () => {
  const client = request(app);

  const alpha = await registerVerifyLogin(client, {
    name: 'Alpha Owner',
    email: 'alpha2-owner@example.com',
  });
  const beta = await registerVerifyLogin(client, {
    name: 'Beta Owner',
    email: 'beta2-owner@example.com',
  });

  const alphaOrgRes = await client
    .get('/api/organizations/current')
    .set(authHeader(alpha.token))
    .expect(200);

  const alphaOrgId = alphaOrgRes.body.organization.id;

  await client
    .get('/api/organizations/current/audit-logs/export.csv')
    .set(authHeader(beta.token))
    .set('x-organization-id', alphaOrgId)
    .expect(403);
});
