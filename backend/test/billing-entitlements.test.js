const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { encryptPassword } = require('./helpers/password-crypto');

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

function clearStore() {
  auditLogs.clear();
  authSessions.clear();
  authTokens.clear();
  comments.clear();
  documents.clear();
  invoices.clear();
  organizationUsage.clear();
  organizationInvites.clear();
  organizationMemberships.clear();
  organizations.clear();
  processedWebhookEvents.clear();
  todos.clear();
  users.clear();
  versions.clear();
  webhookJobs.clear();
  workspaces.clear();
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

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

test.beforeEach(() => {
  clearStore();
});

test('checkout webhook updates subscription with trial logic and entitlements snapshot', async () => {
  const client = request(app);
  const owner = await registerVerifyLogin(client, {
    name: 'Billing Owner',
    email: 'billing-owner@example.com',
  });

  const currentOrg = await client
    .get('/api/organizations/current')
    .set(authHeader(owner.token))
    .expect(200);

  const organizationId = currentOrg.body.organization.id;

  await client
    .post('/api/billing/webhooks/provider')
    .send({
      id: 'evt_checkout_trial',
      type: 'checkout.session.completed',
      data: {
        organizationId,
        planId: 'pro',
        purchasedSeats: 5,
      },
    })
    .expect(202);

  const snapshotRes = await client
    .get('/api/billing/current')
    .set(authHeader(owner.token))
    .expect(200);

  assert.equal(snapshotRes.body.snapshot.billing.planId, 'pro');
  assert.equal(snapshotRes.body.snapshot.billing.status, 'trialing');
  assert.equal(snapshotRes.body.snapshot.limits.seatsPurchased, 5);
  assert.equal(typeof snapshotRes.body.snapshot.billing.trialEndsAt, 'string');
});

test('failed payment triggers suspension after grace window and blocks writes', async () => {
  const client = request(app);
  const owner = await registerVerifyLogin(client, {
    name: 'Grace Owner',
    email: 'grace-owner@example.com',
  });

  const currentOrg = await client
    .get('/api/organizations/current')
    .set(authHeader(owner.token))
    .expect(200);

  const organizationId = currentOrg.body.organization.id;

  await client
    .post('/api/billing/webhooks/provider')
    .send({
      id: 'evt_payment_failed_now',
      type: 'invoice.payment_failed',
      data: {
        organizationId,
        amountCents: 2900,
        graceDays: 0,
      },
    })
    .expect(202);

  const createDocRes = await client
    .post('/api/docs')
    .set(authHeader(owner.token))
    .send({ title: 'Blocked Doc', content: 'blocked due to suspension' })
    .expect(402);

  assert.equal(createDocRes.body.code, 'subscription_suspended');
});

test('seat management prevents over-assignment for new invites', async () => {
  const client = request(app);
  const owner = await registerVerifyLogin(client, {
    name: 'Seat Owner',
    email: 'seat-owner@example.com',
  });

  await client
    .patch('/api/billing/seats')
    .set(authHeader(owner.token))
    .send({ purchasedSeats: 1 })
    .expect(200);

  const inviteRes = await client
    .post('/api/organizations/current/invites')
    .set(authHeader(owner.token))
    .send({ email: 'new-member@example.com' })
    .expect(402);

  assert.equal(inviteRes.body.code, 'seat_limit_exceeded');
});
