const express = require('express');
const bcrypt = require('bcryptjs');
const { generateSync: _totpGenerateSync, verifySync: _totpVerifySync } = require('@otplib/totp');
const { NobleCryptoPlugin: _NobleCryptoPlugin } = require('@otplib/plugin-crypto-noble');
const { ScureBase32Plugin: _ScureBase32Plugin } = require('@otplib/plugin-base32-scure');
const { generateSecret: _otpGenerateSecret } = require('otplib');
const { generateTOTP: _generateTOTP } = require('@otplib/uri');

// Compatibility shim for otplib v13 (v11 authenticator API no longer exported)
const _totpPlugins = {
  crypto: new _NobleCryptoPlugin(),
  base32: new _ScureBase32Plugin(),
};
const authenticator = {
  generateSecret: () => _otpGenerateSecret(_totpPlugins),
  keyuri: (email, appName, secret) => _generateTOTP({ label: email, issuer: appName, secret }),
  check: (token, secret) => {
    const result = _totpVerifySync({ token: String(token), secret, ..._totpPlugins });
    return !!(result && result.valid);
  },
};
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');

const {
  authSessions,
  ensureUserBillingState,
  getOrganizationSecurityState,
  syncCurrentOrganizationFromMembership,
  users,
} = require('../store');
const { writeAuditLog, listAuditLogs } = require('../lib/audit');
const {
  getAuthScope,
  resolveCookieNames,
  requireAuth,
  resolveUserFromSession,
  signTwoFactorToken,
  verifyTwoFactorToken,
} = require('../middleware/auth');
const {
  nowIso,
  getRequestIp,
  getUserAgent,
  isOrgIpAllowedForUser,
  ensureUserShape,
  publicUser,
  issueOneTimeToken,
  consumeOneTimeToken,
  clearAuthCookies,
  createSession,
  rotateSession,
  writeSessionCookies,
  buildAuthResponse,
  matchesRefreshToken,
  validateCsrf,
  revokeSession,
  revokeAllUserSessions,
  findUserByIdentifier,
} = require('../middleware/auth-helpers');

const {
  authRateLimit,
  loginRateLimit,
  passwordResetRateLimit,
  registerRateLimit,
} = require('../middleware/rate-limit');

const router = express.Router();
const DEV_MODE = process.env.NODE_ENV !== 'production';
const EMAIL_VERIFICATION_BYPASS = process.env.AUTH_BYPASS_EMAIL_VERIFICATION === 'true';
const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MS = 30 * 60 * 1000;
const APP_NAME = 'DocSync';

function audit(req, action, status, userId = null, metadata = {}) {
  const user = userId ? users.get(userId) : null;
  return writeAuditLog({
    userId,
    organizationId: user?.currentOrganizationId || metadata.organizationId || null,
    action,
    status,
    ipAddress: getRequestIp(req),
    userAgent: getUserAgent(req),
    metadata: {
      ...metadata,
    },
  });
}

async function ensureUserPersistedToDb(user, billing) {
  if (!process.env.DATABASE_URL) return;

  await prisma.user.create({
    data: {
      id: user.id,
      name: user.name,
      email: user.email,
      passwordHash: user.passwordHash,
      createdAt: new Date(user.createdAt),
      accountType: user.accountType || 'individual',
      emailVerified: Boolean(user.emailVerified),
      failedLoginAttempts: Number(user.failedLoginAttempts || 0),
      lockoutUntil: user.lockoutUntil ? new Date(user.lockoutUntil) : null,
      role: user.role || 'user',
      twoFactorEnabled: Boolean(user.twoFactorEnabled),
      twoFactorSecret: user.twoFactorSecret || null,
      twoFactorTempSecret: user.twoFactorTempSecret || null,
      currentOrganizationId: user.currentOrganizationId || null,
    },
  });

  await prisma.userBilling.upsert({
    where: { userId: user.id },
    update: {
      planId: billing.planId,
      status: billing.status,
      trialEndsAt: billing.trialEndsAt ? new Date(billing.trialEndsAt) : null,
      trialUsed: Boolean(billing.trialUsed),
      subscriptionId: billing.subscriptionId || null,
      customerId: billing.customerId || null,
      currentPeriodEndAt: billing.currentPeriodEndAt ? new Date(billing.currentPeriodEndAt) : null,
      graceEndsAt: billing.graceEndsAt ? new Date(billing.graceEndsAt) : null,
    },
    create: {
      userId: user.id,
      planId: billing.planId,
      status: billing.status,
      trialEndsAt: billing.trialEndsAt ? new Date(billing.trialEndsAt) : null,
      trialUsed: Boolean(billing.trialUsed),
      subscriptionId: billing.subscriptionId || null,
      customerId: billing.customerId || null,
      currentPeriodEndAt: billing.currentPeriodEndAt ? new Date(billing.currentPeriodEndAt) : null,
      graceEndsAt: billing.graceEndsAt ? new Date(billing.graceEndsAt) : null,
    },
  });
}


router.post('/register', registerRateLimit, async (req, res) => {
  const { name, email, password } = req.body ?? {};
  if (!name || !email || !password) {
    audit(req, 'register', 'failure', null, { reason: 'missing-fields' });
    return res.status(400).json({ error: 'name, email, and password are required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
    audit(req, 'register', 'failure', null, { reason: 'invalid-email', email });
    return res.status(400).json({ error: 'Invalid email address.' });
  }
  if (String(password).length < 8) {
    audit(req, 'register', 'failure', null, { reason: 'weak-password' });
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const normalizedEmail = String(email).toLowerCase();
  const existing = [...users.values()].find((u) => u.email === normalizedEmail);
  if (existing) {
    audit(req, 'register', 'failure', existing.id, { reason: 'duplicate-email' });
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }
  if (process.env.DATABASE_URL) {
    const existingDbUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingDbUser) {
      audit(req, 'register', 'failure', existingDbUser.id, { reason: 'duplicate-email-db' });
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
  }

  const verificationRequired = !EMAIL_VERIFICATION_BYPASS;
  const user = {
    id: uuidv4(),
    name: String(name).trim(),
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(String(password), 12),
    createdAt: nowIso(),
    accountType: 'individual',
    emailVerified: !verificationRequired,
    failedLoginAttempts: 0,
    lockoutUntil: null,
    role: 'user',
    twoFactorEnabled: false,
    twoFactorSecret: null,
    twoFactorTempSecret: null,
  };
  users.set(user.id, user);
  const billing = ensureUserBillingState(user);
  try {
    await ensureUserPersistedToDb(user, billing);
  } catch (error) {
    users.delete(user.id);
    audit(req, 'register', 'failure', user.id, { reason: 'db-persist-failed', error: String(error?.message || error) });
    return res.status(500).json({ error: 'Failed to create account. Please try again.' });
  }

  const verificationToken = verificationRequired
    ? issueOneTimeToken(user.id, 'email-verification', EMAIL_TOKEN_TTL_MS)
    : null;
  const verificationLink = verificationToken
    ? `${process.env.FRONTEND_URL || 'http://localhost:5173'}/verify-email?token=${verificationToken}`
    : null;
  audit(req, 'register', 'success', user.id, { verificationRequired });
  res.status(201).json({
    message: verificationRequired
      ? 'Account created. Verify your email to continue.'
      : 'Account created successfully. You can now log in.',
    verificationRequired,
    user: publicUser(user),
    ...(verificationToken && DEV_MODE
      ? { verificationTokenPreview: verificationToken, verificationLinkPreview: verificationLink }
      : {}),
  });
});

router.post('/verify-email', authRateLimit, (req, res) => {
  const token = String(req.body?.token || '');
  if (!token) return res.status(400).json({ error: 'Verification token is required.' });

  const record = consumeOneTimeToken(token, 'email-verification');
  if (!record) {
    audit(req, 'email-verify', 'failure', null, { reason: 'invalid-token' });
    return res.status(400).json({ error: 'Verification token is invalid or expired.' });
  }

  const user = ensureUserShape(users.get(record.userId));
  if (!user) return res.status(404).json({ error: 'User not found.' });
  user.emailVerified = true;
  users.set(user.id, user);
  audit(req, 'email-verify', 'success', user.id);
  res.json({ message: 'Email verified successfully.' });
});

router.post('/resend-verification', authRateLimit, (req, res) => {
  const email = String(req.body?.email || '').toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  const user = [...users.values()].find((item) => item.email === email);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  ensureUserShape(user);
  if (user.emailVerified) return res.status(400).json({ error: 'Email already verified.' });

  const verificationToken = issueOneTimeToken(user.id, 'email-verification', EMAIL_TOKEN_TTL_MS);
  const verificationLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/verify-email?token=${verificationToken}`;
  audit(req, 'email-verification-resend', 'success', user.id);
  res.json({
    message: 'Verification email queued.',
    ...(DEV_MODE ? { verificationTokenPreview: verificationToken, verificationLinkPreview: verificationLink } : {}),
  });
});

router.post('/login', loginRateLimit, async (req, res) => {
  const authScope = getAuthScope(req);
  const { email, username, password, remember = false } = req.body ?? {};
  const identifier = String(email || username || '').toLowerCase();
  if (!identifier || !password) {
    audit(req, 'login', 'failure', null, { reason: 'missing-credentials' });
    return res.status(400).json({ error: 'email/username and password are required.' });
  }

  const user = findUserByIdentifier(identifier);
  if (!user) {
    audit(req, 'login', 'failure', null, { reason: 'unknown-user', identifier });
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  if (user.lockoutUntil && new Date(user.lockoutUntil).getTime() > Date.now()) {
    audit(req, 'login-lockout', 'failure', user.id, { lockoutUntil: user.lockoutUntil });
    return res.status(423).json({ error: 'Account temporarily locked after repeated failed attempts.' });
  }

  const valid = await bcrypt.compare(String(password), user.passwordHash);
  if (!valid) {
    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= LOCKOUT_THRESHOLD) {
      user.lockoutUntil = new Date(Date.now() + LOCKOUT_MS).toISOString();
      audit(req, 'account-lockout', 'failure', user.id, { failedLoginAttempts: user.failedLoginAttempts });
    }
    users.set(user.id, user);
    audit(req, 'login', 'failure', user.id, { failedLoginAttempts: user.failedLoginAttempts });
    return res.status(user.lockoutUntil ? 423 : 401).json({
      error: user.lockoutUntil
        ? 'Too many failed attempts. Account locked for 30 minutes.'
        : `Invalid credentials. ${Math.max(0, LOCKOUT_THRESHOLD - user.failedLoginAttempts)} attempts remaining.`,
    });
  }

  if (!EMAIL_VERIFICATION_BYPASS && !user.emailVerified) {
    audit(req, 'login', 'failure', user.id, { reason: 'email-not-verified' });
    return res.status(403).json({ error: 'Please verify your email before signing in.' });
  }

  user.failedLoginAttempts = 0;
  user.lockoutUntil = null;
  users.set(user.id, user);
  syncCurrentOrganizationFromMembership(user);

  if (!isOrgIpAllowedForUser(req, user)) {
    audit(req, 'login-ip-policy', 'failure', user.id, {
      reason: 'ip-not-allowlisted',
      organizationId: user.currentOrganizationId,
    });
    return res.status(403).json({ error: 'Your organization only allows login from approved IP addresses.' });
  }

  const security = getOrganizationSecurityState(user.currentOrganizationId);
  const hasActiveSsoProvider = Boolean(
    security?.ssoProviders?.some((provider) => provider && provider.enabled !== false),
  );
  if (security?.requireMfa && !hasActiveSsoProvider && !user.twoFactorEnabled) {
    audit(req, 'login-mfa-policy', 'failure', user.id, {
      reason: 'mfa-required-by-organization',
      organizationId: user.currentOrganizationId,
    });
    return res.status(403).json({ error: 'Your organization requires MFA. Enable two-factor authentication first.' });
  }

  if (user.twoFactorEnabled) {
    audit(req, 'login-2fa-required', 'success', user.id);
    return res.status(202).json({
      requiresTwoFactor: true,
      tempToken: signTwoFactorToken(user.id, Boolean(remember)),
      message: 'Two-factor authentication code required.',
      user: publicUser(user),
    });
  }

  const { refreshToken, csrfToken, session } = createSession(user, req, Boolean(remember));
  writeSessionCookies(res, refreshToken, csrfToken, session.expiresAt, authScope);
  audit(req, 'login', 'success', user.id, { sessionId: session.id });
  res.json(buildAuthResponse(user, session));
});

router.post('/login/2fa', loginRateLimit, (req, res) => {
  const authScope = getAuthScope(req);
  const { tempToken, code } = req.body ?? {};
  if (!tempToken || !code) {
    return res.status(400).json({ error: 'tempToken and code are required.' });
  }

  let pending;
  try {
    pending = verifyTwoFactorToken(String(tempToken));
  } catch {
    return res.status(400).json({ error: 'Two-factor session is invalid or expired.' });
  }

  const user = ensureUserShape(users.get(pending.sub));
  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
    return res.status(400).json({ error: 'Two-factor authentication is not configured.' });
  }

  if (!isOrgIpAllowedForUser(req, user)) {
    audit(req, 'login-2fa-ip-policy', 'failure', user.id, {
      reason: 'ip-not-allowlisted',
      organizationId: user.currentOrganizationId,
    });
    return res.status(403).json({ error: 'Your organization only allows login from approved IP addresses.' });
  }

  const valid = authenticator.check(code, user.twoFactorSecret);
  if (!valid) {
    audit(req, 'login-2fa', 'failure', user.id);
    return res.status(401).json({ error: 'Invalid authentication code.' });
  }

  const { refreshToken, csrfToken, session } = createSession(user, req, Boolean(pending.remember));
  writeSessionCookies(res, refreshToken, csrfToken, session.expiresAt, authScope);
  audit(req, 'login-2fa', 'success', user.id, { sessionId: session.id });
  res.json(buildAuthResponse(user, session));
});

router.post('/refresh', authRateLimit, (req, res) => {
  const authScope = getAuthScope(req);
  const cookieNames = resolveCookieNames(authScope);
  const refreshToken = req.cookies?.[cookieNames.refreshCookie];
  if (!refreshToken) {
    return res.status(401).json({ error: 'No refresh session available.' });
  }

  const session = [...authSessions.values()].find((item) => matchesRefreshToken(item, refreshToken));
  if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    clearAuthCookies(res, authScope);
    return res.status(401).json({ error: 'Refresh session invalid or expired.' });
  }
  if (!validateCsrf(req, session)) {
    return res.status(403).json({ error: 'Invalid CSRF token.' });
  }

  const resolved = resolveUserFromSession(session.id);
  if (!resolved) {
    clearAuthCookies(res, authScope);
    return res.status(401).json({ error: 'Refresh session invalid or expired.' });
  }

  if (!isOrgIpAllowedForUser(req, resolved.user)) {
    clearAuthCookies(res, authScope);
    audit(req, 'session-refresh-ip-policy', 'failure', resolved.user.id, {
      reason: 'ip-not-allowlisted',
      organizationId: resolved.user.currentOrganizationId,
      sessionId: resolved.session.id,
    });
    return res.status(403).json({ error: 'Your organization only allows access from approved IP addresses.' });
  }

  const rotated = rotateSession(resolved.session, req);
  writeSessionCookies(res, rotated.refreshToken, rotated.csrfToken, rotated.session.expiresAt, authScope);
  audit(req, 'session-refresh', 'success', resolved.user.id, { sessionId: rotated.session.id });
  res.json(buildAuthResponse(resolved.user, rotated.session));
});

router.post('/logout', requireAuth, (req, res) => {
  const authScope = getAuthScope(req);
  revokeSession(req.authSession.id);
  clearAuthCookies(res, authScope);
  audit(req, 'logout', 'success', req.user.id, { sessionId: req.authSession.id });
  res.json({ message: 'Logged out successfully.' });
});

router.get('/me', requireAuth, (req, res) => {
  const user = ensureUserShape(users.get(req.user.id));
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: publicUser(user), session: req.authSession, csrfToken: req.authSession.csrfToken });
});

router.get('/sessions', requireAuth, (req, res) => {
  const sessions = [...authSessions.values()]
    .filter((session) => session.userId === req.user.id && !session.revokedAt && new Date(session.expiresAt).getTime() > Date.now())
    .sort((a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime())
    .map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      expiresAt: session.expiresAt,
      remember: session.remember,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      current: session.id === req.authSession.id,
    }));
  res.json({ sessions });
});

router.delete('/sessions/:sessionId', requireAuth, (req, res) => {
  const authScope = getAuthScope(req);
  const session = authSessions.get(req.params.sessionId);
  if (!session || session.userId !== req.user.id) {
    return res.status(404).json({ error: 'Session not found.' });
  }
  revokeSession(session.id);
  if (session.id === req.authSession.id) clearAuthCookies(res, authScope);
  audit(req, 'session-revoke', 'success', req.user.id, { sessionId: session.id });
  res.json({ message: 'Session revoked.' });
});

router.post('/sessions/revoke-all', requireAuth, (req, res) => {
  const authScope = getAuthScope(req);
  revokeAllUserSessions(req.user.id);
  clearAuthCookies(res, authScope);
  audit(req, 'session-revoke-all', 'success', req.user.id);
  res.json({ message: 'All sessions revoked.' });
});

router.post('/forgot-password', passwordResetRateLimit, (req, res) => {
  const email = String(req.body?.email || '').toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  const user = [...users.values()].find((item) => item.email === email);
  if (!user) {
    audit(req, 'password-reset-request', 'success', null, { maskedEmail: email });
    return res.json({ message: 'If an account exists for that email, a reset link has been generated.' });
  }

  const resetToken = issueOneTimeToken(user.id, 'password-reset', RESET_TOKEN_TTL_MS);
  const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}`;
  audit(req, 'password-reset-request', 'success', user.id);
  res.json({
    message: 'If an account exists for that email, a reset link has been generated.',
    ...(DEV_MODE ? { resetTokenPreview: resetToken, resetLinkPreview: resetLink } : {}),
  });
});

router.post('/reset-password', passwordResetRateLimit, async (req, res) => {
  const { token, password } = req.body ?? {};
  if (!token || !password) return res.status(400).json({ error: 'token and password are required.' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const record = consumeOneTimeToken(String(token), 'password-reset');
  if (!record) {
    audit(req, 'password-reset', 'failure', null, { reason: 'invalid-token' });
    return res.status(400).json({ error: 'Reset token is invalid or expired.' });
  }

  const user = ensureUserShape(users.get(record.userId));
  if (!user) return res.status(404).json({ error: 'User not found.' });
  user.passwordHash = await bcrypt.hash(String(password), 12);
  user.failedLoginAttempts = 0;
  user.lockoutUntil = null;
  users.set(user.id, user);
  revokeAllUserSessions(user.id);
  audit(req, 'password-reset', 'success', user.id);
  res.json({ message: 'Password updated successfully. Please sign in again.' });
});

router.get('/audit-logs', requireAuth, (req, res) => {
  const logs = listAuditLogs({ userId: req.user.id, limit: 100 });
  res.json({ logs });
});

router.get('/security', requireAuth, (req, res) => {
  const user = ensureUserShape(users.get(req.user.id));
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({
    user: publicUser(user),
    activeSessions: [...authSessions.values()].filter(
      (session) => session.userId === user.id && !session.revokedAt && new Date(session.expiresAt).getTime() > Date.now(),
    ).length,
  });
});

router.post('/2fa/setup', requireAuth, async (req, res) => {
  const user = ensureUserShape(users.get(req.user.id));
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const secret = authenticator.generateSecret();
  user.twoFactorTempSecret = secret;
  users.set(user.id, user);
  const otpauth = authenticator.keyuri(user.email, APP_NAME, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauth);
  audit(req, '2fa-setup', 'success', user.id);
  res.json({ secret, otpauth, qrDataUrl });
});

router.post('/2fa/enable', requireAuth, (req, res) => {
  const code = String(req.body?.code || '');
  if (!code) return res.status(400).json({ error: 'Authentication code is required.' });

  const user = ensureUserShape(users.get(req.user.id));
  if (!user || !user.twoFactorTempSecret) {
    return res.status(400).json({ error: 'Two-factor setup has not been started.' });
  }

  const valid = authenticator.check(code, user.twoFactorTempSecret);
  if (!valid) {
    audit(req, '2fa-enable', 'failure', req.user.id);
    return res.status(400).json({ error: 'Invalid authentication code.' });
  }

  user.twoFactorSecret = user.twoFactorTempSecret;
  user.twoFactorTempSecret = null;
  user.twoFactorEnabled = true;
  users.set(user.id, user);
  audit(req, '2fa-enable', 'success', user.id);
  res.json({ message: 'Two-factor authentication enabled.', user: publicUser(user) });
});

router.post('/2fa/disable', requireAuth, (req, res) => {
  const code = String(req.body?.code || '');
  if (!code) return res.status(400).json({ error: 'Authentication code is required.' });

  const user = ensureUserShape(users.get(req.user.id));
  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
    return res.status(400).json({ error: 'Two-factor authentication is not enabled.' });
  }

  const valid = authenticator.check(code, user.twoFactorSecret);
  if (!valid) {
    audit(req, '2fa-disable', 'failure', user.id);
    return res.status(400).json({ error: 'Invalid authentication code.' });
  }

  user.twoFactorEnabled = false;
  user.twoFactorSecret = null;
  user.twoFactorTempSecret = null;
  users.set(user.id, user);
  audit(req, '2fa-disable', 'success', user.id);
  res.json({ message: 'Two-factor authentication disabled.', user: publicUser(user) });
});

module.exports = router;
