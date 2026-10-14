function nowIso() {
  return new Date().toISOString();
}

function isDatabaseConfigured() {
  const value = String(process.env.DATABASE_URL || '').trim().toLowerCase();
  return value.startsWith('postgres://') || value.startsWith('postgresql://');
}

function toIsoOrNull(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
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

function getRequestIp(req) {
  if (!req) return 'unknown';

  const trustProxy = ['1', 'true', 'yes'].includes(String(process.env.TRUST_PROXY || '').toLowerCase());
  if (trustProxy) {
    const forwarded = req.headers?.['x-forwarded-for']?.toString().split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }

  return req.ip || req.socket?.remoteAddress || 'unknown';
}

module.exports = {
  nowIso,
  isDatabaseConfigured,
  toIsoOrNull,
  normalizeSession,
  getRequestIp,
};
