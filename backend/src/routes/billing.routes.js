const express = require('express');

const { requireAuth } = require('../middleware/auth/core');
const { requirePermission, resolveTenantContext } = require('../middleware/rbac');
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

router.get('/plans', requireAuth, resolveTenantContext, requirePermission('tenant.read'), async (req, res) => {
  return forwardToBillingService(res, '/api/billing/plans');
});

router.get('/current', requireAuth, resolveTenantContext, requirePermission('tenant.read'), async (req, res) => {
  const pathname = `/api/billing/tenants/${req.tenant.id}/current`;
  return forwardToBillingService(res, pathname);
});

router.get('/invoices', requireAuth, resolveTenantContext, requirePermission('tenant.read'), async (req, res) => {
  const pathname = `/api/billing/tenants/${req.tenant.id}/invoices`;
  return forwardToBillingService(res, pathname);
});

router.post('/checkout', requireAuth, resolveTenantContext, requirePermission('tenant.billing.manage'), async (req, res) => {
  const pathname = `/api/billing/tenants/${req.tenant.id}/checkout`;
  return forwardToBillingService(res, pathname, {
    method: 'POST',
    body: req.body || {},
  });
});

router.post('/subscription/change', requireAuth, resolveTenantContext, requirePermission('tenant.billing.manage'), async (req, res) => {
  const pathname = `/api/billing/tenants/${req.tenant.id}/subscription/change`;
  return forwardToBillingService(res, pathname, {
    method: 'POST',
    body: req.body || {},
  });
});

router.patch('/seats', requireAuth, resolveTenantContext, requirePermission('tenant.billing.manage'), async (req, res) => {
  const pathname = `/api/billing/tenants/${req.tenant.id}/seats`;
  return forwardToBillingService(res, pathname, {
    method: 'PATCH',
    body: req.body || {},
  });
});

router.get('/webhooks/jobs', requireAuth, resolveTenantContext, requirePermission('tenant.billing.manage'), async (req, res) => {
  return forwardToBillingService(res, '/api/billing/webhooks/jobs', {
    query: { tenantId: req.tenant.id },
  });
});

module.exports = router;
