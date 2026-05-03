# Phase 3: Licensing, Billing & Entitlements

**Scope:** Weeks 9–11  
**Status:** Fully implemented (mock/in-memory provider, swap-ready for Stripe or any real billing provider)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                      Frontend                           │
│  BillingPortalPage  ──►  billingApi (api.ts)            │
└────────────────────────────┬────────────────────────────┘
                             │ HTTPS
┌────────────────────────────▼────────────────────────────┐
│                  Express Backend                        │
│                                                         │
│  POST /api/billing/checkout                             │
│  POST /api/billing/subscription/change                  │
│  PATCH /api/billing/seats                               │
│  GET  /api/billing/current                              │
│  GET  /api/billing/plans                                │
│  GET  /api/billing/invoices                             │
│  GET  /api/billing/webhooks/jobs                        │
│                                                         │
│  POST /api/billing-webhooks/provider   ◄── Stripe/etc.  │
│                                                         │
│  ┌────────────────┐   ┌──────────────────────────────┐  │
│  │ billing/       │   │ middleware/entitlements.js   │  │
│  │ service.js     │   │  - attachEntitlements        │  │
│  │  processBilling│   │  - requireAiQuota            │  │
│  │  Event()       │   │  - consumeAiQuota            │  │
│  │  webhookWorker │   └──────────────────────────────┘  │
│  └────────────────┘                                     │
│                                                         │
│  ┌────────────────────────────────────────────────────┐ │
│  │ store/index.js  (in-memory, swap for Postgres)     │ │
│  │  organizations → billing   invoices   webhookJobs  │ │
│  │  organizationUsage (AI req/month)                  │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Plans & Feature Gates

### 2.1 Plan Catalog

Defined in `backend/src/store/index.js` — `PLAN_CATALOG`.

| Plan       | Price/mo | Seats | Storage   | AI Req/mo | Collaborators |
|------------|----------|-------|-----------|-----------|---------------|
| Free       | $0       | 3     | 1 GB      | 200       | 2             |
| Pro        | $29      | 10    | 20 GB     | 5,000     | 8             |
| Business   | $129     | 50    | 200 GB    | 30,000    | 40            |
| Enterprise | $399     | 500   | 2 TB      | 200,000   | 450           |

Each plan entry:
```js
{
  id: 'pro',
  name: 'Pro',
  priceMonthlyCents: 2900,
  limits: {
    seats: 10,
    storageBytes: 20 * 1024 * 1024 * 1024,
    aiRequestsPerMonth: 5000,
    collaborators: 8,
  },
}
```

### 2.2 Trial Logic

Defined in `TRIAL_DAYS_BY_PLAN`:

| Plan       | Trial Days |
|------------|------------|
| Pro        | 14 days    |
| Business   | 14 days    |
| Enterprise | 30 days    |
| Free       | No trial   |

Rules:
- Trial only activates on first-ever subscription (`trialUsed: false`).
- On checkout completion, `billing.status = 'trialing'` and `trialEndsAt` is set.
- `trialUsed` is permanently set to `true` after first trial — no repeat trials.
- Trial expiry is detected lazily in `refreshBillingStatus()` during every authenticated request.

### 2.3 Billing Status State Machine

```
   [checkout] ──────────────► active
                               │
   [trial eligible] ─────► trialing
                               │
   [invoice.paid] ─────────► active
                               │
   [invoice.payment_failed] ► grace  ──[grace window expires]──► suspended
                               │
   [payment recovered] ──── active
                               │
   [subscription.deleted] ── canceled
```

Status values: `active` | `trialing` | `grace` | `suspended` | `canceled`

---

## 3. Billing Integration

### 3.1 Checkout Flow

**Endpoint:** `POST /api/billing/checkout`  
**Permission:** `organization.billing.manage`

```
Client ──► POST /api/billing/checkout { planId, purchasedSeats, successUrl, cancelUrl }
       ◄── { checkoutSession: { id, checkoutUrl }, currentPlanId, note }
```

In mock mode:
1. A `checkout.session.completed` event is immediately queued as a webhook job.
2. The webhook worker runs and calls `applySubscriptionState()`.
3. The organization's billing is updated synchronously before the response.

In production: replace `createCheckoutSession()` in `billing/service.js` to create a real Stripe Checkout Session and return the hosted URL. The actual state mutation only happens when Stripe fires the webhook.

Seat guard on checkout:
```js
if (requestedSeats < assignedSeats) → 400 error
```
Prevents purchasing fewer seats than are currently assigned.

### 3.2 Upgrade / Downgrade

**Endpoint:** `POST /api/billing/subscription/change`  
**Permission:** `organization.billing.manage`

```
Client ──► POST /api/billing/subscription/change { planId, purchasedSeats }
       ◄── 202 { message, eventId }
```

Queues a `customer.subscription.updated` webhook event and flushes the worker immediately. Same seat-assignment guard applies.

### 3.3 Seat Management

**Endpoint:** `PATCH /api/billing/seats`  
**Permission:** `organization.billing.manage`

Allows purchasing additional seats independently without changing plan. Guards:
- `purchasedSeats ≥ assignedSeats` always enforced.

`canAssignSeats()` in the store is called before any member invite/role-grant to prevent over-assignment:
```js
const check = canAssignSeats(organizationId, 1);
if (!check.allowed) → 402/400 with reason
```

### 3.4 Invoice History

**Endpoint:** `GET /api/billing/invoices`

Returns all invoices for the organization. Invoice structure:
```js
{
  id, organizationId, provider, status,  // 'paid' | 'failed' | 'draft' | 'void'
  amountCents, currency, periodStart, periodEnd,
  issuedAt, paidAt, hostedUrl
}
```

---

## 4. Webhook Processing

### 4.1 Inbound Webhook Endpoint

**Endpoint:** `POST /api/billing-webhooks/provider`  
**Auth:** None (raw provider endpoint — add signature verification here for Stripe)

```js
router.post('/provider', async (req, res) => {
  const event = req.body;
  const queued = queueBillingEvent(event, 'provider');
  if (queued.skipped) → 200 (idempotent, already processed)
  await processDueWebhookJobs(20);
  return 202
});
```

**Idempotency:** `processedWebhookEvents` Map stores `eventId → processedAt`. Duplicate events return `200` without re-processing.

### 4.2 Webhook Job Queue

All events go through the job queue (`webhookJobs` Map) before processing. Job record:
```js
{
  id, eventId, provider, type, payload,
  status,        // 'queued' | 'processing' | 'processed' | 'failed'
  attempts,
  maxAttempts,   // 5 by default
  nextAttemptAt, // exponential backoff
  lastError,
  createdAt, updatedAt
}
```

**Retry logic:** On failure, `markWebhookJobFailed()` increments `attempts` and sets `nextAttemptAt` with exponential backoff. Jobs are retried up to `maxAttempts` times by the background worker.

**Background worker:** `startBillingWebhookWorker()` runs a `setInterval` every 5 seconds to call `processDueWebhookJobs(50)`. Started in `app.js` on server boot.

### 4.3 Supported Event Types

| Event Type                         | Action                                                    |
|------------------------------------|-----------------------------------------------------------|
| `checkout.session.completed`       | `applySubscriptionState()` — sets plan, seats, trial      |
| `customer.subscription.updated`    | `applySubscriptionState()` — plan/seat change             |
| `customer.subscription.deleted`    | `applySubscriptionCanceled()` — sets status to canceled   |
| `invoice.paid`                     | `applyInvoicePaid()` — clears grace, records paid invoice |
| `invoice.payment_failed`           | `applyInvoiceFailed()` — sets to grace, starts countdown  |

### 4.4 Failed Payments & Grace Period

1. `invoice.payment_failed` → `billing.status = 'grace'`, `graceEndsAt = now + 3 days`.
2. Every request through `attachEntitlements` calls `refreshBillingStatus()`.
3. `refreshBillingStatus()` checks if `graceEndsAt` has passed → promotes to `suspended`.
4. Suspended orgs get `402` on all write operations, blocking new documents/AI/collaboration.
5. Payment recovery: `invoice.paid` → `billing.status = 'active'`, `graceEndsAt = null`.

```
invoice.payment_failed
  └─► billing.status = 'grace'
  └─► graceEndsAt = +3 days
         │
         ▼  (lazy check on each request)
  graceEndsAt passed?
  ├─ NO  → allow requests (still in grace window)
  └─ YES → billing.status = 'suspended' → 402 on all writes
               │
               ▼  (invoice.paid arrives)
            billing.status = 'active'
```

---

## 5. Entitlement Enforcement Middleware

File: `backend/src/middleware/entitlements.js`

### 5.1 `attachEntitlements`

Applied to every protected route. Performs:
1. `refreshBillingStatus()` — lazy status promotion (grace → suspended, trial expiry).
2. `isBillingWriteBlocked()` — returns `true` if status is `suspended` or `canceled`.
3. If blocked → `402 subscription_suspended`.
4. `getOrganizationEntitlements()` → attaches full entitlement snapshot to `req.entitlements`.

### 5.2 `requireAiQuota`

Placed before AI route handlers. Calls `canConsumeAiRequests(orgId, 1)`. Returns `402 ai_quota_exceeded` with current usage and limit if over.

### 5.3 `consumeAiQuota`

Placed after AI generation to record usage. Calls `consumeAiRequests(orgId, 1)`. Attaches `req.aiUsage` for downstream logging.

### 5.4 Entitlements Snapshot Structure

```js
{
  billing: {
    planId, status, purchasedSeats, trialEndsAt, trialUsed,
    subscriptionId, customerId, currentPeriodEndAt, graceEndsAt, updatedAt
  },
  limits: {
    seatsPurchased,    // from billing.purchasedSeats
    storageBytes,      // from plan
    aiRequestsPerMonth,// from plan
    collaborators      // from plan
  },
  usage: {
    assignedSeats,         // active organization members
    collaboratorsAssigned, // from memberships
    storageUsedBytes,      // 0 (calculated on real impl)
    aiRequests             // from organizationUsage (current month)
  },
  allowed: {
    canAddSeats,
    canUseAi,
    canAddCollaborators
  }
}
```

---

## 6. Seat Management Detail

### Purchased vs Assigned

| Concept         | Meaning                                            | Source                   |
|-----------------|----------------------------------------------------|--------------------------|
| Purchased seats | What the org paid for                              | `billing.purchasedSeats` |
| Assigned seats  | Active members currently in the organization       | Count from `organizationMemberships` |

**Over-assignment prevention:**
- `canAssignSeats(orgId, delta)` is called before every `POST /api/organizations/:id/members` invite.
- If `assignedSeats + delta > purchasedSeats` → returns `{ allowed: false, reason: '...' }` → `400`.
- Downgrade/seat-reduction endpoint guards: `newSeats < assignedSeats` → `400`.

---

## 7. Billing Portal UI

File: `frontend/src/components/pages/BillingPortalPage.tsx`

### Sections

1. **Current Plan Banner** — shows plan name, status badge (active/trialing/grace/suspended), period end, trial end.
2. **Usage Meters** — seats, storage, AI requests, collaborators (current/limit format).
3. **Plan Selector** — card grid for all 4 plans with price, limits, and Upgrade/Downgrade CTA. Disabled on current plan.
4. **Seat Adjuster** — numeric input + `Update Seats` button calling `PATCH /api/billing/seats`.
5. **Invoice History** — table with date, status badge (paid=green, failed=red), amount, period.
6. **Webhook Job Monitor** — table showing job status, attempts, last error. Useful for debugging.

---

## 8. Replacing Mock with a Real Provider (Stripe)

The entire billing flow is designed for a clean swap. Three files to update:

### `billing/service.js` — `createCheckoutSession()`

```js
// Replace mock event queue with real Stripe call:
const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  line_items: [{ price: PRICE_IDS[planId], quantity: purchasedSeats }],
  success_url: successUrl,
  cancel_url: cancelUrl,
  metadata: { organizationId, planId, purchasedSeats },
});
return { id: session.id, checkoutUrl: session.url };
```

### `billing-webhooks.routes.js` — Add signature verification

```js
const sig = req.headers['stripe-signature'];
const event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
```

### `billing/service.js` — `processBillingEvent()` event type mapping

Map Stripe's `checkout.session.completed`, `customer.subscription.updated`, etc. to the same internal functions. The internal state logic does not change.

---

## 9. File Reference

| File                                                  | Purpose                                              |
|-------------------------------------------------------|------------------------------------------------------|
| `backend/src/store/index.js`                          | Plan catalog, all state maps, entitlement logic       |
| `backend/src/billing/service.js`                      | Checkout, webhook processing, worker, snapshot        |
| `backend/src/middleware/entitlements.js`              | Route-level enforcement guards                        |
| `backend/src/routes/billing.routes.js`                | REST API for billing portal and seat management       |
| `backend/src/routes/billing-webhooks.routes.js`       | Inbound webhook receiver (provider → queue)           |
| `frontend/src/components/pages/BillingPortalPage.tsx` | Billing UI: plans, invoices, seats, usage             |
| `frontend/src/lib/api.ts`                             | `billingApi` — typed client for all billing endpoints |
