'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { generateSync: _totpGenSync } = require('@otplib/totp');
const { NobleCryptoPlugin: _NobleCryptoPlugin } = require('@otplib/plugin-crypto-noble');
const { ScureBase32Plugin: _ScureBase32Plugin } = require('@otplib/plugin-base32-scure');

// Helper: generate a valid TOTP code for the given base32 secret
const _totpPlugins = { crypto: new _NobleCryptoPlugin(), base32: new _ScureBase32Plugin() };
function generateTOTPCode(secret) {
  return _totpGenSync({ secret, ..._totpPlugins });
}

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/**
 * Register → verify email → login.
 * Returns { token, user, csrfToken, loginRes }
 */
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
    csrfToken: loginRes.body.csrfToken,
    loginRes,
  };
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

test.beforeEach(() => {
  clearStore();
});

// ===========================================================================
// Registration
// ===========================================================================

test('POST /register - creates account, returns 201 with verificationTokenPreview', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Alice', email: 'alice@example.com', password: 'Password123!' })
    .expect(201);

  assert.equal(res.body.verificationRequired, true);
  assert.equal(typeof res.body.verificationTokenPreview, 'string');
  assert.equal(res.body.user.email, 'alice@example.com');
  assert.equal(res.body.user.emailVerified, false);
});

test('POST /register - missing name returns 400', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email: 'a@example.com', password: 'Password123!' })
    .expect(400);

  assert.match(res.body.error, /required/i);
});

test('POST /register - missing email returns 400', async () => {
  await request(app)
    .post('/api/auth/register')
    .send({ name: 'Alice', password: 'Password123!' })
    .expect(400);
});

test('POST /register - missing password returns 400', async () => {
  await request(app)
    .post('/api/auth/register')
    .send({ name: 'Alice', email: 'a@example.com' })
    .expect(400);
});

test('POST /register - invalid email format returns 400', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Alice', email: 'not-an-email', password: 'Password123!' })
    .expect(400);

  assert.match(res.body.error, /invalid email/i);
});

test('POST /register - password shorter than 8 chars returns 400', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Alice', email: 'alice@example.com', password: 'abc' })
    .expect(400);

  assert.match(res.body.error, /8 characters/i);
});

test('POST /register - duplicate email returns 409', async () => {
  const client = request(app);
  await client
    .post('/api/auth/register')
    .send({ name: 'Alice', email: 'dup@example.com', password: 'Password123!' })
    .expect(201);

  const res = await client
    .post('/api/auth/register')
    .send({ name: 'Alice2', email: 'dup@example.com', password: 'Password123!' })
    .expect(409);

  assert.match(res.body.error, /already exists/i);
});

test('POST /register - email is normalized to lowercase', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Alice', email: 'ALICE@EXAMPLE.COM', password: 'Password123!' })
    .expect(201);

  assert.equal(res.body.user.email, 'alice@example.com');
});

// ===========================================================================
// Email verification
// ===========================================================================

test('POST /verify-email - valid token marks email as verified', async () => {
  const client = request(app);
  const regRes = await client
    .post('/api/auth/register')
    .send({ name: 'Bob', email: 'bob@example.com', password: 'Password123!' })
    .expect(201);

  const res = await client
    .post('/api/auth/verify-email')
    .send({ token: regRes.body.verificationTokenPreview })
    .expect(200);

  assert.match(res.body.message, /verified/i);

  const user = [...users.values()].find((u) => u.email === 'bob@example.com');
  assert.equal(user.emailVerified, true);
});

test('POST /verify-email - missing token returns 400', async () => {
  await request(app).post('/api/auth/verify-email').send({}).expect(400);
});

test('POST /verify-email - invalid token returns 400', async () => {
  const res = await request(app)
    .post('/api/auth/verify-email')
    .send({ token: 'totally-bogus-token' })
    .expect(400);

  assert.match(res.body.error, /invalid or expired/i);
});

test('POST /verify-email - token is single-use (consumed after first use)', async () => {
  const client = request(app);
  const regRes = await client
    .post('/api/auth/register')
    .send({ name: 'Bob', email: 'onetime@example.com', password: 'Password123!' })
    .expect(201);

  const { verificationTokenPreview: token } = regRes.body;

  await client.post('/api/auth/verify-email').send({ token }).expect(200);
  await client.post('/api/auth/verify-email').send({ token }).expect(400);
});

// ===========================================================================
// Resend verification
// ===========================================================================

test('POST /resend-verification - issues new token for unverified user', async () => {
  const client = request(app);
  await client
    .post('/api/auth/register')
    .send({ name: 'Carol', email: 'carol@example.com', password: 'Password123!' })
    .expect(201);

  const res = await client
    .post('/api/auth/resend-verification')
    .send({ email: 'carol@example.com' })
    .expect(200);

  assert.equal(typeof res.body.verificationTokenPreview, 'string');
});

test('POST /resend-verification - missing email returns 400', async () => {
  await request(app).post('/api/auth/resend-verification').send({}).expect(400);
});

test('POST /resend-verification - unknown email returns 404', async () => {
  await request(app)
    .post('/api/auth/resend-verification')
    .send({ email: 'ghost@example.com' })
    .expect(404);
});

test('POST /resend-verification - already-verified user returns 400', async () => {
  const client = request(app);
  const regRes = await client
    .post('/api/auth/register')
    .send({ name: 'Carol', email: 'verified@example.com', password: 'Password123!' })
    .expect(201);

  await client
    .post('/api/auth/verify-email')
    .send({ token: regRes.body.verificationTokenPreview })
    .expect(200);

  const res = await client
    .post('/api/auth/resend-verification')
    .send({ email: 'verified@example.com' })
    .expect(400);

  assert.match(res.body.error, /already verified/i);
});

// ===========================================================================
// Login
// ===========================================================================

test('POST /login - valid credentials return accessToken, csrfToken, and set cookies', async () => {
  const client = request.agent(app);
  const regRes = await client
    .post('/api/auth/register')
    .send({ name: 'Dave', email: 'dave@example.com', password: 'Password123!' })
    .expect(201);

  await client
    .post('/api/auth/verify-email')
    .send({ token: regRes.body.verificationTokenPreview })
    .expect(200);

  const res = await client
    .post('/api/auth/login')
    .send({ email: 'dave@example.com', password: 'Password123!', remember: false })
    .expect(200);

  assert.equal(typeof res.body.accessToken, 'string');
  assert.equal(typeof res.body.csrfToken, 'string');
  assert.ok(res.headers['set-cookie'], 'response should set cookies');
  assert.ok(res.body.session?.id, 'session id should be present');
});

test('POST /login - missing credentials returns 400', async () => {
  await request(app).post('/api/auth/login').send({}).expect(400);
  await request(app).post('/api/auth/login').send({ email: 'x@x.com' }).expect(400);
  await request(app).post('/api/auth/login').send({ password: 'Password123!' }).expect(400);
});

test('POST /login - unknown user returns 401', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'nobody@example.com', password: 'Password123!' })
    .expect(401);

  assert.match(res.body.error, /invalid credentials/i);
});

test('POST /login - wrong password returns 401 with attempts-remaining message', async () => {
  const client = request(app);
  const regRes = await client
    .post('/api/auth/register')
    .send({ name: 'Eve', email: 'eve@example.com', password: 'Password123!' })
    .expect(201);

  await client
    .post('/api/auth/verify-email')
    .send({ token: regRes.body.verificationTokenPreview })
    .expect(200);

  const res = await client
    .post('/api/auth/login')
    .send({ email: 'eve@example.com', password: 'WrongPassword!' })
    .expect(401);

  assert.match(res.body.error, /attempts remaining/i);
});

test('POST /login - unverified email returns 403', async () => {
  const client = request(app);
  await client
    .post('/api/auth/register')
    .send({ name: 'Frank', email: 'frank@example.com', password: 'Password123!' })
    .expect(201);

  const res = await client
    .post('/api/auth/login')
    .send({ email: 'frank@example.com', password: 'Password123!' })
    .expect(403);

  assert.match(res.body.error, /verify your email/i);
});

test('POST /login - 5 consecutive wrong passwords lock the account (423)', async () => {
  const client = request(app);
  const regRes = await client
    .post('/api/auth/register')
    .send({ name: 'Grace', email: 'grace@example.com', password: 'Password123!' })
    .expect(201);

  await client
    .post('/api/auth/verify-email')
    .send({ token: regRes.body.verificationTokenPreview })
    .expect(200);

  for (let i = 0; i < 5; i++) {
    await client
      .post('/api/auth/login')
      .send({ email: 'grace@example.com', password: 'WrongPass!' });
  }

  const res = await client
    .post('/api/auth/login')
    .send({ email: 'grace@example.com', password: 'Password123!' })
    .expect(423);

  assert.match(res.body.error, /locked/i);
});

test('POST /login - remember=true creates a long-lived session', async () => {
  const client = request.agent(app);
  const regRes = await client
    .post('/api/auth/register')
    .send({ name: 'Heidi', email: 'heidi@example.com', password: 'Password123!' })
    .expect(201);

  await client
    .post('/api/auth/verify-email')
    .send({ token: regRes.body.verificationTokenPreview })
    .expect(200);

  const res = await client
    .post('/api/auth/login')
    .send({ email: 'heidi@example.com', password: 'Password123!', remember: true })
    .expect(200);

  const session = authSessions.get(res.body.session.id);
  assert.equal(session.remember, true);
});

test('POST /login - successful login resets failed-attempt counter', async () => {
  const client = request(app);
  const regRes = await client
    .post('/api/auth/register')
    .send({ name: 'Ivan', email: 'ivan@example.com', password: 'Password123!' })
    .expect(201);

  await client
    .post('/api/auth/verify-email')
    .send({ token: regRes.body.verificationTokenPreview })
    .expect(200);

  // One bad attempt
  await client
    .post('/api/auth/login')
    .send({ email: 'ivan@example.com', password: 'Bad!' })
    .expect(401);

  // Correct attempt should succeed
  await client
    .post('/api/auth/login')
    .send({ email: 'ivan@example.com', password: 'Password123!' })
    .expect(200);

  const user = [...users.values()].find((u) => u.email === 'ivan@example.com');
  assert.equal(user.failedLoginAttempts, 0);
  assert.equal(user.lockoutUntil, null);
});

// ===========================================================================
// Refresh
// ===========================================================================

test('POST /refresh - valid refresh rotates to a new accessToken', async () => {
  const client = request.agent(app);

  const { csrfToken } = await registerVerifyLogin(client, {
    name: 'Judy',
    email: 'judy@example.com',
  });

  const res = await client
    .post('/api/auth/refresh')
    .set('x-csrf-token', csrfToken)
    .expect(200);

  assert.equal(typeof res.body.accessToken, 'string');
  assert.equal(typeof res.body.csrfToken, 'string');
  // CSRF token must rotate on every refresh
  assert.notEqual(res.body.csrfToken, csrfToken);
});

test('POST /refresh - no refresh cookie returns 401', async () => {
  await request(app).post('/api/auth/refresh').expect(401);
});

test('POST /refresh - missing CSRF header returns 403', async () => {
  const client = request.agent(app);

  await registerVerifyLogin(client, {
    name: 'Karl',
    email: 'karl@example.com',
  });

  // Cookie carried by agent, but no CSRF header
  await client.post('/api/auth/refresh').expect(403);
});

test('POST /refresh - wrong CSRF header returns 403', async () => {
  const client = request.agent(app);

  await registerVerifyLogin(client, {
    name: 'Lara',
    email: 'lara@example.com',
  });

  await client
    .post('/api/auth/refresh')
    .set('x-csrf-token', 'not-the-right-token')
    .expect(403);
});

test('POST /refresh - after logout the refresh cookie is invalid', async () => {
  const client = request.agent(app);

  const { token, csrfToken } = await registerVerifyLogin(client, {
    name: 'Mike',
    email: 'mike@example.com',
  });

  await client.post('/api/auth/logout').set(authHeader(token)).expect(200);

  await client
    .post('/api/auth/refresh')
    .set('x-csrf-token', csrfToken)
    .expect(401);
});

// ===========================================================================
// Logout
// ===========================================================================

test('POST /logout - revokes session and clears auth cookies', async () => {
  const client = request.agent(app);

  const { token } = await registerVerifyLogin(client, {
    name: 'Nina',
    email: 'nina@example.com',
  });

  const res = await client.post('/api/auth/logout').set(authHeader(token)).expect(200);
  assert.match(res.body.message, /logged out/i);
});

test('POST /logout - unauthenticated request returns 401', async () => {
  await request(app).post('/api/auth/logout').expect(401);
});

test('POST /logout - revoked session is no longer listed in /sessions', async () => {
  const client = request(app);

  const { token } = await registerVerifyLogin(client, {
    name: 'Olivia',
    email: 'olivia@example.com',
  });

  await client.post('/api/auth/logout').set(authHeader(token)).expect(200);

  // Active-session check must fail because the only session was revoked
  const sessionsRes = await client.get('/api/auth/sessions').set(authHeader(token)).expect(401);
  assert.ok(sessionsRes.body.error);
});

// ===========================================================================
// GET /me
// ===========================================================================

test('GET /me - returns user, session, and csrfToken for authenticated request', async () => {
  const client = request(app);
  const { token } = await registerVerifyLogin(client, {
    name: 'Paul',
    email: 'paul@example.com',
  });

  const res = await client.get('/api/auth/me').set(authHeader(token)).expect(200);

  assert.ok(res.body.user, 'user should be present');
  assert.ok(res.body.session, 'session should be present');
  assert.equal(typeof res.body.csrfToken, 'string');
  assert.equal(res.body.user.email, 'paul@example.com');
});

test('GET /me - no Authorization header returns 401', async () => {
  await request(app).get('/api/auth/me').expect(401);
});

test('GET /me - tampered JWT returns 401', async () => {
  await request(app)
    .get('/api/auth/me')
    .set('Authorization', 'Bearer not.a.valid.jwt')
    .expect(401);
});

// ===========================================================================
// Sessions
// ===========================================================================

test('GET /sessions - lists active sessions for the authenticated user', async () => {
  const client = request(app);
  const { token } = await registerVerifyLogin(client, {
    name: 'Quinn',
    email: 'quinn@example.com',
  });

  const res = await client.get('/api/auth/sessions').set(authHeader(token)).expect(200);

  assert.ok(Array.isArray(res.body.sessions));
  assert.ok(res.body.sessions.length > 0, 'at least one active session');
  const s = res.body.sessions[0];
  assert.equal(typeof s.id, 'string');
  assert.equal(typeof s.current, 'boolean');
});

test('DELETE /sessions/:id - revokes a specific session', async () => {
  const client = request(app);
  const { token } = await registerVerifyLogin(client, {
    name: 'Rita',
    email: 'rita@example.com',
  });

  const sessionsRes = await client.get('/api/auth/sessions').set(authHeader(token)).expect(200);
  const sessionId = sessionsRes.body.sessions[0].id;

  const res = await client
    .delete(`/api/auth/sessions/${sessionId}`)
    .set(authHeader(token))
    .expect(200);

  assert.match(res.body.message, /revoked/i);
});

test('DELETE /sessions/:id - non-existent session returns 404', async () => {
  const client = request(app);
  const { token } = await registerVerifyLogin(client, {
    name: 'Sam',
    email: 'sam@example.com',
  });

  await client
    .delete('/api/auth/sessions/00000000-0000-0000-0000-000000000000')
    .set(authHeader(token))
    .expect(404);
});

test('DELETE /sessions/:id - cannot revoke another users session', async () => {
  const client = request(app);

  const { token: tokenA } = await registerVerifyLogin(client, {
    name: 'Alice',
    email: 'alice-s@example.com',
  });

  const { loginRes } = await registerVerifyLogin(client, {
    name: 'Bob',
    email: 'bob-s@example.com',
  });

  const bobSessionId = loginRes.body.session.id;

  // Alice tries to delete Bob's session
  await client
    .delete(`/api/auth/sessions/${bobSessionId}`)
    .set(authHeader(tokenA))
    .expect(404);
});

test('POST /sessions/revoke-all - revokes all sessions and clears cookies', async () => {
  const client = request(app);
  const { token } = await registerVerifyLogin(client, {
    name: 'Tina',
    email: 'tina@example.com',
  });

  const res = await client
    .post('/api/auth/sessions/revoke-all')
    .set(authHeader(token))
    .expect(200);

  assert.match(res.body.message, /revoked/i);
});

// ===========================================================================
// Forgot password
// ===========================================================================

test('POST /forgot-password - returns resetTokenPreview in dev mode', async () => {
  const client = request(app);
  await registerVerifyLogin(client, { name: 'Uma', email: 'uma@example.com' });

  const res = await client
    .post('/api/auth/forgot-password')
    .send({ email: 'uma@example.com' })
    .expect(200);

  assert.equal(typeof res.body.resetTokenPreview, 'string');
  assert.match(res.body.message, /generated/i);
});

test('POST /forgot-password - unknown email still returns 200 (no info disclosure)', async () => {
  const res = await request(app)
    .post('/api/auth/forgot-password')
    .send({ email: 'ghost@example.com' })
    .expect(200);

  assert.equal(res.body.resetTokenPreview, undefined);
  assert.match(res.body.message, /generated/i);
});

test('POST /forgot-password - missing email returns 400', async () => {
  await request(app).post('/api/auth/forgot-password').send({}).expect(400);
});

// ===========================================================================
// Reset password
// ===========================================================================

test('POST /reset-password - valid token updates password and allows new login', async () => {
  const client = request(app);
  await registerVerifyLogin(client, { name: 'Victor', email: 'victor@example.com' });

  const forgotRes = await client
    .post('/api/auth/forgot-password')
    .send({ email: 'victor@example.com' })
    .expect(200);

  const res = await client
    .post('/api/auth/reset-password')
    .send({ token: forgotRes.body.resetTokenPreview, password: 'NewPassword456!' })
    .expect(200);

  assert.match(res.body.message, /updated/i);

  // New password must work
  await client
    .post('/api/auth/login')
    .send({ email: 'victor@example.com', password: 'NewPassword456!' })
    .expect(200);
});

test('POST /reset-password - invalid token returns 400', async () => {
  const res = await request(app)
    .post('/api/auth/reset-password')
    .send({ token: 'bogus-token', password: 'NewPassword456!' })
    .expect(400);

  assert.match(res.body.error, /invalid or expired/i);
});

test('POST /reset-password - token is single-use', async () => {
  const client = request(app);
  await registerVerifyLogin(client, { name: 'Wendy', email: 'wendy@example.com' });

  const forgotRes = await client
    .post('/api/auth/forgot-password')
    .send({ email: 'wendy@example.com' })
    .expect(200);

  const { resetTokenPreview: token } = forgotRes.body;

  await client
    .post('/api/auth/reset-password')
    .send({ token, password: 'NewPassword456!' })
    .expect(200);

  // Second use of same token must fail
  await client
    .post('/api/auth/reset-password')
    .send({ token, password: 'AnotherPassword789!' })
    .expect(400);
});

test('POST /reset-password - short new password returns 400', async () => {
  const client = request(app);
  await registerVerifyLogin(client, { name: 'Xena', email: 'xena@example.com' });

  const forgotRes = await client
    .post('/api/auth/forgot-password')
    .send({ email: 'xena@example.com' })
    .expect(200);

  const res = await client
    .post('/api/auth/reset-password')
    .send({ token: forgotRes.body.resetTokenPreview, password: 'abc' })
    .expect(400);

  assert.match(res.body.error, /8 characters/i);
});

test('POST /reset-password - missing fields returns 400', async () => {
  await request(app)
    .post('/api/auth/reset-password')
    .send({ password: 'NewPassword456!' })
    .expect(400);

  await request(app)
    .post('/api/auth/reset-password')
    .send({ token: 'sometoken' })
    .expect(400);
});

test('POST /reset-password - revokes all existing sessions', async () => {
  const client = request(app);
  const { token } = await registerVerifyLogin(client, {
    name: 'Yara',
    email: 'yara@example.com',
  });

  const forgotRes = await client
    .post('/api/auth/forgot-password')
    .send({ email: 'yara@example.com' })
    .expect(200);

  await client
    .post('/api/auth/reset-password')
    .send({ token: forgotRes.body.resetTokenPreview, password: 'NewPassword456!' })
    .expect(200);

  // Old access token must no longer be valid
  await client.get('/api/auth/me').set(authHeader(token)).expect(401);
});

// ===========================================================================
// Audit logs + security overview
// ===========================================================================

test('GET /audit-logs - returns log array for authenticated user', async () => {
  const client = request(app);
  const { token } = await registerVerifyLogin(client, {
    name: 'Zach',
    email: 'zach@example.com',
  });

  const res = await client.get('/api/auth/audit-logs').set(authHeader(token)).expect(200);
  assert.ok(Array.isArray(res.body.logs));
});

test('GET /audit-logs - unauthenticated returns 401', async () => {
  await request(app).get('/api/auth/audit-logs').expect(401);
});

test('GET /security - returns user and activeSessions count', async () => {
  const client = request(app);
  const { token } = await registerVerifyLogin(client, {
    name: 'Amy',
    email: 'amy@example.com',
  });

  const res = await client.get('/api/auth/security').set(authHeader(token)).expect(200);
  assert.ok(res.body.user);
  assert.equal(typeof res.body.activeSessions, 'number');
  assert.ok(res.body.activeSessions >= 1);
});

// ===========================================================================
// Two-factor authentication
// ===========================================================================

test('POST /2fa/setup - returns secret, otpauth URL, and QR data URL', async () => {
  const client = request(app);
  const { token } = await registerVerifyLogin(client, {
    name: 'Ben',
    email: 'ben@example.com',
  });

  const res = await client.post('/api/auth/2fa/setup').set(authHeader(token)).expect(200);

  assert.equal(typeof res.body.secret, 'string');
  assert.ok(res.body.secret.length > 0);
  assert.match(res.body.otpauth, /^otpauth:\/\/totp\//);
  assert.match(res.body.qrDataUrl, /^data:image\//);
});

test('POST /2fa/enable - valid TOTP code enables 2FA', async () => {
  const client = request(app);
  const { token } = await registerVerifyLogin(client, {
    name: 'Chloe',
    email: 'chloe@example.com',
  });

  const setupRes = await client.post('/api/auth/2fa/setup').set(authHeader(token)).expect(200);
  const code = generateTOTPCode(setupRes.body.secret);

  const res = await client
    .post('/api/auth/2fa/enable')
    .set(authHeader(token))
    .send({ code })
    .expect(200);

  assert.equal(res.body.user.twoFactorEnabled, true);
});

test('POST /2fa/enable - invalid code returns 400', async () => {
  const client = request(app);
  const { token } = await registerVerifyLogin(client, {
    name: 'Dan',
    email: 'dan@example.com',
  });

  await client.post('/api/auth/2fa/setup').set(authHeader(token)).expect(200);

  const res = await client
    .post('/api/auth/2fa/enable')
    .set(authHeader(token))
    .send({ code: '000000' })
    .expect(400);

  assert.match(res.body.error, /invalid/i);
});

test('POST /2fa/enable - missing code returns 400', async () => {
  const client = request(app);
  const { token } = await registerVerifyLogin(client, {
    name: 'Ella',
    email: 'ella@example.com',
  });

  await client.post('/api/auth/2fa/setup').set(authHeader(token)).expect(200);

  const res = await client
    .post('/api/auth/2fa/enable')
    .set(authHeader(token))
    .send({})
    .expect(400);

  assert.match(res.body.error, /required/i);
});

test('POST /2fa/enable - enabling before setup returns 400', async () => {
  const client = request(app);
  const { token } = await registerVerifyLogin(client, {
    name: 'Finn',
    email: 'finn@example.com',
  });

  const res = await client
    .post('/api/auth/2fa/enable')
    .set(authHeader(token))
    .send({ code: '123456' })
    .expect(400);

  assert.match(res.body.error, /not been started/i);
});

test('POST /login - 2FA-enabled account returns 202 with tempToken', async () => {
  const client = request(app);
  const { token } = await registerVerifyLogin(client, {
    name: 'Gina',
    email: 'gina@example.com',
  });

  const setupRes = await client.post('/api/auth/2fa/setup').set(authHeader(token)).expect(200);
  const code = generateTOTPCode(setupRes.body.secret);
  await client.post('/api/auth/2fa/enable').set(authHeader(token)).send({ code }).expect(200);

  const loginRes = await client
    .post('/api/auth/login')
    .send({ email: 'gina@example.com', password: 'Password123!' })
    .expect(202);

  assert.equal(loginRes.body.requiresTwoFactor, true);
  assert.equal(typeof loginRes.body.tempToken, 'string');
});

test('POST /login/2fa - valid code completes login and returns accessToken', async () => {
  const client = request(app);
  const { token } = await registerVerifyLogin(client, {
    name: 'Harry',
    email: 'harry@example.com',
  });

  const setupRes = await client.post('/api/auth/2fa/setup').set(authHeader(token)).expect(200);
  const { secret } = setupRes.body;

  await client
    .post('/api/auth/2fa/enable')
    .set(authHeader(token))
    .send({ code: generateTOTPCode(secret) })
    .expect(200);

  const loginRes = await client
    .post('/api/auth/login')
    .send({ email: 'harry@example.com', password: 'Password123!' })
    .expect(202);

  const res = await client
    .post('/api/auth/login/2fa')
    .send({ tempToken: loginRes.body.tempToken, code: generateTOTPCode(secret) })
    .expect(200);

  assert.equal(typeof res.body.accessToken, 'string');
  assert.equal(typeof res.body.csrfToken, 'string');
});

test('POST /login/2fa - invalid TOTP code returns 401', async () => {
  const client = request(app);
  const { token } = await registerVerifyLogin(client, {
    name: 'Iris',
    email: 'iris@example.com',
  });

  const setupRes = await client.post('/api/auth/2fa/setup').set(authHeader(token)).expect(200);
  const { secret } = setupRes.body;

  await client
    .post('/api/auth/2fa/enable')
    .set(authHeader(token))
    .send({ code: generateTOTPCode(secret) })
    .expect(200);

  const loginRes = await client
    .post('/api/auth/login')
    .send({ email: 'iris@example.com', password: 'Password123!' })
    .expect(202);

  const res = await client
    .post('/api/auth/login/2fa')
    .send({ tempToken: loginRes.body.tempToken, code: '000000' })
    .expect(401);

  assert.match(res.body.error, /invalid/i);
});

test('POST /login/2fa - expired or invalid tempToken returns 400', async () => {
  const res = await request(app)
    .post('/api/auth/login/2fa')
    .send({ tempToken: 'not-a-jwt-at-all', code: '123456' })
    .expect(400);

  assert.match(res.body.error, /invalid or expired/i);
});

test('POST /login/2fa - missing fields returns 400', async () => {
  await request(app)
    .post('/api/auth/login/2fa')
    .send({ code: '123456' })
    .expect(400);

  await request(app)
    .post('/api/auth/login/2fa')
    .send({ tempToken: 'sometoken' })
    .expect(400);
});

test('POST /2fa/disable - valid TOTP code disables 2FA', async () => {
  const client = request(app);
  const { token } = await registerVerifyLogin(client, {
    name: 'Jack',
    email: 'jack@example.com',
  });

  const setupRes = await client.post('/api/auth/2fa/setup').set(authHeader(token)).expect(200);
  const { secret } = setupRes.body;

  await client
    .post('/api/auth/2fa/enable')
    .set(authHeader(token))
    .send({ code: generateTOTPCode(secret) })
    .expect(200);

  const res = await client
    .post('/api/auth/2fa/disable')
    .set(authHeader(token))
    .send({ code: generateTOTPCode(secret) })
    .expect(200);

  assert.equal(res.body.user.twoFactorEnabled, false);
});

test('POST /2fa/disable - invalid code returns 400', async () => {
  const client = request(app);
  const { token } = await registerVerifyLogin(client, {
    name: 'Kate',
    email: 'kate@example.com',
  });

  const setupRes = await client.post('/api/auth/2fa/setup').set(authHeader(token)).expect(200);
  await client
    .post('/api/auth/2fa/enable')
    .set(authHeader(token))
    .send({ code: generateTOTPCode(setupRes.body.secret) })
    .expect(200);

  const res = await client
    .post('/api/auth/2fa/disable')
    .set(authHeader(token))
    .send({ code: '000000' })
    .expect(400);

  assert.match(res.body.error, /invalid/i);
});

test('POST /2fa/disable - when 2FA is not enabled returns 400', async () => {
  const client = request(app);
  const { token } = await registerVerifyLogin(client, {
    name: 'Leo',
    email: 'leo@example.com',
  });

  const res = await client
    .post('/api/auth/2fa/disable')
    .set(authHeader(token))
    .send({ code: '123456' })
    .expect(400);

  assert.match(res.body.error, /not enabled/i);
});

test('POST /2fa/disable - missing code returns 400', async () => {
  const client = request(app);
  const { token } = await registerVerifyLogin(client, {
    name: 'Mia',
    email: 'mia@example.com',
  });

  const setupRes = await client.post('/api/auth/2fa/setup').set(authHeader(token)).expect(200);
  await client
    .post('/api/auth/2fa/enable')
    .set(authHeader(token))
    .send({ code: generateTOTPCode(setupRes.body.secret) })
    .expect(200);

  const res = await client
    .post('/api/auth/2fa/disable')
    .set(authHeader(token))
    .send({})
    .expect(400);

  assert.match(res.body.error, /required/i);
});
