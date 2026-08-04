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

  assert.equal(typeof registerRes.body.verificationTokenPreview, 'string');

  await client
    .post('/api/auth/verify-email')
    .send({ token: registerRes.body.verificationTokenPreview })
    .expect(200);

  const loginRes = await client
    .post('/api/auth/login')
    .send({ email, passwordEncrypted: encryptPassword(password), remember: false })
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

test.beforeEach(async () => {
  await resetTestState();
});

test('register/login provisions a personal workspace for individual users', async () => {
  const client = request(app);
  const user = await registerVerifyLogin(client, {
    name: 'Solo User',
    email: 'solo-user@example.com',
  });

  const orgRes = await client
    .get('/api/organizations/current')
    .set(authHeader(user.token))
    .expect(200);

  const workspacesRes = await client
    .get('/api/workspaces')
    .set(authHeader(user.token))
    .expect(200);

  const personalWorkspace = workspacesRes.body.workspaces.find((workspace) => workspace.ownerId === user.user.id);
  assert.ok(personalWorkspace);
  assert.equal(personalWorkspace.organizationId, user.user.id);
});

test('accepting a tenant invite provisions a personal workspace in that tenant', async () => {
  const client = request(app);

  const owner = await registerVerifyLogin(client, {
    name: 'Tenant Owner',
    email: 'tenant-owner@example.com',
  });
  ensureTenantBootstrapForUser(users.get(owner.user.id));

  await client
    .patch('/api/billing/seats')
    .set(authHeader(owner.token))
    .send({ purchasedSeats: 2 })
    .expect(200);

  const inviteRes = await client
    .post('/api/organizations/current/invites')
    .set(authHeader(owner.token))
    .send({ email: 'tenant-member@example.com', role: 'editor', billingAdmin: false })
    .expect(201);

  assert.equal(inviteRes.body.invite.role, 'organization_member');

  const invited = await registerVerifyLogin(client, {
    name: 'Tenant Member',
    email: 'tenant-member@example.com',
  });

  await client
    .post('/api/organizations/invites/accept')
    .set(authHeader(invited.token))
    .send({ token: inviteRes.body.invite.inviteToken })
    .expect(200);

  const orgRes = await client
    .get('/api/organizations/current')
    .set(authHeader(invited.token))
    .expect(200);

  const workspacesRes = await client
    .get('/api/workspaces')
    .set(authHeader(invited.token))
    .expect(200);

  const personalWorkspace = workspacesRes.body.workspaces.find((workspace) => workspace.ownerId === invited.user.id);
  assert.ok(personalWorkspace);
  assert.equal(personalWorkspace.organizationId, invited.user.id);
});

test('personal workspace is owner-only while created workspaces are org-shared', async () => {
  const client = request(app);

  const owner = await registerVerifyLogin(client, {
    name: 'Workspace Owner',
    email: 'workspace-owner@example.com',
  });
  ensureTenantBootstrapForUser(users.get(owner.user.id));

  await client
    .patch('/api/billing/seats')
    .set(authHeader(owner.token))
    .send({ purchasedSeats: 2 })
    .expect(200);

  const inviteRes = await client
    .post('/api/organizations/current/invites')
    .set(authHeader(owner.token))
    .send({ email: 'workspace-editor@example.com', billingAdmin: false })
    .expect(201);

  const editor = await registerVerifyLogin(client, {
    name: 'Workspace Editor',
    email: 'workspace-editor@example.com',
  });

  await client
    .post('/api/organizations/invites/accept')
    .set(authHeader(editor.token))
    .send({ token: inviteRes.body.invite.inviteToken })
    .expect(200);

  const ownerList = await client
    .get('/api/workspaces')
    .set(authHeader(owner.token))
    .expect(200);

  const ownerPersonal = ownerList.body.workspaces.find((workspace) => workspace.ownerId === owner.user.id);
  assert.ok(ownerPersonal, 'owner should see own personal workspace');
  assert.equal(ownerPersonal.organizationId, owner.user.id);
  assert.equal(ownerList.body.workspaces[0]?.id, ownerPersonal.id, 'personal workspace should be listed first');

  const sharedCreate = await client
    .post('/api/workspaces')
    .set(authHeader(owner.token))
    .send({ name: 'Org Shared Workspace' })
    .expect(201);

  const sharedWorkspaceId = sharedCreate.body.workspace.id;

  const editorList = await client
    .get('/api/workspaces')
    .set(authHeader(editor.token))
    .expect(200);

  const seesOwnerPersonal = editorList.body.workspaces.some((workspace) => workspace.id === ownerPersonal.id);
  const seesShared = editorList.body.workspaces.some((workspace) => workspace.id === sharedWorkspaceId);

  assert.equal(seesOwnerPersonal, false, 'editor should not see owner personal workspace');
  assert.equal(seesShared, true, 'editor should see owner created shared workspace');
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
    .send({ email: 'editor@example.com', billingAdmin: false })
    .expect(201);

  assert.equal(typeof editorInviteRes.body.invite.inviteToken, 'string');

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

  await client
    .post('/api/organizations/current/invites')
    .set(authHeader(editor.token))
    .send({ email: 'blocked@example.com' })
    .expect(403);

  await client
    .post('/api/docs')
    .set(authHeader(editor.token))
    .send({ title: 'Editor Doc 2', content: '<p>editor-2</p>' })
    .expect(201);

  await client
    .post('/api/workspaces')
    .set(authHeader(editor.token))
    .send({ name: 'Editor Workspace' })
    .expect(201);

  await client
    .put(`/api/docs/${ownerDocId}`)
    .set(authHeader(editor.token))
    .send({ title: 'Editor Edit Attempt 2' })
    .expect(200);

  await client
    .get('/api/docs')
    .set(authHeader(editor.token))
    .expect(200);

  const profilesRes = await client
    .get('/api/organizations/profiles')
    .set(authHeader(editor.token))
    .expect(200);

  assert.ok(Array.isArray(profilesRes.body.profiles));
  assert.ok(profilesRes.body.profiles.length >= 3);
  assert.ok(profilesRes.body.profiles.some((profile) => profile.role === 'organization_member'));
  const memberProfile = profilesRes.body.profiles.find((profile) => profile.role === 'organization_member');
  assert.equal(typeof memberProfile?.canReadOrganizationResources, 'boolean');
  assert.equal(typeof memberProfile?.canManageMembers, 'boolean');

  const membersRes = await client
    .get('/api/organizations/current/members')
    .set(authHeader(owner.token))
    .expect(200);

  const editorMembership = membersRes.body.members.find((member) => member.email === 'editor@example.com');
  assert.ok(editorMembership);

  await client
    .patch(`/api/organizations/current/members/${editorMembership.id}`)
    .set(authHeader(editor.token))
    .send({ billingAdmin: true })
    .expect(403);

  await client
    .delete(`/api/organizations/current/members/${editorMembership.id}`)
    .set(authHeader(owner.token))
    .expect(200);

  await client
    .get(`/api/docs/${ownerDocId}`)
    .set(authHeader(editor.token))
    .expect(404);
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
    .send({ email: 'org-admin@example.com', billingAdmin: false })
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
    .send({ billingAdmin: false })
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

test('organization member/invite validation rejects invalid boolean and email input', async () => {
  const client = request(app);

  const owner = await registerVerifyLogin(client, {
    name: 'Validation Owner',
    email: 'validation-owner@example.com',
  });
  ensureTenantBootstrapForUser(users.get(owner.user.id));

  await client
    .patch('/api/billing/seats')
    .set(authHeader(owner.token))
    .send({ purchasedSeats: 3 })
    .expect(200);

  await client
    .post('/api/organizations/current/invites')
    .set(authHeader(owner.token))
    .send({ email: 'not-an-email', billingAdmin: false })
    .expect(400);

  await client
    .post('/api/organizations/current/invites')
    .set(authHeader(owner.token))
    .send({ email: 'validation-member@example.com', billingAdmin: 'not-boolean' })
    .expect(400);

  const inviteRes = await client
    .post('/api/organizations/current/invites')
    .set(authHeader(owner.token))
    .send({ email: 'validation-member@example.com', billingAdmin: 'false' })
    .expect(201);

  assert.equal(inviteRes.body.invite.billingAdmin, false);

  const member = await registerVerifyLogin(client, {
    name: 'Validation Member',
    email: 'validation-member@example.com',
  });

  await client
    .post('/api/organizations/invites/accept')
    .set(authHeader(member.token))
    .send({ token: inviteRes.body.invite.inviteToken })
    .expect(200);

  const membersRes = await client
    .get('/api/organizations/current/members')
    .set(authHeader(owner.token))
    .expect(200);

  const memberMembership = membersRes.body.members.find((item) => item.email === 'validation-member@example.com');
  assert.ok(memberMembership);

  await client
    .patch(`/api/organizations/current/members/${memberMembership.id}`)
    .set(authHeader(owner.token))
    .send({ billingAdmin: 'not-boolean' })
    .expect(400);

  const promoteRes = await client
    .patch(`/api/organizations/current/members/${memberMembership.id}`)
    .set(authHeader(owner.token))
    .send({ billingAdmin: 'true' })
    .expect(200);

  assert.equal(promoteRes.body.member.billingAdmin, true);
});
