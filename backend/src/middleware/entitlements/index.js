const {
  gettenantEntitlements,
  isBillingWriteBlocked,
  refreshBillingStatus,
} = require('../../store');

function ensureTenantContext(req, res) {
  if (!req.tenant?.id) {
    res.status(500).json({ error: 'Tenant context missing.' });
    return false;
  }
  return true;
}

async function attachEntitlements(req, res, next) {
  if (!ensureTenantContext(req, res)) return;

  const billing = await refreshBillingStatus(req.tenant.id);
  if (billing && isBillingWriteBlocked(billing)) {
    return res.status(402).json({
      error: 'Subscription suspended due to billing issues. Resolve payment to continue.',
      code: 'subscription_suspended',
      billing,
    });
  }

  const entitlements = await gettenantEntitlements(req.tenant.id);
  if (!entitlements) {
    return res.status(404).json({ error: 'Tenant entitlements unavailable.' });
  }

  req.entitlements = entitlements;
  return next();
}

module.exports = {
  attachEntitlements,
};
