const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../../db/client');
const { nowIso, isDatabaseConfigured, normalizeSession, getRequestIp } = require('../../lib/runtime-utils');
const {
  authSessions,
  authTokens,
  getOrganizationSecurityState,
  users,
} = require('../../store');
const {
  generateOpaqueToken,
  getCookieOptions,
  getCsrfCookieOptions,
  hashToken,
  resolveCookieNames,
  signAccessToken,
} = require('./core');

const REMEMBER_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const STANDARD_SESSION_MS = 8 * 60 * 60 * 1000;

function toSessionWriteData(session) {
  return {
    userId: session.userId,
    refreshTokenHash: session.refreshTokenHash,
    csrfToken: session.csrfToken,
    createdAt: new Date(session.createdAt),
    lastUsedAt: new Date(session.lastUsedAt),
    expiresAt: new Date(session.expiresAt),
    revokedAt: session.revokedAt ? new Date(session.revokedAt) : null,
    remember: Boolean(session.remember),
    userAgent: session.userAgent,
    ipAddress: session.ipAddress,
  };
}

function getUserAgent(req) {
  if (!req) return 'unknown';
  return req.get?.('user-agent') || req.headers?.['user-agent'] || 'unknown';
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
  if (!user.accountType) user.accountType = 'individual';
  if (typeof user.emailVerified !== 'boolean') user.emailVerified = false;
  if (typeof user.failedLoginAttempts !== 'number') user.failedLoginAttempts = 0;
  if (user.lockoutUntil === undefined) user.lockoutUntil = null;
  if (typeof user.twoFactorEnabled !== 'boolean') user.twoFactorEnabled = false;
  if (user.twoFactorSecret === undefined) user.twoFactorSecret = null;
  if (user.twoFactorTempSecret === undefined) user.twoFactorTempSecret = null;
  if (user.currentOrganizationId === undefined) user.currentOrganizationId = null;
  return user;
}

function createAuthRouteHelpers({
  decryptPassword,
  users: routeUsers,
  writeAuditLog,
  getRequestIp: routeGetRequestIp,
  getUserAgent: routeGetUserAgent,
  prisma: routePrisma,
}) {
  function resolvePasswordFromBody(body) {
    const raw = body ?? {};
    if (raw.passwordEncrypted) {
      return decryptPassword(String(raw.passwordEncrypted).trim());
    }
    if (typeof raw.password === 'string' && raw.password.length > 0) {
      return raw.password;
    }
    throw new Error('Password payload is required.');
  }

  function audit(req, action, status, userId = null, metadata = {}) {
    const user = userId ? routeUsers.get(userId) : null;
    return writeAuditLog({
      userId,
      organizationId: user?.currentOrganizationId || metadata.organizationId || null,
      action,
      status,
      ipAddress: routeGetRequestIp(req),
      userAgent: routeGetUserAgent(req),
      metadata: {
        ...metadata,
      },
    });
  }

  async function ensureUserPersistedToDb(user, billing) {
    if (!process.env.DATABASE_URL) return;

    await routePrisma.user.create({
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

    await routePrisma.userBilling.upsert({
      where: { email: user.email },
      update: {
        userId: user.id,
        email: user.email,
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
        email: user.email,
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

  return {
    resolvePasswordFromBody,
    audit,
    ensureUserPersistedToDb,
  };
}

function publicUser(user) {
  const current = ensureUserShape(user);
  return {
    id: current.id,
    name: current.name,
    email: current.email,
    accountType: current.accountType,
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

async function pruneExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of authSessions.entries()) {
    if (session.revokedAt || new Date(session.expiresAt).getTime() <= now) {
      authSessions.delete(id);
    }
  }

  if (!isDatabaseConfigured()) return;

  await prisma.authSession.updateMany({
    where: {
      revokedAt: null,
      expiresAt: { lte: new Date() },
    },
    data: {
      revokedAt: new Date(),
    },
  });
}

function clearAuthCookies(res, scope = 'workspace') {
  const cookieNames = resolveCookieNames(scope);
  res.clearCookie(cookieNames.refreshCookie, { path: '/' });
  res.clearCookie(cookieNames.csrfCookie, { path: '/' });
}

async function createSession(user, req, remember) {
  await pruneExpiredSessions();
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
  if (isDatabaseConfigured()) {
    await prisma.authSession.create({
      data: {
        id: session.id,
        ...toSessionWriteData(session),
      },
    });
  }
  return { refreshToken, csrfToken, session };
}

async function rotateSession(session, req) {
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
  if (isDatabaseConfigured()) {
    await prisma.authSession.upsert({
      where: { id: session.id },
      update: {
        refreshTokenHash: session.refreshTokenHash,
        csrfToken: session.csrfToken,
        lastUsedAt: new Date(session.lastUsedAt),
        expiresAt: new Date(session.expiresAt),
        userAgent: session.userAgent,
        ipAddress: session.ipAddress,
      },
      create: {
        id: session.id,
        ...toSessionWriteData(session),
      },
    });
  }
  return { refreshToken, csrfToken, session };
}

async function getSessionById(sessionId) {
  const cached = authSessions.get(sessionId);
  if (cached) return cached;
  if (!isDatabaseConfigured()) return null;

  const session = normalizeSession(
    await prisma.authSession.findUnique({
      where: { id: sessionId },
    }),
  );
  if (!session) return null;
  authSessions.set(session.id, session);
  return session;
}

function matchesRefreshToken(session, token) {
  return session.refreshTokenHash === hashToken(token);
}

async function findSessionByRefreshToken(refreshToken) {
  if (!refreshToken) return null;
  const refreshTokenHash = hashToken(refreshToken);

  if (isDatabaseConfigured()) {
    const dbSession = normalizeSession(
      await prisma.authSession.findFirst({
        where: {
          refreshTokenHash,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { lastUsedAt: 'desc' },
      }),
    );
    if (dbSession) {
      authSessions.set(dbSession.id, dbSession);
      return dbSession;
    }
  }

  return [...authSessions.values()].find((session) => matchesRefreshToken(session, refreshToken)) || null;
}

async function listActiveSessionsForUser(userId) {
  if (isDatabaseConfigured()) {
    const sessions = await prisma.authSession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastUsedAt: 'desc' },
    });

    return sessions.map((session) => {
      const normalized = normalizeSession(session);
      authSessions.set(normalized.id, normalized);
      return normalized;
    });
  }

  return [...authSessions.values()]
    .filter((session) => session.userId === userId && !session.revokedAt && new Date(session.expiresAt).getTime() > Date.now())
    .sort((a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime());
}

async function countActiveSessionsForUser(userId) {
  if (isDatabaseConfigured()) {
    return prisma.authSession.count({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
  }

  return [...authSessions.values()].filter(
    (session) => session.userId === userId && !session.revokedAt && new Date(session.expiresAt).getTime() > Date.now(),
  ).length;
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

function validateCsrf(req, session) {
  const header = req.get('x-csrf-token');
  return Boolean(header && session && header === session.csrfToken);
}

async function revokeSession(sessionId) {
  const session = await getSessionById(sessionId);
  if (!session) return null;

  session.revokedAt = nowIso();
  authSessions.set(session.id, session);

  if (isDatabaseConfigured()) {
    await prisma.authSession.updateMany({
      where: { id: session.id },
      data: {
        revokedAt: new Date(session.revokedAt),
      },
    });
  }

  return session;
}

async function revokeAllUserSessions(userId) {
  const revokedAt = nowIso();

  for (const session of authSessions.values()) {
    if (session.userId === userId && !session.revokedAt) {
      session.revokedAt = revokedAt;
      authSessions.set(session.id, session);
    }
  }

  if (isDatabaseConfigured()) {
    await prisma.authSession.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(revokedAt),
      },
    });
  }
}

async function findUserByIdentifier(identifier) {
  const normalized = String(identifier || '').toLowerCase();
  if (!normalized || !isDatabaseConfigured()) return null;

  const dbUser = await prisma.user.findUnique({ where: { email: normalized } });
  if (!dbUser) return null;

  return ensureUserShape({
    ...dbUser,
    createdAt: dbUser.createdAt instanceof Date ? dbUser.createdAt.toISOString() : dbUser.createdAt,
    updatedAt: dbUser.updatedAt instanceof Date ? dbUser.updatedAt.toISOString() : dbUser.updatedAt,
    lockoutUntil: dbUser.lockoutUntil ? dbUser.lockoutUntil.toISOString() : null,
    lastLoginAt: dbUser.lastLoginAt ? dbUser.lastLoginAt.toISOString() : null,
  });
}

module.exports = {
  nowIso,
  getRequestIp,
  getUserAgent,
  isOrgIpAllowedForUser,
  ensureUserShape,
  createAuthRouteHelpers,
  publicUser,
  issueOneTimeToken,
  consumeOneTimeToken,
  clearAuthCookies,
  createSession,
  rotateSession,
  getSessionById,
  findSessionByRefreshToken,
  listActiveSessionsForUser,
  countActiveSessionsForUser,
  writeSessionCookies,
  buildAuthResponse,
  validateCsrf,
  revokeSession,
  revokeAllUserSessions,
  findUserByIdentifier,
};
