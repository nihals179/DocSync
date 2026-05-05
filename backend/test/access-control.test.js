const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

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

async function registerVerifyLogin(client, { name, email, password = 'Password123!' }) {
  const registerRes = await client
    .post('/api/auth/register')
    .send({ name, email, password })
    .expect(201);

  assert.equal(typeof registerRes.body.verificationTokenPreview, 'string');

  await client
    .post('/api/auth/verify-email')
    .send({ token: registerRes.body.verificationTokenPreview })
    .expect(200);

  const loginRes = await client
    .post('/api/auth/login')
    .send({ email, password, remember: false })
    .expect(200);

  assert.equal(typeof loginRes.body.accessToken, 'string');
  return {
    token: loginRes.body.accessToken,
    user: loginRes.body.user,
  };
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

test.beforeEach(() => {
  clearStore();
});

test('RBAC enforcement across invite, doc, workspace, and membership APIs', async () => {
  const client = request(app);

  const owner = await registerVerifyLogin(client, {
    name: 'Owner User',
    email: 'owner@example.com',
  });
  ensureTenantBootstrapForUser(users.get(owner.user.id));

  await client
    .patch('/api/billing/seats')
    .set(authHeader(owner.token))
    .send({ purchasedSeats: 3 })
    .expect(200);

  const ownerDocRes = await client
    .post('/api/docs')
    .set(authHeader(owner.token))
    .send({ title: 'Owner Doc', content: '<p>owner</p>' })
    .expect(201);
  const ownerDocId = ownerDocRes.body.doc.id;

  const editorInviteRes = await client
    .post('/api/organizations/current/invites')
    .set(authHeader(owner.token))
    .send({ email: 'editor@example.com', role: 'editor', billingAdmin: false })
    .expect(201);

  const viewerInviteRes = await client
    .post('/api/organizations/current/invites')
    .set(authHeader(owner.token))
    .send({ email: 'viewer@example.com', role: 'viewer', billingAdmin: false })
    .expect(201);

  assert.equal(typeof editorInviteRes.body.invite.inviteToken, 'string');
  assert.equal(typeof viewerInviteRes.body.invite.inviteToken, 'string');

  const editor = await registerVerifyLogin(client, {
    name: 'Editor User',
    email: 'editor@example.com',
  });

  await client
    .post('/api/organizations/invites/accept')
    .set(authHeader(editor.token))
    .send({ token: editorInviteRes.body.invite.inviteToken })
    .expect(200);

  await client
    .post('/api/docs')
    .set(authHeader(editor.token))
    .send({ title: 'Editor Doc', content: '<p>editor</p>' })
    .expect(201);

  await client
    .put(`/api/docs/${ownerDocId}`)
    .set(authHeader(editor.token))
    .send({ title: 'Edited by editor' })
    .expect(200);

  const viewer = await registerVerifyLogin(client, {
    name: 'Viewer User',
    email: 'viewer@example.com',
  });

  await client
    .post('/api/organizations/invites/accept')
    .set(authHeader(viewer.token))
    .send({ token: viewerInviteRes.body.invite.inviteToken })
    .expect(200);

  await client
    .post('/api/organizations/current/invites')
    .set(authHeader(viewer.token))
    .send({ email: 'blocked@example.com', role: 'viewer' })
    .expect(403);

  await client
    .post('/api/docs')
    .set(authHeader(viewer.token))
    .send({ title: 'Viewer Doc', content: '<p>viewer</p>' })
    .expect(403);

  await client
    .post('/api/workspaces')
    .set(authHeader(viewer.token))
    .send({ name: 'Viewer Workspace' })
    .expect(403);

  await client
    .put(`/api/docs/${ownerDocId}`)
    .set(authHeader(viewer.token))
    .send({ title: 'Viewer Edit Attempt' })
    .expect(403);

  await client
    .get('/api/docs')
    .set(authHeader(viewer.token))
    .expect(200);

  const membersRes = await client
    .get('/api/organizations/current/members')
    .set(authHeader(owner.token))
    .expect(200);

  const viewerMembership = membersRes.body.members.find((member) => member.email === 'viewer@example.com');
  assert.ok(viewerMembership);

  await client
    .delete(`/api/organizations/current/members/${viewerMembership.id}`)
    .set(authHeader(owner.token))
    .expect(200);

  await client
    .get(`/api/docs/${ownerDocId}`)
    .set(authHeader(viewer.token))
    .expect(403);
});

test('Tenant boundaries prevent cross-organization access', async () => {
  const client = request(app);

  const alpha = await registerVerifyLogin(client, {
    name: 'Alpha Owner',
    email: 'alpha@example.com',
  });
  ensureTenantBootstrapForUser(users.get(alpha.user.id));
  const beta = await registerVerifyLogin(client, {
    name: 'Beta Owner',
    email: 'beta@example.com',
  });
  ensureTenantBootstrapForUser(users.get(beta.user.id));

  const alphaDocRes = await client
    .post('/api/docs')
    .set(authHeader(alpha.token))
    .send({ title: 'Alpha Secret', content: '<p>alpha</p>' })
    .expect(201);
  const alphaDocId = alphaDocRes.body.doc.id;

  await client
    .get(`/api/docs/${alphaDocId}`)
    .set(authHeader(beta.token))
    .expect(404);

  await client
    .post(`/api/docs/${alphaDocId}/comments`)
    .set(authHeader(beta.token))
    .send({ text: 'cross-org attempt' })
    .expect(403);

  const betaDocsRes = await client
    .get('/api/docs')
    .set(authHeader(beta.token))
    .expect(200);
  const hasAlphaDoc = betaDocsRes.body.docs.some((doc) => doc.id === alphaDocId);
  assert.equal(hasAlphaDoc, false);
});

test('Owner-only safeguards are enforced for owner membership changes', async () => {
  const client = request(app);

  const owner = await registerVerifyLogin(client, {
    name: 'Org Owner',
    email: 'org-owner@example.com',
  });
  ensureTenantBootstrapForUser(users.get(owner.user.id));

  await client
    .patch('/api/billing/seats')
    .set(authHeader(owner.token))
    .send({ purchasedSeats: 2 })
    .expect(200);

  const adminInviteRes = await client
    .post('/api/organizations/current/invites')
    .set(authHeader(owner.token))
    .send({ email: 'org-admin@example.com', role: 'admin', billingAdmin: false })
    .expect(201);

  const admin = await registerVerifyLogin(client, {
    name: 'Org Admin',
    email: 'org-admin@example.com',
  });

  await client
    .post('/api/organizations/invites/accept')
    .set(authHeader(admin.token))
    .send({ token: adminInviteRes.body.invite.inviteToken })
    .expect(200);

  const ownerMembersRes = await client
    .get('/api/organizations/current/members')
    .set(authHeader(owner.token))
    .expect(200);

  const ownerMembership = ownerMembersRes.body.members.find((member) => member.email === 'org-owner@example.com');
  const adminMembership = ownerMembersRes.body.members.find((member) => member.email === 'org-admin@example.com');

  assert.ok(ownerMembership);
  assert.ok(adminMembership);

  await client
    .patch(`/api/organizations/current/members/${ownerMembership.id}`)
    .set(authHeader(admin.token))
    .send({ role: 'viewer' })
    .expect(403);

  await client
    .delete(`/api/organizations/current/members/${ownerMembership.id}`)
    .set(authHeader(admin.token))
    .expect(403);

  await client
    .patch(`/api/organizations/current/members/${adminMembership.id}`)
    .set(authHeader(owner.token))
    .send({ billingAdmin: true })
    .expect(200);
});
