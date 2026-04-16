const express = require('express');
const { v4: uuidv4 } = require('uuid');

const { requireAuth } = require('../middleware/auth');
const { requirePermission, resolveOrganizationContext } = require('../middleware/rbac');
const { attachEntitlements } = require('../middleware/entitlements');
const {
  canAssignSeats,
  getAllPlans,
  getOrganizationBillingState,
  getOrganizationEntitlements,
  getPlan,
  listInvoicesByOrganization,
  listWebhookJobs,
  nowIso,
  organizations,
} = require('../store');
const {
  buildBillingSnapshot,
  createCheckoutSession,
  processDueWebhookJobs,
  queueBillingEvent,
} = require('../billing/service');

const router = express.Router();

router.get('/plans', requireAuth, resolveOrganizationContext, requirePermission('organization.read'), (req, res) => {
  res.json({ plans: getAllPlans() });
});

router.get('/current', requireAuth, resolveOrganizationContext, requirePermission('organization.read'), attachEntitlements, (req, res) => {
  const snapshot = buildBillingSnapshot(req.organization.id);
  res.json({ snapshot });
});

router.get('/invoices', requireAuth, resolveOrganizationContext, requirePermission('organization.read'), (req, res) => {
  const invoices = listInvoicesByOrganization(req.organization.id);
  res.json({ invoices });
});

router.post('/checkout', requireAuth, resolveOrganizationContext, requirePermission('organization.billing.manage'), (req, res) => {
  const planId = String(req.body?.planId || '').toLowerCase();
  if (!planId) return res.status(400).json({ error: 'planId is required.' });

  const plan = getPlan(planId);
  if (!plan || plan.id !== planId) return res.status(400).json({ error: 'Invalid planId.' });

  const current = getOrganizationBillingState(req.organization.id);
  const requestedSeats = Math.max(1, Number(req.body?.purchasedSeats || plan.limits.seats));
  const assignedSeats = getOrganizationEntitlements(req.organization.id)?.usage?.assignedSeats || 0;
  if (requestedSeats < assignedSeats) {
    return res.status(400).json({
      error: `Cannot set seats below currently assigned members (${assignedSeats}).`,
    });
  }

  const session = createCheckoutSession({
    organizationId: req.organization.id,
    planId,
    purchasedSeats: requestedSeats,
    successUrl: req.body?.successUrl,
    cancelUrl: req.body?.cancelUrl,
    autoQueueCompletion: req.body?.autoQueueCompletion !== false,
  });

  res.status(201).json({
    checkoutSession: session,
    currentPlanId: current?.planId || 'free',
    note: 'In mock mode, checkout completion is queued as a webhook event.',
  });
});

router.post('/subscription/change', requireAuth, resolveOrganizationContext, requirePermission('organization.billing.manage'), (req, res) => {
  const planId = String(req.body?.planId || '').toLowerCase();
  if (!planId) return res.status(400).json({ error: 'planId is required.' });

  const plan = getPlan(planId);
  if (!plan || plan.id !== planId) return res.status(400).json({ error: 'Invalid planId.' });

  const seats = Math.max(1, Number(req.body?.purchasedSeats || plan.limits.seats));
  const assignedSeats = getOrganizationEntitlements(req.organization.id)?.usage?.assignedSeats || 0;
  if (seats < assignedSeats) {
    return res.status(400).json({
      error: `Cannot reduce seats below currently assigned members (${assignedSeats}).`,
    });
  }

  const event = {
    id: `evt_${uuidv4()}`,
    type: 'customer.subscription.updated',
    data: {
      organizationId: req.organization.id,
      planId,
      purchasedSeats: seats,
      subscriptionId: req.body?.subscriptionId || null,
      customerId: req.body?.customerId || null,
    },
    createdAt: nowIso(),
  };

  queueBillingEvent(event, 'mock');
  void processDueWebhookJobs(20);

  res.status(202).json({
    message: 'Subscription change queued for webhook processing.',
    eventId: event.id,
  });
});

router.patch('/seats', requireAuth, resolveOrganizationContext, requirePermission('organization.billing.manage'), (req, res) => {
  const nextSeats = Math.max(1, Number(req.body?.purchasedSeats || 0));
  const billing = getOrganizationBillingState(req.organization.id);
  if (!billing) return res.status(404).json({ error: 'Billing state not found.' });

  const check = canAssignSeats(req.organization.id, 0);
  if (!check.allowed) {
    return res.status(400).json({ error: check.reason });
  }

  const assignedSeats = getOrganizationEntitlements(req.organization.id)?.usage?.assignedSeats || 0;
  if (nextSeats < assignedSeats) {
    return res.status(400).json({
      error: `Cannot set purchased seats below assigned seats (${assignedSeats}).`,
    });
  }

  billing.purchasedSeats = nextSeats;
  billing.updatedAt = nowIso();
  organizations.set(req.organization.id, req.organization);

  res.json({
    message: 'Purchased seats updated.',
    purchasedSeats: billing.purchasedSeats,
    assignedSeats,
  });
});

router.get('/webhooks/jobs', requireAuth, resolveOrganizationContext, requirePermission('organization.billing.manage'), (req, res) => {
  const jobs = listWebhookJobs().filter((job) => String(job.payload?.data?.organizationId || '') === req.organization.id);
  res.json({ jobs });
});

module.exports = router;
