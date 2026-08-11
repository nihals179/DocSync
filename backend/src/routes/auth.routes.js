const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');

const {
  ensureTenantBootstrapForUser,
  ensureUserBillingState,
  ensureWorkspaceForUserProvisioned,
  getOrganizationSecurityState,
  syncCurrentOrganizationFromMembership,
} = require('../store');
const { writeAuditLog } = require('../lib/audit');
const {
  signTwoFactorToken,
} = require('../middleware/auth/core');
const {
  decryptPassword,
} = require('../lib/password-crypto');
const {
  nowIso,
  getRequestIp,
  getUserAgent,
  isOrgIpAllowedForUser,
  createAuthRouteHelpers,
  publicUser,
  issueOneTimeToken,
  consumeOneTimeToken,
  createSession,
  writeSessionCookies,
  buildAuthResponse,
  revokeAllUserSessions,
  findUserByIdentifier,
} = require('../middleware/auth');

const {
  authRateLimit,
  loginRateLimit,
  passwordResetRateLimit,
  registerRateLimit,
} = require('../middleware/auth/rate-limit');
const { getAuthConfig } = require('../config/auth-config');

const router = express.Router();
const FRONTEND_URL = process.env.FRONTEND_URL;
const {
  resolvePasswordFromBody,
  audit,
  ensureUserPersistedToDb,
} = createAuthRouteHelpers({
  decryptPassword,
  writeAuditLog,
  getRequestIp,
  getUserAgent,
  prisma,
});


router.post('/register', registerRateLimit, async (req, res) => {
  const authConfig = await getAuthConfig();
  const { name, email } = req.body ?? {};
  let password;

  try {
    password = resolvePasswordFromBody(req.body);
  } catch {
    audit(req, 'register', 'failure', null, { reason: 'invalid-password-encryption' });
    return res.status(400).json({ error: 'Invalid encrypted password payload.' });
  }

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
 
  if (process.env.DATABASE_URL) {
    const existingDbUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingDbUser) {
      audit(req, 'register', 'failure', existingDbUser.id, { reason: 'duplicate-email-db' });
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
  }

  const verificationRequired = !authConfig.emailVerificationBypass;
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
  const billing = await ensureUserBillingState(user);
  try {
    await ensureUserPersistedToDb(user, billing);
  } catch (error) {
    audit(req, 'register', 'failure', user.id, { reason: 'db-persist-failed', error: String(error?.message || error) });
    return res.status(500).json({ error: 'Failed to create account. Please try again.' });
  }

  const verificationToken = verificationRequired
    ? await issueOneTimeToken(user.id, 'email-verification', authConfig.emailTokenTtlMs)
    : null;
  const verificationLink = verificationToken
    ? `${FRONTEND_URL}/verify-email?token=${verificationToken}`
    : null;
  audit(req, 'register', 'success', user.id, { verificationRequired });
  res.status(201).json({
    message: verificationRequired
      ? 'Account created. Verify your email to continue.'
      : 'Account created successfully. You can now log in.',
    verificationRequired,
    user: publicUser(user),
    billing,
    ...(verificationToken && authConfig.devMode
      ? { verificationTokenPreview: verificationToken, verificationLinkPreview: verificationLink }
      : {}),
  });
});

router.post('/login', loginRateLimit, async (req, res) => {
  const authConfig = await getAuthConfig();
  const authScope = String(req?.get?.('x-auth-scope') || '').toLowerCase() === 'admin' ? 'admin' : 'workspace';
  const { email, username, remember = false } = req.body ?? {};
  try {
    resolvePasswordFromBody(req.body);
  } catch {
    audit(req, 'login', 'failure', null, { reason: 'invalid-password-encryption' });
    return res.status(400).json({ error: 'Invalid encrypted password payload.' });
  }
  const identifier = String(email || username || '').toLowerCase();
  if (!identifier || !resolvePasswordFromBody(req.body)) {
    audit(req, 'login', 'failure', null, { reason: 'missing-credentials' });
    return res.status(400).json({ error: 'email/username and password are required.' });
  }

  const user = await findUserByIdentifier(identifier);
  if (!user) {
    audit(req, 'login', 'failure', null, { reason: 'unknown-user', identifier });
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  if (user.lockoutUntil && new Date(user.lockoutUntil).getTime() > Date.now()) {
    audit(req, 'login-lockout', 'failure', user.id, { lockoutUntil: user.lockoutUntil });
    return res.status(423).json({ error: 'Account temporarily locked after repeated failed attempts.' });
  }

  const valid = await bcrypt.compare(String(resolvePasswordFromBody(req.body)), user.passwordHash);
  if (!valid) {
    const nextFailedAttempts = Number(user.failedLoginAttempts || 0) + 1;
    const nextLockoutUntil = nextFailedAttempts >= authConfig.lockoutThreshold
      ? new Date(Date.now() + authConfig.lockoutMs).toISOString()
      : null;
    if (nextLockoutUntil) {
      audit(req, 'account-lockout', 'failure', user.id, { failedLoginAttempts: nextFailedAttempts });
    }
    if (process.env.DATABASE_URL) {
      await prisma.user.updateMany({
        where: { id: user.id },
        data: {
          failedLoginAttempts: nextFailedAttempts,
          lockoutUntil: nextLockoutUntil ? new Date(nextLockoutUntil) : null,
        },
      });
    }
    audit(req, 'login', 'failure', user.id, { failedLoginAttempts: nextFailedAttempts });
    return res.status(nextLockoutUntil ? 423 : 401).json({
      error: nextLockoutUntil
        ? 'Too many failed attempts. Account locked for 30 minutes.'
          : `Invalid credentials. ${Math.max(0, authConfig.lockoutThreshold - nextFailedAttempts)} attempts remaining.`,
    });
  }

  if (!authConfig.emailVerificationBypass && !user.emailVerified && process.env.DOCSYNC_ENV === 'PROD') {
    audit(req, 'login', 'failure', user.id, { reason: 'email-not-verified' });
    return res.status(403).json({ error: 'Please verify your email before signing in.' });
  }

  user.failedLoginAttempts = 0;
  user.lockoutUntil = null;

  // Legacy users may exist without org membership; bootstrap tenant context on login.
  await ensureTenantBootstrapForUser(user);
  await syncCurrentOrganizationFromMembership(user);

  if (user.currentOrganizationId) {
    try {
      await ensureWorkspaceForUserProvisioned(user);
    } catch (error) {
      audit(req, 'login', 'failure', user.id, {
        reason: 'workspace-provision-failed',
        organizationId: user.currentOrganizationId,
        error: String(error?.message || error),
      });
      return res.status(500).json({ error: 'Failed to provision your workspace. Please try again.' });
    }
  }

  if (!await isOrgIpAllowedForUser(req, user)) {
    audit(req, 'login-ip-policy', 'failure', user.id, {
      reason: 'ip-not-allowlisted',
      organizationId: user.currentOrganizationId,
    });
    return res.status(403).json({ error: 'Your organization only allows login from approved IP addresses.' });
  }

  const security = await getOrganizationSecurityState(user.currentOrganizationId);
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

  user.lastLoginAt = nowIso();
  if (process.env.DATABASE_URL) {
    await prisma.user.updateMany({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockoutUntil: null,
        currentOrganizationId: user.currentOrganizationId || null,
        lastLoginAt: new Date(user.lastLoginAt),
      },
    });
  }

  const { refreshToken, csrfToken, session } = await createSession(user, req, Boolean(remember));
  writeSessionCookies(res, refreshToken, csrfToken, session.expiresAt, authScope);
  audit(req, 'login', 'success', user.id, { sessionId: session.id });
  res.json(buildAuthResponse(user, session));
});

router.post('/verify-email', authRateLimit, async (req, res) => {
  const token = String(req.body?.token || '');
  if (!token) return res.status(400).json({ error: 'Verification token is required.' });

  const record = await consumeOneTimeToken(token, 'email-verification');
  if (!record) {
    audit(req, 'email-verify', 'failure', null, { reason: 'invalid-token' });
    return res.status(400).json({ error: 'Verification token is invalid or expired.' });
  }

  const updated = await prisma.user.updateMany({
    where: { id: record.userId },
    data: { emailVerified: true },
  });
  if (!updated.count) return res.status(404).json({ error: 'User not found.' });
  audit(req, 'email-verify', 'success', record.userId);
  res.json({ message: 'Email verified successfully.' });
});

router.post('/resend-verification', authRateLimit, async (req, res) => {
  const authConfig = await getAuthConfig();
  const email = String(req.body?.email || '').toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, emailVerified: true },
  });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.emailVerified) return res.status(400).json({ error: 'Email already verified.' });

  const verificationToken = await issueOneTimeToken(user.id, 'email-verification', authConfig.emailTokenTtlMs);
  const verificationLink = `${FRONTEND_URL}/verify-email?token=${verificationToken}`;
  audit(req, 'email-verification-resend', 'success', user.id);
  res.json({
    message: 'Verification email queued.',
    ...(authConfig.devMode ? { verificationTokenPreview: verificationToken, verificationLinkPreview: verificationLink } : {}),
  });
});

router.post('/forgot-password', passwordResetRateLimit, async (req, res) => {
  const authConfig = await getAuthConfig();
  const email = String(req.body?.email || '').toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!user) {
    audit(req, 'password-reset-request', 'success', null, { maskedEmail: email });
    return res.json({ message: 'If an account exists for that email, a reset link has been generated.' });
  }

  const resetToken = await issueOneTimeToken(user.id, 'password-reset', authConfig.resetTokenTtlMs);
  const resetLink = `${FRONTEND_URL}/reset-password?token=${resetToken}`;
  audit(req, 'password-reset-request', 'success', user.id);
  res.json({
    message: 'If an account exists for that email, a reset link has been generated.',
    ...(authConfig.devMode ? { resetTokenPreview: resetToken, resetLinkPreview: resetLink } : {}),
  });
});

router.post('/reset-password', passwordResetRateLimit, async (req, res) => {
  const { token } = req.body ?? {};
  let password;
  try {
    password = resolvePasswordFromBody(req.body);
  } catch {
    audit(req, 'password-reset', 'failure', null, { reason: 'invalid-password-encryption' });
    return res.status(400).json({ error: 'Invalid encrypted password payload.' });
  }
  if (!token || !password) return res.status(400).json({ error: 'token and password are required.' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const record = await consumeOneTimeToken(String(token), 'password-reset');
  if (!record) {
    audit(req, 'password-reset', 'failure', null, { reason: 'invalid-token' });
    return res.status(400).json({ error: 'Reset token is invalid or expired.' });
  }

  const updated = await prisma.user.updateMany({
    where: { id: record.userId },
    data: {
      passwordHash: await bcrypt.hash(String(password), 12),
      failedLoginAttempts: 0,
      lockoutUntil: null,
    },
  });
  if (!updated.count) return res.status(404).json({ error: 'User not found.' });
  await revokeAllUserSessions(record.userId);
  audit(req, 'password-reset', 'success', record.userId);
  res.json({ message: 'Password updated successfully. Please sign in again.' });
});

module.exports = router;
