const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');
const { getMembershipRole } = require('../lib/membership-role');
const { apiPublicUrl } = require('../lib/public-urls');

const {
  ensureTenantBootstrapForUser,
  ensureUserBillingState,
  ensureWorkspaceForUserProvisioned,
  getTenantSecurityState,
  syncCurrentTenantFromMembership,
  findTenantByDomain,
  findTenantBySlug,
} = require('../store');
const { writeAuditLog } = require('../lib/audit');
const {
  getAuthScope,
  resolveCookieNames,
  signTwoFactorToken,
} = require('../middleware/auth/core');
const {
  decryptPassword,
} = require('../lib/password-crypto');
const {
  nowIso,
  getRequestIp,
  getUserAgent,
  isTenantIpAllowedForUser,
  createAuthRouteHelpers,
  publicUser,
  issueOneTimeToken,
  consumeOneTimeToken,
  createSession,
  findSessionByRefreshToken,
  writeSessionCookies,
  buildAuthResponse,
  validateCsrf,
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
const { sendVerificationEmail, sendWelcomeEmail, sendPasswordResetEmail } = require('../utils/email');
const { exchangeCodeForToken, getUserInfoFromToken, getPlatformConfig, getTenantLoginConfig, beginLogin, completeLogin } = require('../lib/oidc');
const { generateSamlAuthRequest, validateSamlResponse, extractUserInfo: extractSamlUserInfo } = require('../lib/saml');

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

async function resolveExistingSessionForLogin(req, authScope, expectedIdentifier = null) {
  const cookieNames = resolveCookieNames(authScope);
  const refreshToken = req.cookies?.[cookieNames.refreshCookie];
  if (!refreshToken) return null;

  const session = await findSessionByRefreshToken(refreshToken);
  if (!session) return null;
  if (!validateCsrf(req, session)) return null;

  const user = await prisma.user.findUnique({ where: { id: session.userId }, include: { tenantMemberships: true } });
  if (!user || !user.tenantMemberships) return null;

  const normalizedUser = {
    ...user,
    createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : user.createdAt,
    updatedAt: user.updatedAt instanceof Date ? user.updatedAt.toISOString() : user.updatedAt,
    lockoutUntil: user.lockoutUntil instanceof Date ? user.lockoutUntil.toISOString() : user.lockoutUntil || null,
    lastLoginAt: user.lastLoginAt instanceof Date ? user.lastLoginAt.toISOString() : user.lastLoginAt || null,
  };

  const normalizedExpectedIdentifier = String(expectedIdentifier || '').toLowerCase().trim();
  if (normalizedExpectedIdentifier) {
    const sessionEmail = String(normalizedUser.email || '').toLowerCase().trim();
    if (sessionEmail !== normalizedExpectedIdentifier) return null;
  }

  if (!await isTenantIpAllowedForUser(req, normalizedUser)) {
    return null;
  }

  return {
    refreshToken,
    user: normalizedUser,
    session,
  };
}


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
  let user = {
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

  if (process.env.SENDMAIL === 'Y') {
    if (verificationToken) {
      try {
        await sendVerificationEmail(user.email, verificationLink, user.name);
      } catch (error) {
        console.error('Failed to send verification email during registration:', error);
        audit(req, 'register', 'partial-success', user.id, { reason: 'email-send-failed', verificationRequired });
      }
    } else {
      try {
        await sendWelcomeEmail(user.email, user.name);
      } catch (error) {
        console.error('Failed to send welcome email during registration:', error);
      }
    }
  }

  audit(req, 'register', 'success', user.id, { verificationRequired });
  res.status(201).json({
    message: verificationRequired
      ? 'Account created. Verify your email to continue.'
      : 'Account created successfully. You can now log in.',
    verificationRequired,
    user: publicUser(user, await getMembershipRole(user.id, user.currentTenantId)),
    billing,
    ...(verificationToken && authConfig.devMode
      ? { verificationTokenPreview: verificationToken, verificationLinkPreview: verificationLink }
      : {}),
  });
});

router.post('/login', loginRateLimit, async (req, res) => {
  const authScope = getAuthScope(req);
  const requestedIdentifier = String(req.body?.email || req.body?.username || '').toLowerCase().trim();
  const existing = await resolveExistingSessionForLogin(req, authScope, requestedIdentifier || null);
  if (existing) {
    writeSessionCookies(res, existing.refreshToken, existing.session.csrfToken, existing.session.expiresAt, authScope);
    audit(req, 'login', 'success', existing.user.id, { sessionId: existing.session.id, reusedSession: true });
    return res.json(await buildAuthResponse(existing.user, existing.session));
  }

  const { email, username, remember = false } = req.body ?? {};
  let decryptedPassword;
  try {
    decryptedPassword = resolvePasswordFromBody(req.body);
  } catch {
    audit(req, 'login', 'failure', null, { reason: 'invalid-password-encryption' });
    return res.status(400).json({ error: 'Invalid encrypted password payload.' });
  }
  const identifier = String(email || username || '').toLowerCase();
  if (!identifier || !decryptedPassword) {
    audit(req, 'login', 'failure', null, { reason: 'missing-credentials' });
    return res.status(400).json({ error: 'email/username and password are required.' });
  }

  let user = await findUserByIdentifier(identifier);
  if (!user) {
    audit(req, 'login', 'failure', null, { reason: 'unknown-user', identifier });
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  if (user.lockoutUntil && new Date(user.lockoutUntil).getTime() > Date.now()) {
    audit(req, 'login-lockout', 'failure', user.id, { lockoutUntil: user.lockoutUntil });
    return res.status(423).json({ error: 'Account temporarily locked after repeated failed attempts.' });
  }
  const authConfig = await getAuthConfig();

  const valid = await bcrypt.compare(String(decryptedPassword), user.passwordHash);
  if (!valid) {
    const nextFailedAttempts = Number(user.failedLoginAttempts || 0) + 1;
    const nextLockoutUntil = nextFailedAttempts >= authConfig.lockoutThreshold
      ? new Date(Date.now() + authConfig.lockoutMs).toISOString()
      : null;
    if (nextLockoutUntil) {
      audit(req, 'account-lockout', 'failure', user.id, { failedLoginAttempts: nextFailedAttempts });
    }

    if (user.failedLoginAttempts > 0 || user.lockoutUntil) {
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

  if (!authConfig.emailVerificationBypass && !user.emailVerified) {
    audit(req, 'login', 'failure', user.id, { reason: 'email-not-verified' });
    return res.status(403).json({
      error: 'Please verify your email before signing in.',
      requiresEmailVerification: true,
      email: user.email,
      message: 'Check your inbox for a verification link. If you did not receive it, you can request a new one.'
    });
  }

  user.failedLoginAttempts = 0;
  user.lockoutUntil = null;

  // Legacy users may exist without org membership; bootstrap tenant context on login.
  const tenant = await ensureTenantBootstrapForUser(user);
  user.tenant = tenant;
  // Keep the current tenant in sync with the user's active memberships. This is important for users who may have been added to a new tenant or removed from an existing one.
  try {
    user = await syncCurrentTenantFromMembership(user);
  } catch (error) {
    audit(req, 'login', 'failure', user.id, { reason: 'sync-current-tenant-failed', error: String(error?.message || error) });
    return res.status(500).json({ error: 'Failed to synchronize your tenant memberships. Please contact support.' });
  }

  const resolvedTenantId = user.currentTenantId;

  if (resolvedTenantId) {
    try {
      await ensureWorkspaceForUserProvisioned(user);
    } catch (error) {
      audit(req, 'login', 'failure', user.id, {
        reason: 'workspace-provision-failed',
        tenantId: resolvedTenantId,
        error: String(error?.message || error),
      });
      return res.status(500).json({ error: 'Failed to provision your workspace. Please try again.' });
    }
  }

  // Password sign-in from the organization's own address is allowed only for a No SSO address and a user whose current workspace it is.
  const organizationSlug = String(req.body?.organizationSlug || '').toLowerCase().trim();
  let viaOrganizationAddress = false;
  if (organizationSlug) {
    const addressed = await findTenantBySlug(organizationSlug);
    if (!addressed || addressed.tenant.id !== resolvedTenantId) {
      audit(req, 'login', 'failure', user.id, { reason: 'not-a-member-of-address', slug: organizationSlug });
      return res.status(403).json({ error: NOT_A_MEMBER_MESSAGE });
    }
    if (addressed.security.signInAddressUsesSso !== false) {
      audit(req, 'login', 'failure', user.id, { reason: 'address-requires-sso', slug: organizationSlug });
      return res.status(403).json({ error: 'This organization signs in with SSO. Use the Single sign-on button.' });
    }
    viaOrganizationAddress = true;
  }

  const security = await getTenantSecurityState(resolvedTenantId);
  // Admin and owner accounts (the same roles the admin portal admits) may still sign in from the main site.
  // A tenant owner counts as owner when the tenant's owner email or owner user ID matches this account.
  const tenantOwner = resolvedTenantId
    ? await prisma.tenant.findUnique({ where: { id: resolvedTenantId }, select: { ownerEmail: true, ownerUserId: true } })
    : null;
  const isTenantOwner = Boolean(tenantOwner) && (
    tenantOwner.ownerUserId === user.id
    || (tenantOwner.ownerEmail && tenantOwner.ownerEmail.toLowerCase() === String(user.email || '').toLowerCase())
  );
  const membershipRole = await getMembershipRole(user.id, resolvedTenantId);
  const isAdminAccount = membershipRole === 'admin' || membershipRole === 'owner' || isTenantOwner;
  if (resolvedTenantId && !viaOrganizationAddress && !isAdminAccount && security?.allowSignInWithoutSlug === false) {
    audit(req, 'login-slug-policy', 'failure', user.id, {
      reason: 'sign-in-without-slug-disabled',
      tenantId: resolvedTenantId,
    });
    return res.status(403).json({ error: 'Your organization requires signing in at its organization sign-in address.' });
  }

  const hasActiveSsoProvider = Boolean(
    security?.ssoProviders?.some((provider) => provider && provider.enabled !== false),
  );
  if (security?.requireMfa && !hasActiveSsoProvider && !user.twoFactorEnabled) {
    audit(req, 'login-mfa-policy', 'failure', user.id, {
      reason: 'mfa-required-by-tenant',
      tenantId: resolvedTenantId,
    });
    return res.status(403).json({ error: 'Your tenant requires MFA. Enable two-factor authentication first.' });
  }

  if(security?.ipAllowlistEnabled && Array.isArray(security.ipAllowlist) && security.ipAllowlist.length > 0) {
    const requestIp = getRequestIp(req);
    if (!security.ipAllowlist.includes(requestIp)) {
      audit(req, 'login-ip-policy', 'failure', user.id, {
        reason: 'ip-not-allowlisted',
        tenantId: resolvedTenantId,
        requestIp,
      });
      return res.status(403).json({ error: 'Your tenant only allows access from approved IP addresses.' });
    }
  }

  if (user.twoFactorEnabled) {
    audit(req, 'login-2fa-required', 'success', user.id);
    return res.status(202).json({
      requiresTwoFactor: true,
      tempToken: signTwoFactorToken(user.id, Boolean(remember)),
      message: 'Two-factor authentication code required.',
      user: publicUser(user, await getMembershipRole(user.id, user.currentTenantId)),
    });
  }

  user.lastLoginAt = nowIso();
  if (user.failedLoginAttempts > 0 || user.lockoutUntil) {
    await prisma.user.updateMany({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockoutUntil: null,
        currentTenantId: resolvedTenantId || null,
        lastLoginAt: new Date(user.lastLoginAt),
      },
    });
  }

  const { refreshToken, csrfToken, session } = await createSession(user, req, Boolean(remember));
  writeSessionCookies(res, refreshToken, csrfToken, session.expiresAt, authScope);
  audit(req, 'login', 'success', user.id, { sessionId: session.id });
  res.json(await buildAuthResponse(user, session));
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
    select: { id: true, name: true, emailVerified: true },
  });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.emailVerified) return res.status(400).json({ error: 'Email already verified.' });

  const verificationToken = await issueOneTimeToken(user.id, 'email-verification', authConfig.emailTokenTtlMs);
  const verificationLink = `${FRONTEND_URL}/verify-email?token=${verificationToken}`;

    if (process.env.SENDMAIL === 'Y') {
    try {
      await sendVerificationEmail(email, verificationLink, user.name);
    } catch (error) {
      console.error('Failed to send verification email:', error);
      audit(req, 'email-verification-resend', 'failure', user.id, { reason: 'email-send-failed', error: String(error?.message || error) });
      return res.status(500).json({ error: 'Failed to send verification email. Please try again.' });
    }
  }

  audit(req, 'email-verification-resend', 'success', user.id);
  res.json({
    message: 'Verification email sent successfully.',
    ...(authConfig.devMode ? { verificationTokenPreview: verificationToken, verificationLinkPreview: verificationLink } : {}),
  });
});

router.post('/forgot-password', passwordResetRateLimit, async (req, res) => {
  const authConfig = await getAuthConfig();
  const email = String(req.body?.email || '').toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true },
  });
  if (!user) {
    audit(req, 'password-reset-request', 'success', null, { maskedEmail: email });
    return res.json({ message: 'If an account exists for that email, a reset link has been generated.' });
  }

  const resetToken = await issueOneTimeToken(user.id, 'password-reset', authConfig.resetTokenTtlMs);
  const resetLink = `${FRONTEND_URL}/reset-password?token=${resetToken}`;

  if (process.env.SENDMAIL === 'Y') {
    try {
      await sendPasswordResetEmail(email, resetLink, user.name);
    } catch (error) {
      console.error('Failed to send password reset email:', error);
    }
  }

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

router.get('/callback', authRateLimit, async (req, res) => {
  const { code, state, error, error_description } = req.query;

  const sendErrorPage = (status, message) => {
    return res.status(status).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authentication Error</title>
          <style>
            body { font-family: Arial; background: #f5f5f5; margin: 0; padding: 20px; }
            .container { max-width: 500px; margin: 50px auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #d32f2f; margin-top: 0; }
            p { color: #666; line-height: 1.6; }
            a { color: #1976d2; text-decoration: none; }
            a:hover { text-decoration: underline; }
            code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>⚠️ Authentication Error</h1>
            <p><strong>Error:</strong> ${message}</p>
            <p>This page should not be visited directly. It's called automatically by Microsoft Entra after you sign in.</p>
            <p><strong>What to do:</strong></p>
            <ul>
              <li>Go back to <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth">DocSync Login</a></li>
              <li>Enter your work email and click "Continue with SSO"</li>
              <li>You'll be redirected to Microsoft to sign in</li>
            </ul>
            <p style="font-size: 12px; color: #999; margin-top: 30px;">
              If you're having issues, check the <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/settings">settings page</a> to verify SSO is configured.
            </p>
          </div>
        </body>
      </html>
    `);
  };

  if (error) {
    audit(req, 'sso-callback', 'failure', null, { error, error_description });
    return sendErrorPage(400, error_description || 'SSO authentication failed.');
  }

  if (!code) {
    audit(req, 'sso-callback', 'failure', null, { reason: 'missing-code' });
    return sendErrorPage(400, 'Authorization code is required. This page is for OAuth callbacks only.');
  }

  try {
    const state_email = String(state || '').toLowerCase().trim();
    if (!state_email || !state_email.includes('@')) {
      return sendErrorPage(400, 'Invalid state parameter.');
    }

    const tenant = await findTenantByDomain(state_email);
    if (!tenant) {
      audit(req, 'sso-callback', 'failure', null, { reason: 'no-tenant-mapping', email: state_email });
      return sendErrorPage(400, `No tenant configured for email domain "${state_email}". Contact your administrator to add this domain.`);
    }

    const security = await getTenantSecurityState(tenant.id);
    const provider = security.ssoProviders.find((p) => p.enabled !== false);
    if (!provider) {
      audit(req, 'sso-callback', 'failure', null, { reason: 'no-active-provider', tenantId: tenant.id });
      return sendErrorPage(400, 'No active SSO provider configured for this tenant. Contact your administrator.');
    }

    const callbackUrl = process.env.OAUTH_CALLBACK_URL || `${apiPublicUrl()}/auth/callback`;
    let tokenSet, userInfo;

    try {
      tokenSet = await exchangeCodeForToken(provider, code, callbackUrl, state);
    } catch (tokenError) {
      console.error('[SSO Callback] Token exchange failed for provider:', provider.name);
      return sendErrorPage(500, 'SSO authentication failed. Please verify your SSO configuration.');
    }

    try {
      userInfo = await getUserInfoFromToken(provider, tokenSet);
    } catch (userError) {
      console.error('[SSO Callback] User info retrieval failed for provider:', provider.name);
      return sendErrorPage(500, 'Failed to retrieve user information. Please try again.');
    }

    if (!userInfo.email) {
      audit(req, 'sso-callback', 'failure', null, { reason: 'no-email-in-claims' });
      return res.status(400).json({ error: 'Email not provided by SSO provider.' });
    }

    // Invite-only: a sign-in never adds a user to a workspace, so the user must already be an active member.
    const memberOfTenant = await prisma.tenantMembership.findFirst({
      where: { tenantId: tenant.id, email: String(userInfo.email).toLowerCase().trim(), status: 'active' },
    });
    if (!memberOfTenant) {
      audit(req, 'sso-callback', 'failure', null, { reason: 'not-a-member', tenantId: tenant.id });
      return sendErrorPage(403, NOT_A_MEMBER_MESSAGE);
    }

    const normalizedEmail = String(userInfo.email).toLowerCase().trim();
    let user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { tenantMemberships: true },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          id: uuidv4(),
          name: userInfo.name || normalizedEmail.split('@')[0],
          email: normalizedEmail,
          passwordHash: await bcrypt.hash(uuidv4(), 12),
          createdAt: new Date(),
          accountType: 'individual',
          emailVerified: true,
          failedLoginAttempts: 0,
          lockoutUntil: null,
          role: 'user',
          twoFactorEnabled: false,
          twoFactorSecret: null,
          twoFactorTempSecret: null,
          currentTenantId: tenant.id,
        },
        include: { tenantMemberships: true },
      });

      const membership = await prisma.tenantMembership.findFirst({
        where: { userId: user.id, tenantId: tenant.id },
      });

      if (!membership) {
        await prisma.tenantMembership.create({
          data: {
            id: uuidv4(),
            tenantId: tenant.id,
            userId: user.id,
            email: normalizedEmail,
            billingAdmin: false,
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }
    } else {
      const membership = await prisma.tenantMembership.findFirst({
        where: { userId: user.id, tenantId: tenant.id },
      });

      if (!membership) {
        await prisma.tenantMembership.create({
          data: {
            id: uuidv4(),
            tenantId: tenant.id,
            userId: user.id,
            email: normalizedEmail,
            billingAdmin: false,
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      } else if (membership.status !== 'active') {
        await prisma.tenantMembership.update({
          where: { id: membership.id },
          data: { status: 'active', updatedAt: new Date() },
        });
      }
    }

    user = await prisma.user.findUnique({
      where: { id: user.id },
      include: { tenantMemberships: true },
    });

    user = await ensureTenantBootstrapForUser(user);
    user = await syncCurrentTenantFromMembership(user);

    if (!await isTenantIpAllowedForUser(req, user)) {
      audit(req, 'sso-callback-ip-policy', 'failure', user.id, {
        reason: 'ip-not-allowlisted',
        tenantId: tenant.id,
      });
      return res.status(403).json({ error: 'Your tenant only allows access from approved IP addresses.' });
    }

    user.lastLoginAt = nowIso();
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(user.lastLoginAt) },
    });

    const authScope = getAuthScope(req);
    const { refreshToken, csrfToken, session } = await createSession(user, req, false);
    writeSessionCookies(res, refreshToken, csrfToken, session.expiresAt, authScope);

    audit(req, 'sso-callback', 'success', user.id, {
      provider: provider.name,
      sessionId: session.id,
      tenantId: tenant.id,
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    return res.redirect(`${frontendUrl}/auth/callback-success`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    audit(req, 'sso-callback', 'failure', null, { error: error.message });
    return sendErrorPage(500, `SSO authentication failed: ${error.message}. Please try again.`);
  }
});

// Helper: Ensure tenant membership exists and is active
async function ensureTenantMembership(userId, tenantId, email) {
  const membership = await prisma.tenantMembership.findFirst({
    where: { userId, tenantId },
  });

  if (!membership) {
    await prisma.tenantMembership.create({
      data: {
        id: uuidv4(),
        tenantId,
        userId,
        email,
        billingAdmin: false,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  } else if (membership.status !== 'active') {
    await prisma.tenantMembership.update({
      where: { id: membership.id },
      data: { status: 'active', updatedAt: new Date() },
    });
  }
}

const SSO_TXN_COOKIE = 'sso_txn';
const NOT_A_MEMBER_MESSAGE = "You don't have access to this workspace. Ask your administrator for an invite.";

function readSsoTxn(req) {
  try {
    const raw = req.cookies?.[SSO_TXN_COOKIE];
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setSsoTxn(res, txn) {
  res.cookie(SSO_TXN_COOKIE, JSON.stringify(txn), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60 * 1000,
    path: '/',
  });
}

function clearSsoTxn(res) {
  res.clearCookie(SSO_TXN_COOKIE, { path: '/' });
}

// Sends a sign-in failure back to the sign-in page, which shows it.
function redirectSsoFailure(res, landing, message) {
  return res.redirect(303, `${landing}/auth?sso_error=${encodeURIComponent(message)}`);
}

// Marks a SAML RelayState that came from an organization's sign-in address, so the ACS can resolve the tenant by slug.
const ORG_RELAY_PREFIX = 'org:';

// The provider an organization's sign-in address uses: the one chosen for the address, else the first enabled OIDC or SAML provider.
function findOrganizationSsoProvider(security) {
  const candidates = (security?.ssoProviders || []).filter((p) => p.enabled !== false && (p.type === 'oidc' || p.type === 'saml'));
  return candidates.find((p) => p.signInAddress === true) || candidates[0] || null;
}

// Origin of an organization's sign-in address, e.g. https://{slug}.docsync.com (set TENANT_URL_TEMPLATE).
function tenantOrigin(slug) {
  const template = process.env.TENANT_URL_TEMPLATE;
  return template ? template.replace('{slug}', slug) : null;
}

// Branding for an organization's sign-in page. Exposes only the name and whether SSO is set up.
router.get('/sso/org/:slug', authRateLimit, async (req, res) => {
  const found = await findTenantBySlug(req.params.slug);
  if (!found) return res.status(404).json({ error: 'Workspace not found.' });

  const usesSso = found.security.signInAddressUsesSso !== false;
  const provider = usesSso ? findOrganizationSsoProvider(found.security) : null;
  res.json({
    name: found.tenant.name,
    slug: String(req.params.slug).toLowerCase(),
    ssoAvailable: Boolean(provider),
    providerName: provider?.name || null,
    providerType: provider?.type || null,
    passwordSignIn: !usesSso,
  });
});

// Organization sign-in: the user has opened <slug>.<base domain> and chosen SSO.
router.get('/sso/org/:slug/login', authRateLimit, async (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  const origin = tenantOrigin(slug);
  const landing = origin || process.env.FRONTEND_URL || 'http://localhost:5173';
  const fail = (message) => res.redirect(`${landing}/auth?sso_error=${encodeURIComponent(message)}`);

  if (!origin) return fail('Organization sign-in is not configured.');
  try {
    const found = await findTenantBySlug(slug);
    if (found && found.security.signInAddressUsesSso === false) return fail('This address signs in with email and password.');
    const provider = found ? findOrganizationSsoProvider(found.security) : null;
    if (!provider) return fail('This workspace has no active SSO provider.');

    if (provider.type === 'saml') {
      // The IdP posts back to this workspace's own ACS URL, so the session cookie is set on the workspace host.
      const { authorizeUrl } = await generateSamlAuthRequest(provider, `${origin}/api/auth/saml/acs`, `${ORG_RELAY_PREFIX}${slug}`);
      return res.redirect(authorizeUrl);
    }

    const { authorizationUrl, txn } = await beginLogin(
      getTenantLoginConfig(found.tenant.id, provider),
      `${origin}/auth/callback`,
      { tenantSlug: slug, providerId: provider.id },
    );
    setSsoTxn(res, txn);
    return res.redirect(authorizationUrl);
  } catch (error) {
    console.error('[SSO] Could not start organization login:', error.message);
    return fail('Sign-in with this workspace is not available.');
  }
});

// "Continue with Google / Microsoft" on the main site: a personal sign-in, never a workspace join.
router.get('/sso/login/:provider', authRateLimit, async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const config = getPlatformConfig(String(req.params.provider || '').toLowerCase());
  if (!config) return res.redirect(`${frontendUrl}/auth?sso_error=${encodeURIComponent('Unknown sign-in provider.')}`);

  try {
    const { authorizationUrl, txn } = await beginLogin(config, `${frontendUrl}/auth/callback`);
    setSsoTxn(res, txn);
    return res.redirect(authorizationUrl);
  } catch (error) {
    console.error('[SSO] Could not start platform login:', error.message);
    return res.redirect(`${frontendUrl}/auth?sso_error=${encodeURIComponent('Sign-in with this provider is not available.')}`);
  }
});

// Creates the session. `tenant` is null for personal sign-ins, which get a personal workspace
// instead of joining one. Organization sign-ins only reach here after the membership check.
async function finishSsoLogin(req, res, { tenant, userInfo, providerName }) {
  const normalizedEmail = String(userInfo.email).toLowerCase().trim();
  let user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: { tenantMemberships: true },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        id: uuidv4(),
        name: userInfo.name || normalizedEmail.split('@')[0],
        email: normalizedEmail,
        passwordHash: await bcrypt.hash(uuidv4(), 12),
        createdAt: new Date(),
        accountType: 'individual',
        emailVerified: true,
        failedLoginAttempts: 0,
        lockoutUntil: null,
        role: 'user',
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorTempSecret: null,
        currentTenantId: tenant?.id ?? null,
      },
      include: { tenantMemberships: true },
    });
  }

  if (tenant) await ensureTenantMembership(user.id, tenant.id, normalizedEmail);

  await ensureTenantBootstrapForUser(user);
  user = await syncCurrentTenantFromMembership(user);

  if (!user) {
    console.error('[SSO] syncCurrentTenantFromMembership returned null for user:', normalizedEmail);
    audit(req, 'sso-exchange', 'failure', null, { reason: 'sync-tenant-failed' });
    return res.status(500).json({ error: 'Failed to sync tenant membership. Please try again.' });
  }

  if (!await isTenantIpAllowedForUser(req, user)) {
    audit(req, 'sso-exchange-ip-policy', 'failure', user.id, {
      reason: 'ip-not-allowlisted',
      tenantId: tenant?.id ?? null,
    });
    return res.status(403).json({ error: 'Your tenant only allows access from approved IP addresses' });
  }

  user.lastLoginAt = nowIso();
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(user.lastLoginAt) },
  });

  const authScope = getAuthScope(req);
  const { refreshToken, csrfToken, session } = await createSession(user, req, false);
  writeSessionCookies(res, refreshToken, csrfToken, session.expiresAt, authScope);

  audit(req, 'sso-exchange', 'success', user.id, {
    provider: providerName,
    sessionId: session.id,
    tenantId: tenant?.id ?? null,
  });

  res.json(await buildAuthResponse(user, session));
}

async function completePersonalLogin(req, res, txn, params) {
  let identity;
  try {
    identity = await completeLogin(getPlatformConfig(txn.provider), txn, params);
  } catch (error) {
    console.error('[SSO] Platform login failed:', error.message);
    audit(req, 'sso-exchange', 'failure', null, { reason: 'platform-login-failed', provider: txn.provider });
    return res.status(400).json({ error: 'SSO authentication failed. Please try again.' });
  }

  if (!identity.email || !identity.email.includes('@')) {
    audit(req, 'sso-exchange', 'failure', null, { reason: 'no-email-in-claims' });
    return res.status(400).json({ error: 'Email not provided by SSO provider' });
  }

  // No tenant lookup: signing in never adds someone to a workspace.
  return finishSsoLogin(req, res, { tenant: null, userInfo: identity, providerName: identity.providerName });
}

async function completeOrganizationLogin(req, res, txn, params) {
  const found = await findTenantBySlug(txn.tenantSlug);
  const provider = found?.security.ssoProviders.find((p) => p.id === txn.providerId && p.enabled !== false);
  if (!found || !provider) {
    audit(req, 'sso-exchange', 'failure', null, { reason: 'no-active-provider', tenantSlug: txn.tenantSlug });
    return res.status(400).json({ error: 'This workspace has no active SSO provider.' });
  }
  const { tenant, security } = found;

  let identity;
  try {
    identity = await completeLogin(getTenantLoginConfig(tenant.id, provider), txn, params);
  } catch (error) {
    console.error('[SSO] Organization login failed:', error.message);
    audit(req, 'sso-exchange', 'failure', null, { reason: 'token-exchange-failed', tenantId: tenant.id });
    return res.status(400).json({ error: 'SSO authentication failed. Please verify your SSO configuration.' });
  }

  if (!identity.email || !identity.email.includes('@')) {
    audit(req, 'sso-exchange', 'failure', null, { reason: 'no-email-in-claims', tenantId: tenant.id });
    return res.status(400).json({ error: 'Email not provided by SSO provider' });
  }

  const emailDomain = identity.email.split('@').pop();
  if (security.domainMappings.length && !security.domainMappings.includes(emailDomain)) {
    audit(req, 'sso-exchange', 'failure', null, { reason: 'domain-not-allowed', tenantId: tenant.id });
    return res.status(403).json({ error: 'Your email domain is not allowed for this workspace.' });
  }

  // Invite-only: the user must already be an active member. Membership is never created here.
  const membership = await prisma.tenantMembership.findFirst({
    where: { tenantId: tenant.id, email: identity.email, status: 'active' },
  });
  if (!membership) {
    audit(req, 'sso-exchange', 'failure', null, { reason: 'not-a-member', tenantId: tenant.id });
    return res.status(403).json({ error: NOT_A_MEMBER_MESSAGE });
  }

  return finishSsoLogin(req, res, { tenant, userInfo: identity, providerName: provider.name });
}

// Browser callback (/auth/callback on the main site or on the organization's address) posts here.
router.post('/sso/exchange-code', authRateLimit, async (req, res) => {
  const { code, state } = req.body;
  if (!code || !state) {
    return res.status(400).json({ error: 'code and state are required' });
  }

  const txn = readSsoTxn(req);
  clearSsoTxn(res);
  if (!txn) {
    return res.status(400).json({ error: 'Your sign-in session expired. Please try again.' });
  }

  try {
    if (txn.tenantSlug) return await completeOrganizationLogin(req, res, txn, { code, state });
    return await completePersonalLogin(req, res, txn, { code, state });
  } catch (error) {
    console.error('SSO exchange error:', error.message);
    console.error('SSO exchange error stack:', error.stack);
    audit(req, 'sso-exchange', 'failure', null, { reason: 'unknown-error' });
    res.status(500).json({ error: 'SSO authentication failed. Please try again.' });
  }
});

router.get('/saml/authorize', authRateLimit, async (req, res) => {
  const email = String(req.query?.email || '').toLowerCase().trim();
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required.' });
  }

  try {
    const tenant = await findTenantByDomain(email);
    if (!tenant) {
      return res.status(404).json({ error: 'No tenant configured for this email domain.' });
    }

    const security = await getTenantSecurityState(tenant.id);
    const provider = security.ssoProviders.find((p) => p.type === 'saml' && p.enabled !== false);
    if (!provider) {
      return res.status(400).json({ error: 'No active SAML provider configured.' });
    }

    const callbackUrl = `${apiPublicUrl()}/api`;
    const { authorizeUrl, samlRequest } = await generateSamlAuthRequest(provider, `${callbackUrl}/auth/saml/acs`, email);

    res.json({
      authorizationUrl: authorizeUrl,
      samlRequest: samlRequest,
    });
  } catch (error) {
    console.error('SAML authorization URL generation failed:', error);
    res.status(500).json({ error: 'Failed to generate SAML authorization URL.' });
  }
});

router.post('/saml/acs', authRateLimit, async (req, res) => {
  const { SAMLResponse, RelayState } = req.body;
  // Failures go back to the sign-in page with the reason, not to a raw JSON response.
  let landing = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (!SAMLResponse) {
    return redirectSsoFailure(res, landing, 'SAML response is required.');
  }

  try {
    // RelayState carries the email the user typed on /saml/authorize, so we
    // can resolve the tenant + provider BEFORE attempting signature validation.
    const relayStateValue = (() => {
      try {
        return Buffer.from(String(RelayState || ''), 'base64').toString('utf8');
      } catch {
        return '';
      }
    })();

    // Organization sign-in: RelayState names the workspace slug, and the callback is that workspace's own ACS URL.
    const orgSlug = relayStateValue.startsWith(ORG_RELAY_PREFIX)
      ? relayStateValue.slice(ORG_RELAY_PREFIX.length).toLowerCase().trim()
      : null;
    const origin = orgSlug ? tenantOrigin(orgSlug) : null;
    if (origin) landing = origin;
    if (orgSlug && !origin) {
      audit(req, 'saml-acs', 'failure', null, { reason: 'org-sign-in-not-configured' });
      return redirectSsoFailure(res, landing, 'Organization sign-in is not configured.');
    }

    // Email RelayState (from /saml/authorize): the tenant is found from the email domain.
    const state_email = orgSlug ? '' : relayStateValue.toLowerCase().trim();
    if (!orgSlug && (!state_email || !state_email.includes('@'))) {
      audit(req, 'saml-acs', 'failure', null, { reason: 'invalid-relay-state' });
      return redirectSsoFailure(res, landing, 'Invalid or missing RelayState.');
    }

    const found = orgSlug ? await findTenantBySlug(orgSlug) : null;
    const tenant = orgSlug ? found?.tenant : await findTenantByDomain(state_email);
    if (!tenant) {
      audit(req, 'saml-acs', 'failure', null, { reason: 'no-tenant-mapping', email: state_email || null, slug: orgSlug });
      return redirectSsoFailure(res, landing, orgSlug ? 'Organization not found.' : 'No tenant configured for this email domain.');
    }

    const security = orgSlug ? found.security : await getTenantSecurityState(tenant.id);
    const provider = orgSlug
      ? findOrganizationSsoProvider(security)
      : security.ssoProviders.find((p) => p.type === 'saml' && p.enabled !== false);
    if (!provider || provider.type !== 'saml') {
      audit(req, 'saml-acs', 'failure', null, { reason: 'no-active-provider', tenantId: tenant.id });
      return redirectSsoFailure(res, landing, 'No active SAML provider configured.');
    }

    const callbackUrl = origin ? `${origin}/api/auth/saml/acs` : `${apiPublicUrl()}/api/auth/saml/acs`;
    let samlProfile;
    try {
      samlProfile = await validateSamlResponse(provider, SAMLResponse, RelayState, callbackUrl);
    } catch (samlError) {
      console.error('[SAML] SAML response validation failed for provider:', provider.name);
      console.error('[SAML] Error stack:', samlError.stack);
      audit(req, 'saml-acs', 'failure', null, { reason: 'saml-validation-failed' });
      return redirectSsoFailure(res, landing, 'SAML authentication failed. Please verify your SSO configuration.');
    }

    let userInfo;
    try {
      userInfo = extractSamlUserInfo(samlProfile);
    } catch (userError) {
      console.error('[SAML] User info extraction failed');
      console.error('[SAML] Error stack:', userError.stack);
      audit(req, 'saml-acs', 'failure', null, { reason: 'userinfo-extraction-failed' });
      return redirectSsoFailure(res, landing, 'Failed to extract user information. Please try again.');
    }

    if (!userInfo.email) {
      audit(req, 'saml-acs', 'failure', null, { reason: 'no-email-in-claims' });
      return redirectSsoFailure(res, landing, 'Email not provided by SSO provider');
    }

    // Invite-only: a sign-in never adds a user to a workspace, so the user must already be an active member.
    const memberOfTenant = await prisma.tenantMembership.findFirst({
      where: { tenantId: tenant.id, email: String(userInfo.email).toLowerCase().trim(), status: 'active' },
    });
    if (!memberOfTenant) {
      audit(req, 'saml-acs', 'failure', null, { reason: 'not-a-member', tenantId: tenant.id });
      return redirectSsoFailure(res, landing, NOT_A_MEMBER_MESSAGE);
    }

    const normalizedEmail = String(userInfo.email).toLowerCase().trim();

    let user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { tenantMemberships: true },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          id: uuidv4(),
          name: userInfo.name || normalizedEmail.split('@')[0],
          email: normalizedEmail,
          passwordHash: await bcrypt.hash(uuidv4(), 12),
          createdAt: new Date(),
          accountType: 'individual',
          emailVerified: true,
          failedLoginAttempts: 0,
          lockoutUntil: null,
          role: 'user',
          twoFactorEnabled: false,
          twoFactorSecret: null,
          twoFactorTempSecret: null,
          currentTenantId: tenant.id,
        },
        include: { tenantMemberships: true },
      });
    }

    // Ensure membership exists and is active (single call, no extra fetch)
    await ensureTenantMembership(user.id, tenant.id, normalizedEmail);

    // Bootstrap tenant if needed, then sync tenant from membership
    await ensureTenantBootstrapForUser(user);
    user = await syncCurrentTenantFromMembership(user);

    if (!user) {
      console.error('[SAML] syncCurrentTenantFromMembership returned null for user:', normalizedEmail);
      audit(req, 'saml-acs', 'failure', null, { reason: 'sync-tenant-failed' });
      return redirectSsoFailure(res, landing, 'Failed to sync tenant membership. Please try again.');
    }

    if (!await isTenantIpAllowedForUser(req, user)) {
      audit(req, 'saml-acs-ip-policy', 'failure', user.id, {
        reason: 'ip-not-allowlisted',
        tenantId: tenant.id,
      });
      return redirectSsoFailure(res, landing, 'Your tenant only allows access from approved IP addresses.');
    }

    user.lastLoginAt = nowIso();
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(user.lastLoginAt) },
    });

    const { refreshToken, csrfToken, session } = await createSession(user, req, false);
    // The IdP POST is cross-site, so SameSite=Lax cookies would be dropped by the browser.
    writeSessionCookies(res, refreshToken, csrfToken, session.expiresAt, 'workspace', true);

    audit(req, 'saml-acs', 'success', user.id, {
      provider: provider.name,
      sessionId: session.id,
      tenantId: tenant.id,
    });

    res.redirect(303, `${origin || process.env.FRONTEND_URL || 'http://localhost:5173'}/auth/saml/success`);
  } catch (error) {
    console.error('SAML ACS error:', error);
    audit(req, 'saml-acs', 'failure', null, { error: error.message });
    return redirectSsoFailure(res, landing, 'SAML authentication failed. Please try again.');
  }
});

module.exports = router;
