const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { prisma } = require('../../db/client');
const { isDatabaseConfigured, normalizeSession, getRequestIp } = require('../../lib/runtime-utils');

const JWT_SECRET = process.env.JWT_SECRET || 'docsync_dev_secret_change_in_production';
const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const SESSION_ACTIVITY_WRITE_THROTTLE_MS = 60 * 1000;
const TENANT_SECURITY_CACHE_TTL_MS = Number(process.env.TENANT_SECURITY_CACHE_TTL_MS || 5000);

const tenantSecurityCache = new Map();

function parseDurationToMs(input, fallbackMs) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return fallbackMs;

  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return asNumber;
  }

  const match = raw.match(/^(\d+)\s*(ms|s|m|h|d)$/);
  if (!match) return fallbackMs;

  const value = Number(match[1]);
  const unit = match[2];
  const unitMultiplier = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * unitMultiplier[unit];
}

const ACCESS_TOKEN_TTL_MS = parseDurationToMs(ACCESS_TOKEN_TTL, 15 * 60 * 1000);
const INACTIVITY_TTL_MS = 30 * 60 * 1000; // Session expires after 30 min of UI inactivity
const REFRESH_COOKIE = 'docsync_refresh';
const CSRF_COOKIE = 'docsync_csrf';
const ADMIN_REFRESH_COOKIE = 'docsync_admin_refresh';
const ADMIN_CSRF_COOKIE = 'docsync_admin_csrf';

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

function getCachedTenantSecurityState(tenantId) {
  if (!tenantId) return null;
  const cached = tenantSecurityCache.get(tenantId);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    tenantSecurityCache.delete(tenantId);
    return null;
  }
  return cached.value;
}

function setCachedTenantSecurityState(tenantId, value) {
  if (!tenantId) return;
  tenantSecurityCache.set(tenantId, {
    value,
    expiresAt: Date.now() + TENANT_SECURITY_CACHE_TTL_MS,
  });
}

function signAccessToken(user, sessionId) {
  const expiresAtMs = Date.now() + ACCESS_TOKEN_TTL_MS;
  const token = jwt.sign(
    { sub: user.id, sid: sessionId, type: 'access' },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL },
  );
  return {
    token,
    expiresAt: new Date(expiresAtMs).toISOString(),
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

function mapDbUserToAuthUser(dbUser) {
  if (!dbUser) return null;
  const currentTenant = dbUser.currentTenant
    ? {
      ...dbUser.currentTenant,
      createdAt: dbUser.currentTenant.createdAt instanceof Date
        ? dbUser.currentTenant.createdAt.toISOString()
        : dbUser.currentTenant.createdAt,
      updatedAt: dbUser.currentTenant.updatedAt instanceof Date
        ? dbUser.currentTenant.updatedAt.toISOString()
        : dbUser.currentTenant.updatedAt,
    }
    : null;
  return {
    ...dbUser,
    currentTenant,
    createdAt: dbUser.createdAt instanceof Date ? dbUser.createdAt.toISOString() : dbUser.createdAt,
    updatedAt: dbUser.updatedAt instanceof Date ? dbUser.updatedAt.toISOString() : dbUser.updatedAt,
    lockoutUntil: dbUser.lockoutUntil instanceof Date ? dbUser.lockoutUntil.toISOString() : dbUser.lockoutUntil || null,
    lastLoginAt: dbUser.lastLoginAt instanceof Date ? dbUser.lastLoginAt.toISOString() : dbUser.lastLoginAt || null,
  };
}

async function resolveUserFromSession(sessionId) {
  if (!isDatabaseConfigured()) return null;
  const sessionRow = await prisma.authSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      remember: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          twoFactorEnabled: true,
          currentTenantId: true,
          currentTenant: {
            select: {
              security: true,
            },
          },
          tenantMembership: {
            select: {
              tenantId: true,
              userId: true,
              status: true,
              email: true,
            },
          },
        },
      },
    },
  });
  const session = normalizeSession(sessionRow);
  if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    return null;
  }
  const user = mapDbUserToAuthUser(sessionRow?.user || null);
  if (!user) return null;
  return { session, user };
}

async function isIpAllowed(req, user) {
  let security = user.currentTenant?.security || null;
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

    if (!await isIpAllowed(req, resolved.user)) {
      return res.status(403).json({ error: 'Your tenant only allows access from approved IP addresses.' });
    }

    req.user = {
      id: resolved.user.id,
      name: resolved.user.name,
      email: resolved.user.email,
      emailVerified: resolved.user.emailVerified,
      twoFactorEnabled: resolved.user.twoFactorEnabled,
      currentTenantId: resolved.user.currentTenantId || null,
      tenantMembership: Array.isArray(resolved.user.tenantMembership) ? resolved.user.tenantMembership : [],
    };
    req.authSession = resolved.session;
    req.accessToken = token;

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
