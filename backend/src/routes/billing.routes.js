const express = require('express');

const { requireAuth } = require('../middleware/auth/core');
const { requirePermission, resolveOrganizationContext } = require('../middleware/rbac');
const { attachEntitlements } = require('../middleware/entitlements');
const { requestBillingService } = require('../lib/billing-service-client');

const router = express.Router();

function relayBillingServiceError(res, error) {
  return res.status(502).json({
    error: 'Billing service is unavailable.',
    code: 'billing_service_unavailable',
    details: error instanceof Error ? error.message : String(error),
  });
}

async function forwardToBillingService(res, pathname, options = {}) {
  try {
    const response = await requestBillingService(pathname, options);
    return res.status(response.status).json(response.payload);
  } catch (error) {
    return relayBillingServiceError(res, error);
  }
}

router.get('/plans', requireAuth, resolveOrganizationContext, requirePermission('organization.read'), async (req, res) => {
  return forwardToBillingService(res, '/api/billing/plans');
});

router.get('/current', requireAuth, resolveOrganizationContext, requirePermission('organization.read'), attachEntitlements, async (req, res) => {
  const pathname = `/api/billing/organizations/${req.organization.id}/current`;
  return forwardToBillingService(res, pathname);
});

router.get('/invoices', requireAuth, resolveOrganizationContext, requirePermission('organization.read'), async (req, res) => {
  const pathname = `/api/billing/organizations/${req.organization.id}/invoices`;
  return forwardToBillingService(res, pathname);
});

router.post('/checkout', requireAuth, resolveOrganizationContext, requirePermission('organization.billing.manage'), async (req, res) => {
  const pathname = `/api/billing/organizations/${req.organization.id}/checkout`;
  return forwardToBillingService(res, pathname, {
    method: 'POST',
    body: req.body || {},
  });
});

router.post('/subscription/change', requireAuth, resolveOrganizationContext, requirePermission('organization.billing.manage'), async (req, res) => {
  const pathname = `/api/billing/organizations/${req.organization.id}/subscription/change`;
  return forwardToBillingService(res, pathname, {
    method: 'POST',
    body: req.body || {},
  });
});

router.patch('/seats', requireAuth, resolveOrganizationContext, requirePermission('organization.billing.manage'), async (req, res) => {
  const pathname = `/api/billing/organizations/${req.organization.id}/seats`;
  return forwardToBillingService(res, pathname, {
    method: 'PATCH',
    body: req.body || {},
  });
});

router.get('/webhooks/jobs', requireAuth, resolveOrganizationContext, requirePermission('organization.billing.manage'), async (req, res) => {
  return forwardToBillingService(res, '/api/billing/webhooks/jobs', {
    query: { organizationId: req.organization.id },
  });
});

module.exports = router;
