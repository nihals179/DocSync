const { canUseGrammar } = require('../../store');

function ensureOrganizationContext(req, res) {
  if (!req.organization?.id) {
    res.status(500).json({ error: 'Organization context missing.' });
    return false;
  }
  return true;
}

async function requireGrammarAccess(req, res, next) {
  if (!ensureOrganizationContext(req, res)) return;

  const check = await canUseGrammar(req.organization.id);
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
