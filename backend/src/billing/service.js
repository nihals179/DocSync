const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');

const {
  TRIAL_DAYS_BY_PLAN,
  enqueueWebhookJob,
  getDueWebhookJobs,
  getOrganizationBillingState,
  getOrganizationEntitlements,
  getPlanById,
  listInvoicesByOrganization,
  markWebhookJobFailed,
  markWebhookJobProcessed,
  markWebhookJobProcessing,
  nowIso,
  upsertOrganizationBillingState,
  upsertInvoice,
} = require('../store');
const { isDatabaseConfigured } = require('../lib/runtime-utils');

let workerStarted = false;

async function ensureOrganization(organizationId) {
  return prisma.organization.findUnique({ where: { id: organizationId } });
}

async function promoteOrganizationMembersToEnterprise(organizationId) {
  if (!isDatabaseConfigured()) return;
  const activeMemberUserIds = (await prisma.organizationMembership.findMany({
    where: { organizationId, status: 'active' },
    select: { userId: true },
  })).map((membership) => membership.userId);

  if (!activeMemberUserIds.length) return;
  await prisma.user.updateMany({
    where: { id: { in: activeMemberUserIds } },
    data: { accountType: 'Enterprise' },
  });
}

async function applySubscriptionState({ organizationId, planId, purchasedSeats, subscriptionId, customerId, trialDays = 0, periodDays = 30 }) {
  const organization = await ensureOrganization(organizationId);
  if (!organization) throw new Error('Organization not found.');

  const billing = await getOrganizationBillingState(organizationId);
  const now = Date.now();
  const plan = await getPlanById(planId);
  const nextSeats = Math.max(1, Number(purchasedSeats || plan.limits.seats));
  const trialEligible = trialDays > 0 && !billing.trialUsed;

  billing.planId = plan.id;
  billing.purchasedSeats = nextSeats;
  billing.subscriptionId = subscriptionId || billing.subscriptionId || `sub_${uuidv4()}`;
  billing.customerId = customerId || billing.customerId || `cus_${uuidv4()}`;
  billing.currentPeriodEndAt = new Date(now + periodDays * 24 * 60 * 60 * 1000).toISOString();
  billing.updatedAt = nowIso();

  if (trialEligible) {
    billing.status = 'trialing';
    billing.trialUsed = true;
    billing.trialEndsAt = new Date(now + trialDays * 24 * 60 * 60 * 1000).toISOString();
  } else {
    billing.status = 'active';
    billing.trialEndsAt = null;
  }

  billing.graceEndsAt = null;
  if (plan.id === 'enterprise') {
    await promoteOrganizationMembersToEnterprise(organizationId);
  }
  return upsertOrganizationBillingState(organizationId, billing);
}

async function applyInvoicePaid({ organizationId, amountCents, periodStart = null, periodEnd = null, invoiceId = `inv_${uuidv4()}` }) {
  const organization = await ensureOrganization(organizationId);
  if (!organization) throw new Error('Organization not found.');

  const billing = await getOrganizationBillingState(organizationId);
  billing.status = billing.status === 'suspended' ? 'active' : billing.status;
  billing.graceEndsAt = null;
  await upsertOrganizationBillingState(organizationId, {
    status: billing.status,
    graceEndsAt: billing.graceEndsAt,
    updatedAt: nowIso(),
  });

  return upsertInvoice({
    id: invoiceId,
    organizationId,
    provider: 'mock',
    status: 'paid',
    amountCents: Number(amountCents || 0),
    currency: 'usd',
    periodStart,
    periodEnd,
    issuedAt: nowIso(),
    paidAt: nowIso(),
    hostedUrl: null,
  });
}

async function applyInvoiceFailed({ organizationId, amountCents, graceDays = 3, invoiceId = `inv_${uuidv4()}` }) {
  const organization = await ensureOrganization(organizationId);
  if (!organization) throw new Error('Organization not found.');

  const billing = await getOrganizationBillingState(organizationId);
  billing.status = 'grace';
  billing.graceEndsAt = new Date(Date.now() + graceDays * 24 * 60 * 60 * 1000).toISOString();
  await upsertOrganizationBillingState(organizationId, {
    status: billing.status,
    graceEndsAt: billing.graceEndsAt,
    updatedAt: nowIso(),
  });

  return upsertInvoice({
    id: invoiceId,
    organizationId,
    provider: 'mock',
    status: 'failed',
    amountCents: Number(amountCents || 0),
    currency: 'usd',
    periodStart: null,
    periodEnd: null,
    issuedAt: nowIso(),
    paidAt: null,
    hostedUrl: null,
  });
}

async function applySubscriptionCanceled({ organizationId, periodEndAt = null }) {
  const organization = await ensureOrganization(organizationId);
  if (!organization) throw new Error('Organization not found.');

  const billing = await getOrganizationBillingState(organizationId);
  billing.status = 'canceled';
  billing.currentPeriodEndAt = periodEndAt || billing.currentPeriodEndAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return upsertOrganizationBillingState(organizationId, {
    status: billing.status,
    currentPeriodEndAt: billing.currentPeriodEndAt,
    updatedAt: nowIso(),
  });
}

async function processBillingEvent(event) {
  const eventType = String(event.type || '');
  const data = event.data || {};

  switch (eventType) {
    case 'checkout.session.completed': {
      const planId = String(data.planId || 'free');
      const trialDays = TRIAL_DAYS_BY_PLAN[planId] || 0;
      return applySubscriptionState({
        organizationId: String(data.organizationId || ''),
        planId,
        purchasedSeats: data.purchasedSeats,
        subscriptionId: data.subscriptionId,
        customerId: data.customerId,
        trialDays,
      });
    }
    case 'customer.subscription.updated': {
      return applySubscriptionState({
        organizationId: String(data.organizationId || ''),
        planId: String(data.planId || 'free'),
        purchasedSeats: data.purchasedSeats,
        subscriptionId: data.subscriptionId,
        customerId: data.customerId,
        trialDays: 0,
      });
    }
    case 'customer.subscription.deleted': {
      return applySubscriptionCanceled({
        organizationId: String(data.organizationId || ''),
        periodEndAt: data.periodEndAt || null,
      });
    }
    case 'invoice.paid': {
      return applyInvoicePaid({
        organizationId: String(data.organizationId || ''),
        amountCents: data.amountCents,
        periodStart: data.periodStart || null,
        periodEnd: data.periodEnd || null,
        invoiceId: data.invoiceId,
      });
    }
    case 'invoice.payment_failed': {
      return applyInvoiceFailed({
        organizationId: String(data.organizationId || ''),
        amountCents: data.amountCents,
        graceDays: Number(data.graceDays ?? 3),
        invoiceId: data.invoiceId,
      });
    }
    default:
      return { ignored: true, eventType };
  }
}

async function processDueWebhookJobs(limit = 20) {
  const jobs = await getDueWebhookJobs(limit);
  for (const job of jobs) {
    try {
      await markWebhookJobProcessing(job.id);
      await processBillingEvent(job.payload);
      await markWebhookJobProcessed(job.id);
    } catch (error) {
      await markWebhookJobFailed(job.id, error instanceof Error ? error.message : 'Unknown error');
    }
  }
  return jobs.length;
}

function queueBillingEvent(event, provider = 'mock') {
  return enqueueWebhookJob(provider, event);
}

async function createCheckoutSession({ organizationId, planId, purchasedSeats, successUrl, cancelUrl, autoQueueCompletion = true }) {
  const plan = await getPlanById(planId);
  if (!plan) throw new Error('Invalid planId.');

  const sessionId = `chk_${uuidv4()}`;
  const event = {
    id: `evt_${uuidv4()}`,
    type: 'checkout.session.completed',
    data: {
      organizationId,
      planId,
      purchasedSeats: Math.max(1, Number(purchasedSeats || plan.limits.seats)),
      subscriptionId: `sub_${uuidv4()}`,
      customerId: `cus_${uuidv4()}`,
      sessionId,
    },
    createdAt: nowIso(),
  };

  if (autoQueueCompletion) {
    queueBillingEvent(event, 'mock');
  }

  return {
    id: sessionId,
    provider: 'mock',
    checkoutUrl: `${successUrl || 'http://localhost:5173/billing'}?mockCheckoutSession=${sessionId}`,
    cancelUrl: cancelUrl || 'http://localhost:5173/billing',
    eventPreview: event,
  };
}

async function buildBillingSnapshot(organizationId) {
  const entitlements = await getOrganizationEntitlements(organizationId);
  if (!entitlements) return null;
  return {
    ...entitlements,
    invoices: await listInvoicesByOrganization(organizationId),
  };
}

function startBillingWebhookWorker() {
  if (workerStarted) return;
  workerStarted = true;
  setInterval(() => {
    processDueWebhookJobs(50).catch(() => {});
  }, 5000);
}

module.exports = {
  buildBillingSnapshot,
  createCheckoutSession,
  processDueWebhookJobs,
  queueBillingEvent,
  startBillingWebhookWorker,
};
