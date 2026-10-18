import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { billingApi, type BillingPlan, type BillingSnapshot } from '../services/api';

type BuyPlanPageProps = {
  token: string;
  userName: string;
};

function getPlanHighlights(planId: string) {
  switch (planId) {
    case 'pro':
      return [
        'Unlimited AI requests',
        'Expanded collaboration limits',
        'Priority support',
      ];
    case 'enterprise':
      return [
        'Advanced RBAC and SSO',
        'Audit logs and compliance controls',
        'Dedicated support and SLA options',
      ];
    default:
      return [
        'Starter workspace access',
        'Core editor and document tools',
        'Basic collaboration',
      ];
  }
}

export default function BuyPlanPage({ token, userName }: BuyPlanPageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [currentSnapshot, setCurrentSnapshot] = useState<BillingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submittingPlanId, setSubmittingPlanId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  async function loadPlansAndSnapshot() {
    try {
      setLoading(true);
      setError('');
      const [plansResponse, currentResponse] = await Promise.all([
        billingApi.plans(token),
        billingApi.current(token),
      ]);
      setPlans(plansResponse.plans);
      setCurrentSnapshot(currentResponse.snapshot);
      return currentResponse.snapshot;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let ignore = false;

    async function loadPlans() {
      try {
        await loadPlansAndSnapshot();
        if (ignore) return;
      } catch (loadError) {
        if (!ignore) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load plans.');
        }
      }
    }

    void loadPlans();
    return () => {
      ignore = true;
    };
  }, [token]);

  useEffect(() => {
    let ignore = false;

    async function syncAfterCheckoutReturn() {
      const success = searchParams.get('success');
      const canceled = searchParams.get('canceled');

      if (canceled === '1') {
        setMessage('Checkout canceled. Your current plan has not changed.');
        return;
      }

      if (success !== '1') {
        return;
      }

      setMessage('Payment flow completed. Syncing your latest billing status...');
      try {
        // Give the webhook worker a short window to process the queued event.
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (ignore) return;
          const snapshot = await loadPlansAndSnapshot();
          const planId = String((snapshot?.billing?.planId || 'free')).toLowerCase();
          if (planId !== 'free') break;
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
        if (!ignore) {
          setMessage('Payment completed. Your subscription has been updated.');
        }
      } catch (syncError) {
        if (!ignore) {
          setError(syncError instanceof Error ? syncError.message : 'Could not refresh billing state after checkout.');
        }
      }
    }

    void syncAfterCheckoutReturn();
    return () => {
      ignore = true;
    };
  }, [searchParams, token]);

  const currentPlanId = useMemo(() => String(currentSnapshot?.billing?.planId || 'free').toLowerCase(), [currentSnapshot]);

  async function handleSelectPlan(planId: BillingPlan['id']) {
    if (planId === 'free') return;
    if (planId === currentPlanId) {
      setMessage('You are already on this plan.');
      return;
    }

    try {
      setSubmittingPlanId(planId);
      setError('');
      setMessage('');
      const response = await billingApi.checkout(token, {
        planId,
        purchasedSeats: Math.max(1, currentSnapshot?.limits?.seatsPurchased || 1),
        successUrl: `${window.location.origin}/billing/upgrade?success=1`,
        cancelUrl: `${window.location.origin}/billing/upgrade?canceled=1`,
      });
      if (response.checkoutSession?.checkoutUrl) {
        window.location.assign(response.checkoutSession.checkoutUrl);
      } else {
        setMessage('Checkout session created. Please continue from the billing flow.');
      }
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'Checkout failed.');
    } finally {
      setSubmittingPlanId(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-10 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-700">Subscription</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">Choose your plan</h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-600">{userName}, upgrade to unlock more AI usage, collaborators, and enterprise-grade controls.</p>
          </div>
          <button type="button" onClick={() => navigate('/settings?view=billing')} className="rounded-none border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
            Back to billing
          </button>
        </div>

        {message ? (
          <div className="rounded-none border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-800">{message}</div>
        ) : null}

        {error ? (
          <div className="rounded-none border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        ) : null}

        {loading ? (
          <div className="rounded-none border border-slate-200 bg-white p-8 text-sm text-slate-600">Loading available plans…</div>
        ) : null}

        {!loading ? (
          <div className="grid gap-6 lg:grid-cols-3">
            {plans.map((plan) => {
              const isCurrent = plan.id === currentPlanId;
              const isFreePlan = plan.id === 'free';
              const isSubmitting = submittingPlanId === plan.id;
              return (
                <div key={plan.id} className={`rounded-none border bg-white p-6 shadow-sm ${isCurrent ? 'border-cyan-500 ring-2 ring-cyan-100' : 'border-slate-200'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">{plan.name}</p>
                      <h2 className="mt-2 text-2xl font-black text-slate-900">{plan.displayPrice || 'Custom'}</h2>
                    </div>
                    {isCurrent ? (
                      <span className="rounded-none bg-cyan-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-cyan-700">Current</span>
                    ) : null}
                  </div>

                  <p className="mt-4 text-sm text-slate-600">
                    {isFreePlan ? 'Best for getting started and exploring the workspace.' : 'Unlock more capacity for your team and collaboration workflows.'}
                  </p>

                  <ul className="mt-6 space-y-3 text-sm text-slate-600">
                    {getPlanHighlights(plan.id).map((highlight) => (
                      <li key={highlight} className="flex items-start gap-2">
                        <span className="material-icons mt-0.5 text-cyan-600" style={{ fontSize: '1rem' }}>check_circle</span>
                        <span>{highlight}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-8 border-t border-slate-100 pt-4 text-sm text-slate-500">
                    <p>Seats: {plan.limits.seats}</p>
                    <p>Storage: {plan.limits.storageBytes >= 1024 * 1024 * 1024 ? `${(plan.limits.storageBytes / (1024 * 1024 * 1024)).toFixed(0)} GB` : `${plan.limits.storageBytes} bytes`}</p>
                    <p>AI requests/month: {plan.limits.aiRequestsPerMonth}</p>
                  </div>

                  <button
                    type="button"
                    disabled={isCurrent || isFreePlan || isSubmitting}
                    onClick={() => void handleSelectPlan(plan.id)}
                    className="mt-8 w-full rounded-none bg-cyan-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {isCurrent ? 'Current plan' : isSubmitting ? 'Starting checkout…' : `Upgrade to ${plan.name}`}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
