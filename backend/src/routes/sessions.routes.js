const express = require('express');

const { writeAuditLog } = require('../lib/audit');
const {
  getAuthScope,
  resolveCookieNames,
  requireAuth,
  resolveUserFromSession,
} = require('../middleware/auth/core');
const {
  getRequestIp,
  getUserAgent,
  isOrgIpAllowedForUser,
  ensureUserShape,
  publicUser,
  clearAuthCookies,
  rotateSession,
  getSessionById,
  findSessionByRefreshToken,
  listActiveSessionsForUser,
  writeSessionCookies,
  buildAuthResponse,
  validateCsrf,
  revokeSession,
  revokeAllUserSessions,
} = require('../middleware/auth');
const { authRateLimit } = require('../middleware/auth/rate-limit');

const router = express.Router();

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

router.post('/refresh', authRateLimit, async (req, res) => {
  const authScope = getAuthScope(req);
  const cookieNames = resolveCookieNames(authScope);
  const refreshToken = req.cookies?.[cookieNames.refreshCookie];
  if (!refreshToken) {
    return res.status(401).json({ error: 'No refresh session available.' });
  }

  const session = await findSessionByRefreshToken(refreshToken);
  if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    clearAuthCookies(res, authScope);
    return res.status(401).json({ error: 'Refresh session invalid or expired.' });
  }
  if (!validateCsrf(req, session)) {
    return res.status(403).json({ error: 'Invalid CSRF token.' });
  }

  const resolved = await resolveUserFromSession(session.id);
  if (!resolved) {
    clearAuthCookies(res, authScope);
    return res.status(401).json({ error: 'Refresh session invalid or expired.' });
  }

  if (!isOrgIpAllowedForUser(req, resolved.user)) {
    clearAuthCookies(res, authScope);
    audit(req, 'session-refresh-ip-policy', 'failure', resolved.user.id, {
      reason: 'ip-not-allowlisted',
      organizationId: resolved.user.currentOrganizationId,
      sessionId: resolved.session.id,
    });
    return res.status(403).json({ error: 'Your organization only allows access from approved IP addresses.' });
  }

  const rotated = await rotateSession(resolved.session, req);
  writeSessionCookies(res, rotated.refreshToken, rotated.csrfToken, rotated.session.expiresAt, authScope);
  audit(req, 'session-refresh', 'success', resolved.user.id, { sessionId: rotated.session.id });
  res.json(buildAuthResponse(resolved.user, rotated.session));
});

router.post('/logout', requireAuth, async (req, res) => {
  const authScope = getAuthScope(req);
  await revokeSession(req.authSession.id);
  clearAuthCookies(res, authScope);
  audit(req, 'logout', 'success', req.user.id, { sessionId: req.authSession.id });
  res.json({ message: 'Logged out successfully.' });
});

router.get('/me', requireAuth, (req, res) => {
  const user = ensureUserShape(req.user);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: publicUser(user), session: req.authSession, csrfToken: req.authSession.csrfToken });
});

router.get('/sessions', requireAuth, async (req, res) => {
  const sessions = (await listActiveSessionsForUser(req.user.id)).map((session) => ({
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

router.delete('/sessions/:sessionId', requireAuth, async (req, res) => {
  const authScope = getAuthScope(req);
  const session = await getSessionById(req.params.sessionId);
  if (!session || session.userId !== req.user.id) {
    return res.status(404).json({ error: 'Session not found.' });
  }
  await revokeSession(session.id);
  if (session.id === req.authSession.id) clearAuthCookies(res, authScope);
  audit(req, 'session-revoke', 'success', req.user.id, { sessionId: session.id });
  res.json({ message: 'Session revoked.' });
});

router.post('/sessions/revoke-all', requireAuth, async (req, res) => {
  const authScope = getAuthScope(req);
  await revokeAllUserSessions(req.user.id);
  clearAuthCookies(res, authScope);
  audit(req, 'session-revoke-all', 'success', req.user.id);
  res.json({ message: 'All sessions revoked.' });
});

module.exports = router;
