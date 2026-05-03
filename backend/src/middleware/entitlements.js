const {
  canUseGrammar,
  canConsumeAiRequests,
  consumeAiRequests,
  getOrganizationEntitlements,
  isBillingWriteBlocked,
  refreshBillingStatus,
} = require('../store');

function ensureOrganizationContext(req, res) {
  if (!req.organization?.id) {
    res.status(500).json({ error: 'Organization context missing.' });
    return false;
  }
  return true;
}

function attachEntitlements(req, res, next) {
  if (!ensureOrganizationContext(req, res)) return;

  const billing = refreshBillingStatus(req.organization.id);
  if (billing && isBillingWriteBlocked(billing)) {
    return res.status(402).json({
      error: 'Subscription suspended due to billing issues. Resolve payment to continue.',
      code: 'subscription_suspended',
      billing,
    });
  }

  const entitlements = getOrganizationEntitlements(req.organization.id);
  if (!entitlements) {
    return res.status(404).json({ error: 'Organization entitlements unavailable.' });
  }

  req.entitlements = entitlements;
  return next();
}

function requireAiQuota(req, res, next) {
  if (!ensureOrganizationContext(req, res)) return;

  const check = canConsumeAiRequests(req.organization.id, 1);
  if (!check.allowed) {
    return res.status(402).json({
      error: check.reason,
      code: 'ai_quota_exceeded',
      details: {
        current: check.usage?.aiRequests || null,
        limit: check.limit || null,
      },
    });
  }

  return next();
}

function requireGrammarAccess(req, res, next) {
  if (!ensureOrganizationContext(req, res)) return;

  const check = canUseGrammar(req.organization.id);
  if (!check.allowed) {
    return res.status(402).json({
      error: check.reason,
      code: 'grammar_access_expired',
    });
  }

  return next();
}

function consumeAiQuota(req, res, next) {
  if (!ensureOrganizationContext(req, res)) return;

  const result = consumeAiRequests(req.organization.id, 1);
  if (!result.allowed) {
    return res.status(402).json({
      error: result.reason,
      code: 'ai_quota_exceeded',
    });
  }

  req.aiUsage = result.usage;
  return next();
}

module.exports = {
  attachEntitlements,
  requireGrammarAccess,
  requireAiQuota,
  consumeAiQuota,
};
