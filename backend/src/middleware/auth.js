const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { prisma } = require('../db/client');
const { authSessions, syncCurrentOrganizationFromMembership, getOrganizationSecurityState, users } = require('../store');

const JWT_SECRET = process.env.JWT_SECRET || 'docsync_dev_secret_change_in_production';
const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const INACTIVITY_TTL_MS = 30 * 60 * 1000; // Session expires after 30 min of UI inactivity
const REFRESH_COOKIE = 'docsync_refresh';
const CSRF_COOKIE = 'docsync_csrf';
const ADMIN_REFRESH_COOKIE = 'docsync_admin_refresh';
const ADMIN_CSRF_COOKIE = 'docsync_admin_csrf';

function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function normalizeSession(session) {
  if (!session) return null;
  return {
    ...session,
    createdAt: session.createdAt instanceof Date ? session.createdAt.toISOString() : session.createdAt,
    lastUsedAt: session.lastUsedAt instanceof Date ? session.lastUsedAt.toISOString() : session.lastUsedAt,
    expiresAt: session.expiresAt instanceof Date ? session.expiresAt.toISOString() : session.expiresAt,
    revokedAt:
      session.revokedAt instanceof Date
        ? session.revokedAt.toISOString()
        : session.revokedAt || null,
    remember: Boolean(session.remember),
  };
}

function resolveCookieNames(scope) {
  if (scope === 'admin') {
    return {
      refreshCookie: ADMIN_REFRESH_COOKIE,
      csrfCookie: ADMIN_CSRF_COOKIE,
    };
  }
  return {
    refreshCookie: REFRESH_COOKIE,
    csrfCookie: CSRF_COOKIE,
  };
}

function getAuthScope(req) {
  const headerScope = String(req?.get?.('x-auth-scope') || req?.headers?.['x-auth-scope'] || '').toLowerCase();
  return headerScope === 'admin' ? 'admin' : 'workspace';
}

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

async function resolveUserFromSession(sessionId) {
  let session = authSessions.get(sessionId);
  if (!session && isDatabaseConfigured()) {
    session = normalizeSession(await prisma.authSession.findUnique({ where: { id: sessionId } }));
    if (session) authSessions.set(session.id, session);
  }
  if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    return null;
  }
  // Inactivity check: if the user has been idle for 30 minutes, treat the session as expired.
  if (new Date(session.lastUsedAt).getTime() + INACTIVITY_TTL_MS <= Date.now()) {
    session.revokedAt = new Date().toISOString();
    authSessions.set(session.id, session);
    if (isDatabaseConfigured()) {
      await prisma.authSession.updateMany({
        where: { id: session.id },
        data: {
          revokedAt: new Date(session.revokedAt),
        },
      });
    }
    return null;
  }
  const user = users.get(session.userId);
  if (!user) return null;
  await syncCurrentOrganizationFromMembership(user);
  return { session, user };
}

function getRequestIp(req) {
  return req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip || 'unknown';
}

function isIpAllowed(req, user) {
  if (!user?.currentOrganizationId) return true;
  const security = getOrganizationSecurityState(user.currentOrganizationId);
  if (!security?.ipAllowlistEnabled || !security.ipAllowlist?.length) return true;
  const requestIp = getRequestIp(req);
  return security.ipAllowlist.includes(requestIp);
}

async function requireAuth(req, res, next) {
  try {
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

    const resolved = await resolveUserFromSession(payload.sid);
    if (!resolved || resolved.user.id !== payload.sub) {
      return res.status(401).json({ error: 'Session invalid or expired.' });
    }
    if (!isIpAllowed(req, resolved.user)) {
      return res.status(403).json({ error: 'Your organization only allows access from approved IP addresses.' });
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

    // Slide the inactivity window: any authenticated request counts as activity.
    resolved.session.lastUsedAt = new Date().toISOString();
    authSessions.set(resolved.session.id, resolved.session);
    if (isDatabaseConfigured()) {
      await prisma.authSession.updateMany({
        where: { id: resolved.session.id },
        data: { lastUsedAt: new Date(resolved.session.lastUsedAt) },
      });
    }

    next();
  } catch {
    return res.status(500).json({ error: 'Authentication service unavailable.' });
}
}

module.exports = {
  getAuthScope,
  resolveCookieNames,
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
