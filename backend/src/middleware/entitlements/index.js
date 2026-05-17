const {
  getOrganizationEntitlements,
  isBillingWriteBlocked,
  refreshBillingStatus,
} = require('../../store');

function ensureOrganizationContext(req, res) {
  if (!req.organization?.id) {
    res.status(500).json({ error: 'Organization context missing.' });
    return false;
  }
  return true;
}

async function attachEntitlements(req, res, next) {
  if (!ensureOrganizationContext(req, res)) return;

  const billing = await refreshBillingStatus(req.organization.id);
  if (billing && isBillingWriteBlocked(billing)) {
    return res.status(402).json({
      error: 'Subscription suspended due to billing issues. Resolve payment to continue.',
      code: 'subscription_suspended',
      billing,
    });
  }

  const entitlements = await getOrganizationEntitlements(req.organization.id);
  if (!entitlements) {
    return res.status(404).json({ error: 'Organization entitlements unavailable.' });
  }

  req.entitlements = entitlements;
  return next();
}

module.exports = {
  attachEntitlements,
};
