const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireServiceAuth } = require('../middleware/service-auth');
const { fromBackend } = require('../lib/backend-modules');

const { prisma } = fromBackend('src/db/client');
const { nowIso, listInvoicesByOrganization } = fromBackend('src/store');
const {
  buildBillingSnapshot,
  createCheckoutSession,
  processDueWebhookJobs,
  queueBillingEvent,
} = require('../billing/service');

const router = express.Router();

function hasValidPostgresUrl() {
  const value = String(process.env.DATABASE_URL || '').trim().toLowerCase();
  return value.startsWith('postgres://') || value.startsWith('postgresql://');
}

router.use(requireServiceAuth);
router.use((req, res, next) => {
  if (!hasValidPostgresUrl()) {
    return res.status(503).json({
      error: 'Billing database is not configured. Set DATABASE_URL to postgres:// or postgresql://.',
      code: 'billing_database_not_configured',
    });
  }

  return next();
});

router.get('/plans', async (req, res) => {
  const rows = await prisma.planCatalog.findMany({ orderBy: { createdAt: 'asc' } });
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

  return res.json({ plans });
});

router.get('/organizations/:organizationId/current', async (req, res) => {
  const organizationId = String(req.params.organizationId || '').trim();
  if (!organizationId) return res.status(400).json({ error: 'organizationId is required.' });

  try {
    const billingState = await prisma.organizationBilling.findUnique({ where: { organizationId } });
    if (!billingState) {
      return res.status(404).json({
        error: 'Billing state not found in database.',
        code: 'billing_state_not_found',
      });
    }

    const snapshot = await buildBillingSnapshot(organizationId);
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

router.get('/organizations/:organizationId/invoices', async (req, res) => {
  const organizationId = String(req.params.organizationId || '').trim();
  if (!organizationId) return res.status(400).json({ error: 'organizationId is required.' });
  const invoices = await listInvoicesByOrganization(organizationId);
  return res.json({ invoices });
});

router.post('/organizations/:organizationId/checkout', async (req, res) => {
  const organizationId = String(req.params.organizationId || '').trim();
  const planId = String(req.body?.planId || '').toLowerCase();
  if (!organizationId) return res.status(400).json({ error: 'organizationId is required.' });
  if (!planId) return res.status(400).json({ error: 'planId is required.' });

  const plan = await prisma.planCatalog.findUnique({ where: { id: planId } });
  if (!plan) return res.status(400).json({ error: 'Invalid planId.' });

  const current = await prisma.organizationBilling.findUnique({ where: { organizationId } });
  const requestedSeats = Math.max(1, Number(req.body?.purchasedSeats || plan.limitSeats));
  const assignedSeats = await prisma.organizationMembership.count({
    where: { organizationId, status: 'active' },
  });

  if (requestedSeats < assignedSeats) {
    return res.status(400).json({
      error: `Cannot set seats below currently assigned members (${assignedSeats}).`,
    });
  }

  const session = await createCheckoutSession({
    organizationId,
    planId,
    purchasedSeats: requestedSeats,
    successUrl: req.body?.successUrl,
    cancelUrl: req.body?.cancelUrl,
    autoQueueCompletion: req.body?.autoQueueCompletion !== false,
  });

  return res.status(201).json({
    checkoutSession: session,
    currentPlanId: current?.planId || 'free',
    note: 'In mock mode, checkout completion is queued as a webhook event.',
  });
});

router.post('/organizations/:organizationId/subscription/change', async (req, res) => {
  const organizationId = String(req.params.organizationId || '').trim();
  const planId = String(req.body?.planId || '').toLowerCase();
  if (!organizationId) return res.status(400).json({ error: 'organizationId is required.' });
  if (!planId) return res.status(400).json({ error: 'planId is required.' });

  const plan = await prisma.planCatalog.findUnique({ where: { id: planId } });
  if (!plan) return res.status(400).json({ error: 'Invalid planId.' });

  const seats = Math.max(1, Number(req.body?.purchasedSeats || plan.limitSeats));
  const assignedSeats = await prisma.organizationMembership.count({
    where: { organizationId, status: 'active' },
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
      organizationId,
      planId,
      purchasedSeats: seats,
      subscriptionId: req.body?.subscriptionId || null,
      customerId: req.body?.customerId || null,
    },
    createdAt: nowIso(),
  };

  queueBillingEvent(event, 'mock');
  void processDueWebhookJobs(20);

  return res.status(202).json({
    message: 'Subscription change queued for webhook processing.',
    eventId: event.id,
  });
});

router.patch('/organizations/:organizationId/seats', async (req, res) => {
  const organizationId = String(req.params.organizationId || '').trim();
  if (!organizationId) return res.status(400).json({ error: 'organizationId is required.' });

  const nextSeats = Math.max(1, Number(req.body?.purchasedSeats || 0));
  const billing = await prisma.organizationBilling.findUnique({ where: { organizationId } });
  if (!billing) return res.status(404).json({ error: 'Billing state not found.' });

  const assignedSeats = await prisma.organizationMembership.count({
    where: { organizationId, status: 'active' },
  });

  if (nextSeats < assignedSeats) {
    return res.status(400).json({
      error: `Cannot set purchased seats below assigned seats (${assignedSeats}).`,
    });
  }

  await prisma.organizationBilling.update({
    where: { organizationId },
    data: {
      purchasedSeats: nextSeats,
      updatedAt: new Date(nowIso()),
    },
  });

  return res.json({
    message: 'Purchased seats updated.',
    purchasedSeats: nextSeats,
    assignedSeats,
  });
});

router.get('/webhooks/jobs', async (req, res) => {
  const organizationId = String(req.query.organizationId || '').trim();
  if (!organizationId) return res.status(400).json({ error: 'organizationId query param is required.' });

  const jobs = await prisma.webhookJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const filtered = jobs.filter((job) => String(job.payload?.data?.organizationId || '') === organizationId);
  return res.json({ jobs: filtered });
});

module.exports = router;
