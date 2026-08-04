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
  ensureTenantBootstrapForUser,
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

test('enterprise environment bootstrap applies enterprise billing and security baseline', async () => {
  const client = request(app);
  const owner = await registerVerifyLogin(client, {
    name: 'Enterprise Owner',
    email: 'enterprise-owner@acme.com',
  });
  ensureTenantBootstrapForUser(users.get(owner.user.id));

  const bootstrapRes = await client
    .post('/api/organizations/current/enterprise/environment')
    .set(authHeader(owner.token))
    .send({
      domains: ['acme.com', '@corp.acme.com'],
      purchasedSeats: 650,
      ssoProvider: {
        type: 'saml',
        name: 'Okta SAML',
        issuerUrl: 'https://idp.acme.com',
        ssoUrl: 'https://idp.acme.com/sso',
      },
    })
    .expect(201);

  assert.equal(bootstrapRes.body.billing.planId, 'enterprise');
  assert.equal(bootstrapRes.body.billing.purchasedSeats, 650);
  assert.equal(bootstrapRes.body.security.requireMfa, true);
  assert.equal(bootstrapRes.body.security.domainMappings.includes('acme.com'), true);
  assert.equal(bootstrapRes.body.security.ssoProviders.length, 1);
  assert.equal(bootstrapRes.body.security.ssoProviders[0].type, 'saml');
  assert.equal(bootstrapRes.body.entitlements.plan.id, 'enterprise');
});

test('enterprise security settings support SSO providers, domains, and CSV audit export', async () => {
  const client = request(app);
  const owner = await registerVerifyLogin(client, {
    name: 'Security Owner',
    email: 'owner@acme.com',
  });
  ensureTenantBootstrapForUser(users.get(owner.user.id));

  const policyRes = await client
    .put('/api/organizations/current/security/policies')
    .set(authHeader(owner.token))
    .send({
      requireMfa: true,
      sessionDurationHours: 6,
      ipAllowlistEnabled: true,
      ipAllowlist: ['1.2.3.4'],
    })
    .expect(200);

  assert.equal(policyRes.body.security.requireMfa, true);
  assert.equal(policyRes.body.security.sessionDurationHours, 6);

  await client
    .put('/api/organizations/current/security/domains')
    .set(authHeader(owner.token))
    .set('x-forwarded-for', '1.2.3.4')
    .send({ domains: ['acme.com', '@subsidiary.acme.com'] })
    .expect(200);

  const providerRes = await client
    .post('/api/organizations/current/security/sso/providers')
    .set(authHeader(owner.token))
    .set('x-forwarded-for', '1.2.3.4')
    .send({
      type: 'oidc',
      name: 'Okta Prod',
      issuerUrl: 'https://id.acme.com',
      clientId: 'acme-client-id',
      clientSecret: 'super-secret',
    })
    .expect(201);

  assert.equal(providerRes.body.provider.type, 'oidc');

  const currentRes = await client
    .get('/api/organizations/current/security')
    .set(authHeader(owner.token))
    .set('x-forwarded-for', '1.2.3.4')
    .expect(200);

  assert.equal(currentRes.body.security.domainMappings.includes('acme.com'), true);
  assert.equal(currentRes.body.security.ssoProviders.length, 1);

  await client
    .post('/api/organizations/sso/simulate-login')
    .set(authHeader(owner.token))
    .set('x-forwarded-for', '1.2.3.4')
    .send({ email: 'employee@acme.com' })
    .expect(200);

  const csvRes = await client
    .get('/api/organizations/current/audit-logs/export.csv')
    .set(authHeader(owner.token))
    .set('x-forwarded-for', '1.2.3.4')
    .expect(200);

  assert.equal(csvRes.headers['content-type'].includes('text/csv'), true);
  assert.equal(csvRes.text.startsWith('id,createdAt,organizationId,userId,action,status,metadata'), true);
});

test('ip allowlist blocks authenticated requests when address is not approved', async () => {
  const client = request(app);
  const owner = await registerVerifyLogin(client, {
    name: 'Allowlist Owner',
    email: 'allowlist@acme.com',
  });
  ensureTenantBootstrapForUser(users.get(owner.user.id));

  await client
    .put('/api/organizations/current/security/policies')
    .set(authHeader(owner.token))
    .send({
      ipAllowlistEnabled: true,
      ipAllowlist: ['10.10.10.10'],
    })
    .expect(200);

  await client
    .get('/api/docs')
    .set(authHeader(owner.token))
    .set('x-forwarded-for', '203.0.113.10')
    .expect(403);

  await client
    .get('/api/docs')
    .set(authHeader(owner.token))
    .set('x-forwarded-for', '10.10.10.10')
    .expect(200);
});

test('ip allowlist blocks new login sessions from unapproved addresses', async () => {
  const client = request(app);
  const email = 'ip-login-owner@acme.com';
  const password = 'Password123!';

  const registerRes = await client
    .post('/api/auth/register')
    .send({ name: 'IP Login Owner', email, passwordEncrypted: encryptPassword(password) })
    .expect(201);

  await client
    .post('/api/auth/verify-email')
    .send({ token: registerRes.body.verificationTokenPreview })
    .expect(200);

  const initialLogin = await client
    .post('/api/auth/login')
    .set('x-forwarded-for', '10.10.10.10')
    .send({ email, passwordEncrypted: encryptPassword(password), remember: false })
    .expect(200);

  ensureTenantBootstrapForUser(users.get(initialLogin.body.user.id));

  await client
    .put('/api/organizations/current/security/policies')
    .set(authHeader(initialLogin.body.accessToken))
    .set('x-forwarded-for', '10.10.10.10')
    .send({
      ipAllowlistEnabled: true,
      ipAllowlist: ['10.10.10.10'],
    })
    .expect(200);

  await client
    .post('/api/auth/login')
    .set('x-forwarded-for', '203.0.113.15')
    .send({ email, passwordEncrypted: encryptPassword(password), remember: false })
    .expect(403);

  await client
    .post('/api/auth/login')
    .set('x-forwarded-for', '10.10.10.10')
    .send({ email, passwordEncrypted: encryptPassword(password), remember: false })
    .expect(200);
});
