const { canUseGrammar } = require('../../store');

function ensureTenantContext(req, res) {
  if (!req.tenant?.id) {
    res.status(500).json({ error: 'Tenant context missing.' });
    return false;
  }
  return true;
}

async function requireGrammarAccess(req, res, next) {
  if (!ensureTenantContext(req, res)) return;

  const check = await canUseGrammar(req.tenant.id);
  if (!check.allowed) {
    return res.status(402).json({
      error: check.reason,
      code: 'grammar_access_expired',
    });
  }

  return next();
}

module.exports = {
  requireGrammarAccess,
};
