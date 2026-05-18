const express = require('express');
const { generateSync: _totpGenerateSync, verifySync: _totpVerifySync } = require('@otplib/totp');
const { NobleCryptoPlugin: _NobleCryptoPlugin } = require('@otplib/plugin-crypto-noble');
const { ScureBase32Plugin: _ScureBase32Plugin } = require('@otplib/plugin-base32-scure');
const { generateSecret: _otpGenerateSecret } = require('otplib');
const { generateTOTP: _generateTOTP } = require('@otplib/uri');
const QRCode = require('qrcode');

const { prisma } = require('../db/client');
const { writeAuditLog, listAuditLogs } = require('../lib/audit');
const { getPasswordEncryptionPublicKey } = require('../lib/password-crypto');
const {
  getAuthScope,
  requireAuth,
  verifyTwoFactorToken,
} = require('../middleware/auth/core');
const {
  nowIso,
  getRequestIp,
  getUserAgent,
  isOrgIpAllowedForUser,
  ensureUserShape,
  publicUser,
  createSession,
  countActiveSessionsForUser,
  writeSessionCookies,
  buildAuthResponse,
} = require('../middleware/auth');
const { authRateLimit, loginRateLimit } = require('../middleware/auth/rate-limit');
const { getAuthConfig } = require('../config/auth-config');

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

const router = express.Router();

async function getUserById(userId) {
  return prisma.user.findUnique({ where: { id: userId } });
}

function audit(req, action, status, userId = null, metadata = {}) {
  return writeAuditLog({
    userId,
    organizationId: req.user?.currentOrganizationId || metadata.organizationId || null,
    action,
    status,
    ipAddress: getRequestIp(req),
    userAgent: getUserAgent(req),
    metadata: {
      ...metadata,
    },
  });
}

router.post('/login/2fa', loginRateLimit, async (req, res) => {
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

  const user = ensureUserShape(await getUserById(pending.sub));
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

  user.lastLoginAt = nowIso();
  await prisma.user.updateMany({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(user.lastLoginAt),
    },
  });

  const { refreshToken, csrfToken, session } = await createSession(user, req, Boolean(pending.remember));
  writeSessionCookies(res, refreshToken, csrfToken, session.expiresAt, authScope);
  audit(req, 'login-2fa', 'success', user.id, { sessionId: session.id });
  res.json(buildAuthResponse(user, session));
});

router.get('/public-key', authRateLimit, (req, res) => {
  res.json(getPasswordEncryptionPublicKey());
});

router.get('/audit-logs', requireAuth, async (req, res) => {
  const logs = await listAuditLogs({ userId: req.user.id, limit: 100 });
  res.json({ logs });
});

router.get('/security', requireAuth, async (req, res) => {
  const user = ensureUserShape(await getUserById(req.user.id));
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const activeSessions = await countActiveSessionsForUser(user.id);
  res.json({
    user: publicUser(user),
    activeSessions,
  });
});

router.post('/2fa/setup', requireAuth, async (req, res) => {
  const authConfig = await getAuthConfig();
  const user = ensureUserShape(await getUserById(req.user.id));
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const secret = authenticator.generateSecret();
  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorTempSecret: secret },
  });
  const otpauth = authenticator.keyuri(user.email, authConfig.appName, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauth);
  audit(req, '2fa-setup', 'success', user.id);
  res.json({ secret, otpauth, qrDataUrl });
});

router.post('/2fa/enable', requireAuth, async (req, res) => {
  const code = String(req.body?.code || '');
  if (!code) return res.status(400).json({ error: 'Authentication code is required.' });

  const user = ensureUserShape(await getUserById(req.user.id));
  if (!user || !user.twoFactorTempSecret) {
    return res.status(400).json({ error: 'Two-factor setup has not been started.' });
  }

  const valid = authenticator.check(code, user.twoFactorTempSecret);
  if (!valid) {
    audit(req, '2fa-enable', 'failure', req.user.id);
    return res.status(400).json({ error: 'Invalid authentication code.' });
  }

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      twoFactorSecret: user.twoFactorTempSecret,
      twoFactorTempSecret: null,
      twoFactorEnabled: true,
    },
  });
  audit(req, '2fa-enable', 'success', user.id);
  res.json({ message: 'Two-factor authentication enabled.', user: publicUser(ensureUserShape(updatedUser)) });
});

router.post('/2fa/disable', requireAuth, async (req, res) => {
  const code = String(req.body?.code || '');
  if (!code) return res.status(400).json({ error: 'Authentication code is required.' });

  const user = ensureUserShape(await getUserById(req.user.id));
  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
    return res.status(400).json({ error: 'Two-factor authentication is not enabled.' });
  }

  const valid = authenticator.check(code, user.twoFactorSecret);
  if (!valid) {
    audit(req, '2fa-disable', 'failure', user.id);
    return res.status(400).json({ error: 'Invalid authentication code.' });
  }

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorTempSecret: null,
    },
  });
  audit(req, '2fa-disable', 'success', user.id);
  res.json({ message: 'Two-factor authentication disabled.', user: publicUser(ensureUserShape(updatedUser)) });
});

module.exports = router;
