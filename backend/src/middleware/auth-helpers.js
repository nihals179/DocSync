const { v4: uuidv4 } = require('uuid');
const {
  authSessions,
  authTokens,
  ensureTenantBootstrapForUser,
  getOrganizationSecurityState,
  users,
} = require('../store');
const {
  generateOpaqueToken,
  getCookieOptions,
  getCsrfCookieOptions,
  hashToken,
  resolveCookieNames,
  signAccessToken,
} = require('./auth');

const REMEMBER_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const STANDARD_SESSION_MS = 8 * 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function getRequestIp(req) {
  return req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.ip || 'unknown';
}

function getUserAgent(req) {
  return req.get('user-agent') || 'unknown';
}

function isOrgIpAllowedForUser(req, user) {
  if (!user?.currentOrganizationId) return true;
  const security = getOrganizationSecurityState(user.currentOrganizationId);
  if (!security?.ipAllowlistEnabled || !Array.isArray(security.ipAllowlist) || security.ipAllowlist.length === 0) {
    return true;
  }
  return security.ipAllowlist.includes(getRequestIp(req));
}

function getOrgSessionDurationMs(user, remember) {
  if (!user?.currentOrganizationId) {
    return remember ? REMEMBER_SESSION_MS : STANDARD_SESSION_MS;
  }
  const security = getOrganizationSecurityState(user.currentOrganizationId);
  if (!security) {
    return remember ? REMEMBER_SESSION_MS : STANDARD_SESSION_MS;
  }
  const orgMs = Math.min(24, Math.max(1, Number(security.sessionDurationHours || 8))) * 60 * 60 * 1000;
  return remember ? Math.min(REMEMBER_SESSION_MS, orgMs) : orgMs;
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

function clearAuthCookies(res, scope = 'workspace') {
  const cookieNames = resolveCookieNames(scope);
  res.clearCookie(cookieNames.refreshCookie, { path: '/' });
  res.clearCookie(cookieNames.csrfCookie, { path: '/' });
}

function createSession(user, req, remember) {
  pruneExpiredSessions();
  const refreshToken = generateOpaqueToken();
  const csrfToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + getOrgSessionDurationMs(user, remember)).toISOString();
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
  const user = users.get(session.userId);
  session.expiresAt = new Date(Date.now() + getOrgSessionDurationMs(user, session.remember)).toISOString();
  session.userAgent = getUserAgent(req);
  session.ipAddress = getRequestIp(req);
  authSessions.set(session.id, session);
  return { refreshToken, csrfToken, session };
}

function writeSessionCookies(res, refreshToken, csrfToken, expiresAt, scope = 'workspace') {
  const cookieNames = resolveCookieNames(scope);
  res.cookie(cookieNames.refreshCookie, refreshToken, getCookieOptions(expiresAt));
  res.cookie(cookieNames.csrfCookie, csrfToken, getCsrfCookieOptions(expiresAt));
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

module.exports = {
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
};
