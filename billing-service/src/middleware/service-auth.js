function unauthorized(res) {
  return res.status(401).json({ error: 'Unauthorized service request.' });
}

function extractBearerToken(value) {
  const raw = String(value || '').trim();
  if (!raw.toLowerCase().startsWith('bearer ')) return '';
  return raw.slice(7).trim();
}

function requireServiceAuth(req, res, next) {
  const configuredToken = String(process.env.BILLING_SERVICE_TOKEN || '').trim();
  if (!configuredToken) return next();

  const headerToken = String(req.headers['x-service-token'] || '').trim();
  const bearerToken = extractBearerToken(req.headers.authorization);
  const candidate = headerToken || bearerToken;

  if (!candidate || candidate !== configuredToken) {
    return unauthorized(res);
  }

  return next();
}

module.exports = {
  requireServiceAuth,
};
