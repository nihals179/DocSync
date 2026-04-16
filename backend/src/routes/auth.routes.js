const express = require('express');
const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

const {
  auditLogs,
  authSessions,
  authTokens,
  ensureTenantBootstrapForUser,
  ensureWorkspaceForUser,
  users,
} = require('../store');
const {
  CSRF_COOKIE,
  REFRESH_COOKIE,
  generateOpaqueToken,
  getCookieOptions,
  getCsrfCookieOptions,
  hashToken,
  requireAuth,
  resolveUserFromSession,
  signAccessToken,
  signTwoFactorToken,
  verifyTwoFactorToken,
} = require('../middleware/auth');
const {
  authRateLimit,
  loginRateLimit,
  passwordResetRateLimit,
  registerRateLimit,
} = require('../middleware/rate-limit');

const router = express.Router();
const DEV_MODE = process.env.NODE_ENV !== 'production';
const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MS = 30 * 60 * 1000;
const REMEMBER_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const STANDARD_SESSION_MS = 8 * 60 * 60 * 1000;
const APP_NAME = 'DocSync';

function nowIso() {
  return new Date().toISOString();
}

function getRequestIp(req) {
  return req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip || 'unknown';
}

function getUserAgent(req) {
  return req.get('user-agent') || 'unknown';
}

function audit(req, action, status, userId = null, metadata = {}) {
  const entry = {
    id: uuidv4(),
    userId,
    action,
    status,
    ipAddress: getRequestIp(req),
    userAgent: getUserAgent(req),
    createdAt: nowIso(),
    metadata,
  };
  auditLogs.set(entry.id, entry);
  return entry;
}

function ensureUserShape(user) {
  if (!user) return null;
  if (typeof user.emailVerified !== 'boolean') user.emailVerified = false;
  if (typeof user.failedLoginAttempts !== 'number') user.failedLoginAttempts = 0;
  if (user.lockoutUntil === undefined) user.lockoutUntil = null;
  if (typeof user.twoFactorEnabled !== 'boolean') user.twoFactorEnabled = false;
  if (user.twoFactorSecret === undefined) user.twoFactorSecret = null;
  if (user.twoFactorTempSecret === undefined) user.twoFactorTempSecret = null;
  if (user.currentOrganizationId === undefined) user.currentOrganizationId = null;
  return user;
}

function publicUser(user) {
  const current = ensureUserShape(user);
  ensureTenantBootstrapForUser(current);
  return {
    id: current.id,
    name: current.name,
    email: current.email,
    emailVerified: current.emailVerified,
    twoFactorEnabled: current.twoFactorEnabled,
    role: current.role || 'user',
    currentOrganizationId: current.currentOrganizationId || null,
  };
}

function issueOneTimeToken(userId, type, ttlMs) {
  const token = generateOpaqueToken();
  authTokens.set(token, {
    id: token,
    userId,
    type,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    createdAt: nowIso(),
  });
  return token;
}

function consumeOneTimeToken(token, type) {
  const record = authTokens.get(token);
  if (!record || record.type !== type) return null;
  authTokens.delete(token);
  if (new Date(record.expiresAt).getTime() <= Date.now()) return null;
  return record;
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of authSessions.entries()) {
    if (session.revokedAt || new Date(session.expiresAt).getTime() <= now) {
      authSessions.delete(id);
    }
  }
}

function clearAuthCookies(res) {
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
}

function createSession(user, req, remember) {
  pruneExpiredSessions();
  const refreshToken = generateOpaqueToken();
  const csrfToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + (remember ? REMEMBER_SESSION_MS : STANDARD_SESSION_MS)).toISOString();
  const session = {
    id: uuidv4(),
    userId: user.id,
    refreshTokenHash: hashToken(refreshToken),
    csrfToken,
    createdAt: nowIso(),
    lastUsedAt: nowIso(),
    expiresAt,
    revokedAt: null,
    remember: Boolean(remember),
    userAgent: getUserAgent(req),
    ipAddress: getRequestIp(req),
  };
  authSessions.set(session.id, session);
  return { refreshToken, csrfToken, session };
}

function rotateSession(session, req) {
  const refreshToken = generateOpaqueToken();
  const csrfToken = generateOpaqueToken();
  session.refreshTokenHash = hashToken(refreshToken);
  session.csrfToken = csrfToken;
  session.lastUsedAt = nowIso();
  session.expiresAt = new Date(Date.now() + (session.remember ? REMEMBER_SESSION_MS : STANDARD_SESSION_MS)).toISOString();
  session.userAgent = getUserAgent(req);
  session.ipAddress = getRequestIp(req);
  authSessions.set(session.id, session);
  return { refreshToken, csrfToken, session };
}

function writeSessionCookies(res, refreshToken, csrfToken, expiresAt) {
  res.cookie(REFRESH_COOKIE, refreshToken, getCookieOptions(expiresAt));
  res.cookie(CSRF_COOKIE, csrfToken, getCsrfCookieOptions(expiresAt));
}

function buildAuthResponse(user, session) {
  const { token, expiresAt } = signAccessToken(user, session.id);
  return {
    accessToken: token,
    accessTokenExpiresAt: expiresAt,
    user: publicUser(user),
    csrfToken: session.csrfToken,
    session: {
      id: session.id,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      expiresAt: session.expiresAt,
      remember: session.remember,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
    },
  };
}

function matchesRefreshToken(session, token) {
  return session.refreshTokenHash === hashToken(token);
}

function validateCsrf(req, session) {
  const header = req.get('x-csrf-token');
  return Boolean(header && session && header === session.csrfToken);
}

function revokeSession(sessionId) {
  const session = authSessions.get(sessionId);
  if (!session) return null;
  session.revokedAt = nowIso();
  authSessions.set(session.id, session);
  return session;
}

function revokeAllUserSessions(userId) {
  for (const session of authSessions.values()) {
    if (session.userId === userId && !session.revokedAt) {
      session.revokedAt = nowIso();
      authSessions.set(session.id, session);
    }
  }
}

function findUserByIdentifier(identifier) {
  const normalized = identifier.toLowerCase();
  const user = [...users.values()].find(
    (item) => item.email === normalized || (item.username && item.username === normalized),
  );
  return ensureUserShape(user || null);
}

function ensureDummyAdminUser() {
  const existingAdmin = [...users.values()].find((u) => u.username === 'admin');
  if (existingAdmin) {
    ensureUserShape(existingAdmin);
    if (!existingAdmin.role) existingAdmin.role = 'admin';
    if (!existingAdmin.emailVerified) existingAdmin.emailVerified = true;
    users.set(existingAdmin.id, existingAdmin);
    return;
  }

  const id = 'seed-admin';
  const passwordHash = bcrypt.hashSync('admin', 10);
  const admin = {
    id,
    name: 'Admin',
    username: 'admin',
    email: 'admin@docsync.local',
    passwordHash,
    createdAt: nowIso(),
    emailVerified: true,
    failedLoginAttempts: 0,
    lockoutUntil: null,
    role: 'admin',
    twoFactorEnabled: false,
    twoFactorSecret: null,
    twoFactorTempSecret: null,
  };
  users.set(id, admin);
  ensureTenantBootstrapForUser(admin);
}

ensureDummyAdminUser();

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

  const user = {
    id: uuidv4(),
    name: String(name).trim(),
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(String(password), 12),
    createdAt: nowIso(),
    emailVerified: false,
    failedLoginAttempts: 0,
    lockoutUntil: null,
    role: 'user',
    twoFactorEnabled: false,
    twoFactorSecret: null,
    twoFactorTempSecret: null,
  };
  users.set(user.id, user);
  ensureTenantBootstrapForUser(user);

  const verificationToken = issueOneTimeToken(user.id, 'email-verification', EMAIL_TOKEN_TTL_MS);
  const verificationLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/verify-email?token=${verificationToken}`;
  audit(req, 'register', 'success', user.id, { verificationRequired: true });
  res.status(201).json({
    message: 'Account created. Verify your email to continue.',
    verificationRequired: true,
    user: publicUser(user),
    ...(DEV_MODE ? { verificationTokenPreview: verificationToken, verificationLinkPreview: verificationLink } : {}),
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

  if (!user.emailVerified) {
    audit(req, 'login', 'failure', user.id, { reason: 'email-not-verified' });
    return res.status(403).json({ error: 'Please verify your email before signing in.' });
  }

  user.failedLoginAttempts = 0;
  user.lockoutUntil = null;
  users.set(user.id, user);
  ensureTenantBootstrapForUser(user);

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
  writeSessionCookies(res, refreshToken, csrfToken, session.expiresAt);
  audit(req, 'login', 'success', user.id, { sessionId: session.id });
  res.json(buildAuthResponse(user, session));
});

router.post('/login/2fa', loginRateLimit, (req, res) => {
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

  const valid = authenticator.check(String(code), user.twoFactorSecret);
  if (!valid) {
    audit(req, 'login-2fa', 'failure', user.id);
    return res.status(401).json({ error: 'Invalid authentication code.' });
  }

  const { refreshToken, csrfToken, session } = createSession(user, req, Boolean(pending.remember));
  writeSessionCookies(res, refreshToken, csrfToken, session.expiresAt);
  audit(req, 'login-2fa', 'success', user.id, { sessionId: session.id });
  res.json(buildAuthResponse(user, session));
});

router.post('/refresh', authRateLimit, (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE];
  if (!refreshToken) {
    return res.status(401).json({ error: 'No refresh session available.' });
  }

  const session = [...authSessions.values()].find((item) => matchesRefreshToken(item, refreshToken));
  if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    clearAuthCookies(res);
    return res.status(401).json({ error: 'Refresh session invalid or expired.' });
  }
  if (!validateCsrf(req, session)) {
    return res.status(403).json({ error: 'Invalid CSRF token.' });
  }

  const resolved = resolveUserFromSession(session.id);
  if (!resolved) {
    clearAuthCookies(res);
    return res.status(401).json({ error: 'Refresh session invalid or expired.' });
  }

  const rotated = rotateSession(resolved.session, req);
  writeSessionCookies(res, rotated.refreshToken, rotated.csrfToken, rotated.session.expiresAt);
  audit(req, 'session-refresh', 'success', resolved.user.id, { sessionId: rotated.session.id });
  res.json(buildAuthResponse(resolved.user, rotated.session));
});

router.post('/logout', requireAuth, (req, res) => {
  revokeSession(req.authSession.id);
  clearAuthCookies(res);
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
  const session = authSessions.get(req.params.sessionId);
  if (!session || session.userId !== req.user.id) {
    return res.status(404).json({ error: 'Session not found.' });
  }
  revokeSession(session.id);
  if (session.id === req.authSession.id) clearAuthCookies(res);
  audit(req, 'session-revoke', 'success', req.user.id, { sessionId: session.id });
  res.json({ message: 'Session revoked.' });
});

router.post('/sessions/revoke-all', requireAuth, (req, res) => {
  revokeAllUserSessions(req.user.id);
  clearAuthCookies(res);
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
  const logs = [...auditLogs.values()]
    .filter((entry) => entry.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 100);
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
