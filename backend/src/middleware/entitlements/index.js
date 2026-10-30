const {
  getTenantEntitlements,
  isBillingWriteBlocked,
  refreshBillingStatus,
  getTenantEntitlement,
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

  const entitlements = await getTenantEntitlements(req.tenant.id);
  if (!entitlements) {
    return res.status(404).json({ error: 'Tenant entitlements unavailable.' });
  }

  if (entitlements.billing && isBillingWriteBlocked(entitlements.billing)) {
    return res.status(402).json({
      error: 'Subsription expired or suspended. Please visit the billing portal to update your payment method or renew your subscription.',
      code: 'SubscriptionExpiredOrSuspended',
      billing: entitlements.billing,
    });
  }

  req.entitlements = entitlements;
  return next();
}

module.exports = {
  attachEntitlements,
};
