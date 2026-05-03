import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { billingApi, type BillingInvoice, type BillingPlan, type BillingSnapshot } from '../../lib/api';

interface BillingPortalPageProps {
  token: string;
  userName: string;
}

function formatCurrency(cents: number, currency = 'USD') {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatDate(iso: string | null) {
  if (!iso) return 'N/A';
  return new Date(iso).toLocaleString();
}

export default function BillingPortalPage({ token, userName }: BillingPortalPageProps) {
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [snapshot, setSnapshot] = useState<BillingSnapshot | null>(null);
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [webhookJobs, setWebhookJobs] = useState<Array<{ id: string; eventId: string; type: string; status: string; attempts: number; nextAttemptAt: string; lastError: string | null }>>([]);
  const [desiredSeats, setDesiredSeats] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const currentPlanId = snapshot?.billing.planId || 'free';

  const limits = useMemo(() => {
    if (!snapshot) return null;
    return {
      seats: `${snapshot.usage.assignedSeats}/${snapshot.limits.seatsPurchased}`,
      storage: `${formatBytes(snapshot.usage.storageUsedBytes)} / ${formatBytes(snapshot.limits.storageBytes)}`,
      ai: `${snapshot.usage.aiRequests}/${snapshot.limits.aiRequestsPerMonth}`,
      collaborators: `${snapshot.usage.collaboratorsAssigned}/${snapshot.limits.collaborators}`,
    };
  }, [snapshot]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [plansRes, currentRes, invoicesRes, jobsRes] = await Promise.all([
        billingApi.plans(token),
        billingApi.current(token),
        billingApi.invoices(token),
        billingApi.webhookJobs(token),
      ]);
      setPlans(plansRes.plans);
      setSnapshot(currentRes.snapshot);
      setInvoices(invoicesRes.invoices);
      setWebhookJobs(jobsRes.jobs);
      setDesiredSeats(currentRes.snapshot.limits.seatsPurchased);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing data.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCheckout(planId: 'free' | 'pro' | 'enterprise' | 'onprem') {
    setBusyPlanId(planId);
    setError('');
    setMessage('');
    try {
      const nextSeats = Math.max(1, desiredSeats);
      const response = await billingApi.checkout(token, {
        planId,
        purchasedSeats: nextSeats,
        successUrl: `${window.location.origin}/billing`,
        cancelUrl: `${window.location.origin}/billing`,
        autoQueueCompletion: true,
      });
      setMessage(`Checkout queued for ${planId.toUpperCase()} plan. Session: ${response.checkoutSession.id}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start checkout.');
    } finally {
      setBusyPlanId(null);
    }
  }

  async function handlePlanChange(planId: 'free' | 'pro' | 'enterprise' | 'onprem') {
    setBusyPlanId(planId);
    setError('');
    setMessage('');
    try {
      await billingApi.changeSubscription(token, {
        planId,
        purchasedSeats: Math.max(1, desiredSeats),
      });
      setMessage(`Subscription change to ${planId.toUpperCase()} queued via webhook pipeline.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change subscription.');
    } finally {
      setBusyPlanId(null);
    }
  }

  async function handleSeatUpdate() {
    setError('');
    setMessage('');
    try {
      const result = await billingApi.updateSeats(token, Math.max(1, desiredSeats));
      setMessage(`${result.message} ${result.assignedSeats}/${result.purchasedSeats} seats in use.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update seats.');
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">Billing Portal</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">Plans, subscriptions, and entitlements</h1>
            <p className="mt-2 text-sm text-slate-600">Signed in as {userName}</p>
          </div>
          <div className="flex gap-2">
            <Link to="/organization-admin" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700">Org Admin</Link>
            <Link to="/workspace" className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-bold text-white">Workspace</Link>
          </div>
        </div>

        {message && <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
        {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-black text-slate-900">Subscription state</h2>
            <button type="button" onClick={() => void load()} className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700">Refresh</button>
          </div>
          {loading ? (
            <p className="mt-4 text-sm text-slate-500">Loading billing snapshot...</p>
          ) : snapshot ? (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Current plan</p>
                <p className="mt-1 text-xl font-black text-slate-900">{snapshot.plan.name}</p>
                <p className="mt-1 text-sm text-slate-600">Status: <span className="font-semibold uppercase">{snapshot.billing.status}</span></p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Trial / grace</p>
                <p className="mt-1 text-sm text-slate-700">Trial ends: {formatDate(snapshot.billing.trialEndsAt)}</p>
                <p className="mt-1 text-sm text-slate-700">Grace ends: {formatDate(snapshot.billing.graceEndsAt)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Current period end</p>
                <p className="mt-1 text-sm text-slate-700">{formatDate(snapshot.billing.currentPeriodEndAt)}</p>
              </div>
            </div>
          ) : null}
        </section>

        {limits && (
          <section className="rounded-3xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black text-slate-900">Entitlement usage</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 p-4 text-sm"><p className="text-slate-500">Seats</p><p className="mt-1 font-bold text-slate-900">{limits.seats}</p></div>
              <div className="rounded-2xl border border-slate-200 p-4 text-sm"><p className="text-slate-500">Storage</p><p className="mt-1 font-bold text-slate-900">{limits.storage}</p></div>
              <div className="rounded-2xl border border-slate-200 p-4 text-sm"><p className="text-slate-500">AI usage</p><p className="mt-1 font-bold text-slate-900">{limits.ai}</p></div>
              <div className="rounded-2xl border border-slate-200 p-4 text-sm"><p className="text-slate-500">Collaborators</p><p className="mt-1 font-bold text-slate-900">{limits.collaborators}</p></div>
            </div>
          </section>
        )}

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-black text-slate-900">Seat management</h2>
            <p className="text-xs uppercase tracking-[0.15em] text-slate-500">Purchased seats vs assigned seats</p>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              type="number"
              min={1}
              value={desiredSeats}
              onChange={(event) => setDesiredSeats(Number(event.target.value || 1))}
              className="w-28 rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
            <button type="button" onClick={() => void handleSeatUpdate()} className="rounded-xl border border-cyan-200 px-4 py-2 text-sm font-bold text-cyan-700">
              Update seats
            </button>
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-900">Plan management</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {plans.map((plan) => {
              const active = plan.id === currentPlanId;
              return (
                <article key={plan.id} className={`rounded-2xl border p-4 ${active ? 'border-cyan-500 bg-cyan-50' : 'border-slate-200 bg-white'}`}>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{plan.name}</p>
                  <p className="mt-2 text-2xl font-black text-slate-900">{plan.displayPrice || formatCurrency(plan.priceMonthlyCents)}</p>
                  <p className="text-xs text-slate-500">per month</p>
                  <ul className="mt-3 space-y-1 text-xs text-slate-700">
                    {(plan.featureHighlights && plan.featureHighlights.length > 0
                      ? plan.featureHighlights
                      : [
                        `Seats: ${plan.limits.seats}`,
                        `Storage: ${formatBytes(plan.limits.storageBytes)}`,
                        `AI: ${plan.limits.aiRequestsPerMonth}/mo`,
                        `Collaborators: ${plan.limits.collaborators}`,
                      ]
                    ).map((item) => (
                      <li key={item} className="flex items-start gap-1.5">
                        <span className="text-cyan-600">✓</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 space-y-2">
                    <button
                      type="button"
                      disabled={busyPlanId !== null}
                      onClick={() => void handleCheckout(plan.id)}
                      className="w-full rounded-xl bg-cyan-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                    >
                      Checkout
                    </button>
                    <button
                      type="button"
                      disabled={busyPlanId !== null}
                      onClick={() => void handlePlanChange(plan.id)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-60"
                    >
                      Upgrade / Downgrade
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-900">Invoice history</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.15em] text-slate-500">
                  <th className="px-2 py-2">Invoice</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Amount</th>
                  <th className="px-2 py-2">Issued</th>
                  <th className="px-2 py-2">Paid</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b border-slate-100">
                    <td className="px-2 py-2 font-mono text-xs text-slate-700">{invoice.id}</td>
                    <td className="px-2 py-2 uppercase">{invoice.status}</td>
                    <td className="px-2 py-2">{formatCurrency(invoice.amountCents, invoice.currency.toUpperCase())}</td>
                    <td className="px-2 py-2">{formatDate(invoice.issuedAt)}</td>
                    <td className="px-2 py-2">{formatDate(invoice.paidAt)}</td>
                  </tr>
                ))}
                {!invoices.length && (
                  <tr>
                    <td colSpan={5} className="px-2 py-4 text-sm text-slate-500">No invoices yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-900">Webhook processing</h2>
          <p className="mt-1 text-sm text-slate-600">Tracks retry state to keep entitlement sync reliable.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.15em] text-slate-500">
                  <th className="px-2 py-2">Event</th>
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Attempts</th>
                  <th className="px-2 py-2">Next retry</th>
                  <th className="px-2 py-2">Last error</th>
                </tr>
              </thead>
              <tbody>
                {webhookJobs.map((job) => (
                  <tr key={job.id} className="border-b border-slate-100">
                    <td className="px-2 py-2 font-mono text-xs text-slate-700">{job.eventId}</td>
                    <td className="px-2 py-2">{job.type}</td>
                    <td className="px-2 py-2 uppercase">{job.status}</td>
                    <td className="px-2 py-2">{job.attempts}</td>
                    <td className="px-2 py-2">{formatDate(job.nextAttemptAt)}</td>
                    <td className="px-2 py-2 text-xs text-red-600">{job.lastError || '-'}</td>
                  </tr>
                ))}
                {!webhookJobs.length && (
                  <tr>
                    <td colSpan={6} className="px-2 py-4 text-sm text-slate-500">No webhook jobs yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
