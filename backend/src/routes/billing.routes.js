const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');

const { requireAuth } = require('../middleware/auth/core');
const { requirePermission, resolveOrganizationContext } = require('../middleware/rbac');
const { attachEntitlements } = require('../middleware/entitlements');
const {
  nowIso,
  listInvoicesByOrganization,
} = require('../store');
const {
  buildBillingSnapshot,
  createCheckoutSession,
  processDueWebhookJobs,
  queueBillingEvent,
} = require('../billing/service');

const router = express.Router();

router.get('/plans', requireAuth, resolveOrganizationContext, requirePermission('organization.read'), async (req, res) => {
  const rows = await prisma.planCatalog.findMany({
    orderBy: { createdAt: 'asc' },
  });

  if (!rows.length) {
    return res.status(404).json({
      error: 'No billing plans found in database.',
      code: 'plan_catalog_empty',
    });
  }

  const plans = rows.map((row) => ({
    id: row.id,
    name: row.name,
    priceMonthlyCents: row.priceMonthlyCents,
    displayPrice: row.displayPrice,
    features: {
      basicEditor: row.featureBasicEditor,
      aiAssistant: row.featureAiAssistant,
      grammarChecker: row.featureGrammarChecker,
      prioritySupport: row.featurePrioritySupport,
      communitySupport: row.featureCommunitySupport,
      ssoSaml: row.featureSsoSaml,
      customRolesRbac: row.featureCustomRolesRbac,
      auditLogs: row.featureAuditLogs,
      slaDedicatedSupport: row.featureSlaDedicatedSupport,
      onPremiseOption: row.featureOnPremiseOption,
      selfHostedDeployment: row.featureSelfHostedDeployment,
      privateNetworkOnly: row.featurePrivateNetworkOnly,
      customComplianceControls: row.featureCustomComplianceControls,
      dedicatedSuccessTeam: row.featureDedicatedSuccessTeam,
    },
    limits: {
      seats: row.limitSeats,
      storageBytes: Number(row.limitStorageBytes),
      aiRequestsPerMonth: row.limitAiRequestsPerMonth,
      collaborators: row.limitCollaborators,
      documents: row.limitDocuments,
      documentUpdatesPerMonth: row.limitDocumentUpdatesPerMonth,
      versionHistoryDays: row.limitVersionHistoryDays,
      grammarAccessDays: row.limitGrammarAccessDays,
      aiAccessDays: row.limitAiAccessDays,
    },
  }));

  res.json({ plans });
});

router.get('/current', requireAuth, resolveOrganizationContext, requirePermission('organization.read'), attachEntitlements, async (req, res) => {
  try {
    const billingState = await prisma.organizationBilling.findUnique({
      where: { organizationId: req.organization.id },
    });
    if (!billingState) {
      return res.status(404).json({
        error: 'Billing state not found in database.',
        code: 'billing_state_not_found',
      });
    }

    const snapshot = await buildBillingSnapshot(req.organization.id);
    if (!snapshot) {
      return res.status(404).json({
        error: 'Billing snapshot unavailable for organization.',
        code: 'billing_snapshot_unavailable',
      });
    }

    return res.json({ snapshot });
  } catch {
    return res.status(500).json({
      error: 'Billing service unavailable.',
      code: 'billing_db_unavailable',
    });
  }
});

router.get('/invoices', requireAuth, resolveOrganizationContext, requirePermission('organization.read'), async (req, res) => {
  const invoices = await listInvoicesByOrganization(req.organization.id);
  res.json({ invoices });
});

router.post('/checkout', requireAuth, resolveOrganizationContext, requirePermission('organization.billing.manage'), async (req, res) => {
  const planId = String(req.body?.planId || '').toLowerCase();
  if (!planId) return res.status(400).json({ error: 'planId is required.' });

  const plan = await prisma.planCatalog.findUnique({ where: { id: planId } });
  if (!plan) return res.status(400).json({ error: 'Invalid planId.' });

  const current = await prisma.organizationBilling.findUnique({
    where: { organizationId: req.organization.id },
  });
  const requestedSeats = Math.max(1, Number(req.body?.purchasedSeats || plan.limitSeats));
  const assignedSeats = await prisma.organizationMembership.count({
    where: { organizationId: req.organization.id, status: 'active' },
  });
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

router.post('/subscription/change', requireAuth, resolveOrganizationContext, requirePermission('organization.billing.manage'), async (req, res) => {
  const planId = String(req.body?.planId || '').toLowerCase();
  if (!planId) return res.status(400).json({ error: 'planId is required.' });

  const plan = await prisma.planCatalog.findUnique({ where: { id: planId } });
  if (!plan) return res.status(400).json({ error: 'Invalid planId.' });

  const seats = Math.max(1, Number(req.body?.purchasedSeats || plan.limitSeats));
  const assignedSeats = await prisma.organizationMembership.count({
    where: { organizationId: req.organization.id, status: 'active' },
  });
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

router.patch('/seats', requireAuth, resolveOrganizationContext, requirePermission('organization.billing.manage'), async (req, res) => {
  const nextSeats = Math.max(1, Number(req.body?.purchasedSeats || 0));
  const billing = await prisma.organizationBilling.findUnique({
    where: { organizationId: req.organization.id },
  });
  if (!billing) return res.status(404).json({ error: 'Billing state not found.' });

  const assignedSeats = await prisma.organizationMembership.count({
    where: { organizationId: req.organization.id, status: 'active' },
  });
  if (nextSeats < assignedSeats) {
    return res.status(400).json({
      error: `Cannot set purchased seats below assigned seats (${assignedSeats}).`,
    });
  }

  await prisma.organizationBilling.update({
    where: { organizationId: req.organization.id },
    data: {
      purchasedSeats: nextSeats,
      updatedAt: new Date(nowIso()),
    },
  });

  res.json({
    message: 'Purchased seats updated.',
    purchasedSeats: nextSeats,
    assignedSeats,
  });
});

router.get('/webhooks/jobs', requireAuth, resolveOrganizationContext, requirePermission('organization.billing.manage'), async (req, res) => {
  const jobs = await prisma.webhookJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const filtered = jobs.filter((job) => String(job.payload?.data?.organizationId || '') === req.organization.id);
  res.json({ jobs: filtered });
});

module.exports = router;
