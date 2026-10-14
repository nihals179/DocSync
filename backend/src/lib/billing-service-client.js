const defaultBaseUrl = 'http://localhost:4010';

const {
  TRIAL_DAYS_BY_PLAN,
  getAllPlans,
  gettenantEntitlements,
  upserttenantBillingState,
  listInvoicesBytenant,
  upsertInvoice,
  enqueueWebhookJob,
  listWebhookJobs,
  markWebhookJobProcessing,
  markWebhookJobProcessed,
} = require('../store');

function getBillingServiceBaseUrl() {
  return String(process.env.BILLING_SERVICE_URL || defaultBaseUrl).replace(/\/+$/, '');
}

function getBillingServiceToken() {
  return String(process.env.BILLING_SERVICE_TOKEN || '').trim();
}

function isBillingMockEnabled() {
  const mode = String(process.env.BILLING_SERVICE_MODE || 'mock').trim().toLowerCase();
  if (mode === 'mock') return true;
  if (mode === 'remote') return false;

  const explicitMock = String(process.env.BILLING_SERVICE_MOCK || '').trim().toLowerCase();
  if (explicitMock === '1' || explicitMock === 'true' || explicitMock === 'yes') return true;
  if (explicitMock === '0' || explicitMock === 'false' || explicitMock === 'no') return false;

  return String(process.env.NODE_ENV || '').toLowerCase() === 'test';
}

function toQueryString(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

async function parseResponseBody(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

function toResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    payload,
  };
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

async function processMockWebhookEvent(event) {
  const eventType = String(event?.type || '').trim();
  const eventData = event?.data && typeof event.data === 'object' ? event.data : {};
  const tenantId = String(eventData.tenantId || '').trim();
  if (!tenantId) {
    return toResponse(400, { error: 'tenantId is required in webhook event payload.' });
  }

  const enqueueResult = await enqueueWebhookJob('mock', event);

  if (eventType === 'checkout.session.completed') {
    const planId = String(eventData.planId || 'free');
    const purchasedSeats = normalizePositiveInt(eventData.purchasedSeats, 1);
    const fallbackTrialDays = Number(TRIAL_DAYS_BY_PLAN[planId] || 0);
    const trialDays = Number.isFinite(Number(eventData.trialDays))
      ? Math.max(0, Math.floor(Number(eventData.trialDays)))
      : fallbackTrialDays;
    const trialEndsAt = trialDays > 0
      ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    await upserttenantBillingState(tenantId, {
      planId,
      status: trialEndsAt ? 'trialing' : 'active',
      purchasedSeats,
      trialUsed: Boolean(trialEndsAt),
      trialEndsAt,
      graceEndsAt: null,
    });
  } else if (eventType === 'invoice.payment_failed') {
    const graceDaysRaw = Number(eventData.graceDays);
    const graceDays = Number.isFinite(graceDaysRaw) ? Math.max(0, Math.floor(graceDaysRaw)) : 3;
    const now = Date.now();
    const graceEndsAt = new Date(now + graceDays * 24 * 60 * 60 * 1000).toISOString();

    await upserttenantBillingState(tenantId, {
      status: graceDays === 0 ? 'suspended' : 'grace',
      graceEndsAt,
    });

    await upsertInvoice({
      id: String(event?.id || `evt_${now}`),
      tenantId,
      provider: 'mock',
      amountCents: Number(eventData.amountCents || 0),
      status: 'open',
      issuedAt: new Date(now).toISOString(),
      dueAt: graceEndsAt,
      metadata: { sourceEventType: eventType },
    });
  } else if (eventType === 'invoice.paid') {
    await upserttenantBillingState(tenantId, {
      status: 'active',
      graceEndsAt: null,
    });
  }

  if (!enqueueResult?.skipped && enqueueResult.job?.id) {
    await markWebhookJobProcessing(enqueueResult.job.id);
    await markWebhookJobProcessed(enqueueResult.job.id);
  }

  return toResponse(202, {
    received: true,
    eventId: String(event?.id || ''),
    skipped: Boolean(enqueueResult?.skipped),
  });
}

async function requestBillingServiceInMock(pathname, { method = 'GET', body = null, query = {} } = {}) {
  if (method === 'GET' && pathname === '/api/billing/plans') {
    const plans = await getAllPlans();
    return toResponse(200, { plans });
  }

  if (method === 'POST' && pathname === '/api/billing/webhooks/provider') {
    return processMockWebhookEvent(body || {});
  }

  if (method === 'GET' && pathname === '/api/billing/webhooks/jobs') {
    const jobs = await listWebhookJobs();
    const tenantId = String(query?.tenantId || '').trim();
    const filteredJobs = tenantId
      ? jobs.filter((job) => {
        const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {};
        const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
        return String(data.tenantId || '') === tenantId;
      })
      : jobs;
    return toResponse(200, { jobs: filteredJobs });
  }

  const orgCurrentMatch = pathname.match(/^\/api\/billing\/tenants\/([^/]+)\/current$/);
  if (method === 'GET' && orgCurrentMatch) {
    const tenantId = orgCurrentMatch[1];
    const snapshot = await gettenantEntitlements(tenantId);
    if (!snapshot) return toResponse(404, { error: 'Tenant not found.' });
    return toResponse(200, { snapshot });
  }

  const orgInvoicesMatch = pathname.match(/^\/api\/billing\/tenants\/([^/]+)\/invoices$/);
  if (method === 'GET' && orgInvoicesMatch) {
    const tenantId = orgInvoicesMatch[1];
    const invoices = await listInvoicesBytenant(tenantId);
    return toResponse(200, { invoices });
  }

  const orgSeatsMatch = pathname.match(/^\/api\/billing\/tenants\/([^/]+)\/seats$/);
  if (method === 'PATCH' && orgSeatsMatch) {
    const purchasedSeatsRaw = Number(body?.purchasedSeats);
    if (!Number.isFinite(purchasedSeatsRaw) || purchasedSeatsRaw < 1) {
      return toResponse(400, { error: 'purchasedSeats must be a positive integer.' });
    }
    const tenantId = orgSeatsMatch[1];
    const billing = await upserttenantBillingState(tenantId, {
      purchasedSeats: Math.floor(purchasedSeatsRaw),
    });
    if (!billing) return toResponse(404, { error: 'Tenant not found.' });
    const snapshot = await gettenantEntitlements(tenantId);
    return toResponse(200, {
      message: 'Seats updated.',
      purchasedSeats: billing.purchasedSeats,
      assignedSeats: Number(snapshot?.usage?.assignedSeats || 0),
    });
  }

  const orgCheckoutMatch = pathname.match(/^\/api\/billing\/tenants\/([^/]+)\/checkout$/);
  if (method === 'POST' && orgCheckoutMatch) {
    const tenantId = orgCheckoutMatch[1];
    const planId = String(body?.planId || 'pro');
    const purchasedSeats = normalizePositiveInt(body?.purchasedSeats, 1);
    const billing = await upserttenantBillingState(tenantId, {
      planId,
      status: 'active',
      purchasedSeats,
    });
    if (!billing) return toResponse(404, { error: 'Tenant not found.' });

    const checkoutSessionId = `cs_mock_${Date.now()}`;
    const checkoutUrl = String(body?.successUrl || `https://billing.local/checkout/${tenantId}`);
    const cancelUrl = String(body?.cancelUrl || `https://billing.local/cancel/${tenantId}`);
    return toResponse(200, {
      checkoutSession: {
        id: checkoutSessionId,
        provider: 'mock',
        checkoutUrl,
        cancelUrl,
      },
      currentPlanId: billing.planId,
      note: 'Mock checkout session created locally.',
    });
  }

  const orgSubChangeMatch = pathname.match(/^\/api\/billing\/tenants\/([^/]+)\/subscription\/change$/);
  if (method === 'POST' && orgSubChangeMatch) {
    const tenantId = orgSubChangeMatch[1];
    const planId = String(body?.planId || 'free');
    const billing = await upserttenantBillingState(tenantId, {
      planId,
      status: 'active',
    });
    if (!billing) return toResponse(404, { error: 'Tenant not found.' });
    return toResponse(200, {
      message: `Subscription changed to ${billing.planId}.`,
      eventId: `evt_mock_${Date.now()}`,
    });
  }

  return toResponse(404, { error: 'Billing endpoint not implemented in test fallback.', pathname, method });
}

async function requestBillingService(pathname, { method = 'GET', body = null, query = {} } = {}) {
  if (isBillingMockEnabled()) {
    return requestBillingServiceInMock(pathname, { method, body, query });
  }

  const baseUrl = getBillingServiceBaseUrl();
  const token = getBillingServiceToken();
  const url = `${baseUrl}${pathname}${toQueryString(query)}`;

  const headers = {
    Accept: 'application/json',
  };

  if (token) {
    headers['x-service-token'] = token;
  }

  if (body !== null && body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body !== null && body !== undefined ? JSON.stringify(body) : undefined,
  });

  const payload = await parseResponseBody(response);
  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

module.exports = {
  requestBillingService,
};
