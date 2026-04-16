const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { authSessions, ensureTenantBootstrapForUser, users } = require('../store');

const JWT_SECRET = process.env.JWT_SECRET || 'docsync_dev_secret_change_in_production';
const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_COOKIE = 'docsync_refresh';
const CSRF_COOKIE = 'docsync_csrf';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateOpaqueToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getCookieOptions(expiresAt) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(expiresAt),
  };
}

function getCsrfCookieOptions(expiresAt) {
  return {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(expiresAt),
  };
}

function signAccessToken(user, sessionId) {
  const token = jwt.sign(
    { sub: user.id, sid: sessionId, type: 'access' },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL },
  );
  return {
    token,
    expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString(),
  };
}

function signTwoFactorToken(userId, remember) {
  return jwt.sign(
    { sub: userId, type: '2fa-pending', remember: Boolean(remember) },
    JWT_SECRET,
    { expiresIn: '10m' },
  );
}

function verifyTwoFactorToken(token) {
  const payload = jwt.verify(token, JWT_SECRET);
  if (payload.type !== '2fa-pending' || typeof payload.sub !== 'string') {
    throw new Error('Invalid two-factor token.');
  }
  return payload;
}

function resolveUserFromSession(sessionId) {
  const session = authSessions.get(sessionId);
  if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    return null;
  }
  const user = users.get(session.userId);
  if (!user) return null;
  ensureTenantBootstrapForUser(user);
  return { session, user };
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }

  const token = header.slice(7);
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token invalid or expired.' });
  }

  if (payload.type !== 'access' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
    return res.status(401).json({ error: 'Token invalid or expired.' });
  }

  const resolved = resolveUserFromSession(payload.sid);
  if (!resolved || resolved.user.id !== payload.sub) {
    return res.status(401).json({ error: 'Session invalid or expired.' });
  }

  req.user = {
    id: resolved.user.id,
    name: resolved.user.name,
    email: resolved.user.email,
    emailVerified: resolved.user.emailVerified,
    twoFactorEnabled: resolved.user.twoFactorEnabled,
    currentOrganizationId: resolved.user.currentOrganizationId || null,
  };
  req.authSession = resolved.session;
  req.accessToken = token;
  next();
}

module.exports = {
  JWT_SECRET,
  REFRESH_COOKIE,
  CSRF_COOKIE,
  hashToken,
  generateOpaqueToken,
  getCookieOptions,
  getCsrfCookieOptions,
  signAccessToken,
  signTwoFactorToken,
  verifyTwoFactorToken,
  resolveUserFromSession,
  requireAuth,
};
