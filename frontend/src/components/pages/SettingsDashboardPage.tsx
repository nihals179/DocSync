import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { docsApi, organizationsApi, type BillingSnapshot, type OrganizationAuditLog, type OrganizationMembership, type OrganizationSecurityState, type OrganizationSummary } from '../../lib/api';

type SettingsDashboardPageProps = {
  token: string;
  userName: string;
};

type SettingsView = 'profile' | 'security' | 'billing' | 'audit' | 'admin';

function formatDate(iso: string | null | undefined) {
  if (!iso) return 'Not set';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export default function SettingsDashboardPage({ token, userName }: SettingsDashboardPageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedView = searchParams.get('view');
  const initialView: SettingsView =
    requestedView === 'profile' ||
    requestedView === 'security' ||
    requestedView === 'billing' ||
    requestedView === 'audit' ||
    requestedView === 'admin'
      ? requestedView
      : 'profile';
  const [activeView, setActiveView] = useState<SettingsView>(initialView);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [canOpenAdminConsole, setCanOpenAdminConsole] = useState(false);
  const [organization, setOrganization] = useState<OrganizationSummary | null>(null);
  const [membership, setMembership] = useState<OrganizationMembership | null>(null);
  const [security, setSecurity] = useState<OrganizationSecurityState | null>(null);
  const [billingSnapshot, setBillingSnapshot] = useState<BillingSnapshot | null>(null);
  const [recentAudit, setRecentAudit] = useState<OrganizationAuditLog[]>([]);
  const [documentsCount, setDocumentsCount] = useState(0);

  useEffect(() => {
    if (
      requestedView === 'profile' ||
      requestedView === 'security' ||
      requestedView === 'billing' ||
      requestedView === 'audit' ||
      requestedView === 'admin'
    ) {
      setActiveView(requestedView);
    }
  }, [requestedView]);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      try {
        setLoading(true);
        setError('');
        const [context, securityState, entitlements, audit, docs] = await Promise.all([
          organizationsApi.current(token),
          organizationsApi.getSecurity(token),
          organizationsApi.entitlements(token),
          organizationsApi.getOrganizationAuditLogs(token, { limit: 6 }),
          docsApi.list(token),
        ]);
        if (cancelled) return;
        const role = context.membership.role;
        const status = context.membership.status;
        setOrganization(context.organization);
        setMembership(context.membership);
        setSecurity(securityState.security);
        setBillingSnapshot({ ...entitlements.entitlements, invoices: [] });
        setRecentAudit(audit.logs);
        setDocumentsCount(Array.isArray(docs.docs) ? docs.docs.length : 0);
        setCanOpenAdminConsole(status === 'active' && (role === 'owner' || role === 'admin'));
      } catch (loadError) {
        if (!cancelled) {
          setCanOpenAdminConsole(false);
          setError(loadError instanceof Error ? loadError.message : 'Failed to load settings dashboard.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const navItems = useMemo(
    () => [
      { id: 'profile' as const, label: 'Profile', icon: 'person' },
      { id: 'security' as const, label: 'Security', icon: 'shield' },
      { id: 'billing' as const, label: 'Billing', icon: 'payments' },
      { id: 'audit' as const, label: 'Audit', icon: 'fact_check' },
      { id: 'admin' as const, label: 'Admin Tools', icon: 'admin_panel_settings' },
    ],
    [],
  );

  const currentViewLabel = useMemo(() => {
    const selected = navItems.find((item) => item.id === activeView);
    return selected?.label ?? 'Profile';
  }, [activeView, navItems]);

  const effectiveSeatLimit = useMemo(() => {
    const seatsPurchased = billingSnapshot?.limits?.seatsPurchased;
    if (typeof seatsPurchased === 'number' && seatsPurchased > 0) {
      return seatsPurchased;
    }
    return billingSnapshot?.plan?.id === 'free' ? 1 : 0;
  }, [billingSnapshot]);

  const documentLimit = billingSnapshot?.limits.documents;
  const documentUpdatesLimit = billingSnapshot?.limits.documentUpdatesPerMonth;
  const versionHistoryDays = billingSnapshot?.limits.versionHistoryDays;
  const grammarAccessDays = billingSnapshot?.limits.grammarAccessDays;
  const aiAccessDays = billingSnapshot?.limits.aiAccessDays;

  const currentPlanId = String(billingSnapshot?.plan?.id || 'free').toLowerCase();
  const organizationRequired = currentPlanId === 'enterprise' || currentPlanId === 'onprem';
  const membershipTypeLabel = useMemo(() => {
    if (currentPlanId === 'onprem') return 'Onprem';
    if (currentPlanId === 'enterprise') return 'Enterprise';
    if (currentPlanId === 'pro') return 'Pro';
    return 'Free';
  }, [currentPlanId]);

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="space-y-0">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">Workspace Settings</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">Settings Dashboard</h1>
            <p className="mt-2 text-sm text-slate-600">Unified control surface for profile, security, billing, audit, and admin workflows. Operator: {userName}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/security')}
              className="border border-cyan-200 bg-white px-4 py-2 text-sm font-bold text-cyan-700 transition hover:bg-cyan-50"
            >
              Open Security
            </button>
            <button
              type="button"
              onClick={() => navigate('/workspace')}
              className="border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-100"
            >
              Back to Workspace
            </button>
          </div>
        </div>

        {error && <div className="border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-700">{error}</div>}

        <section className="grid min-h-[calc(100vh-118px)] lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="border-r border-slate-200 bg-white px-4 py-5">
            <div className="mb-4 bg-cyan-50 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wider text-cyan-700">Current Context</p>
              <p className="mt-1 text-sm font-bold text-slate-900">
                {organizationRequired ? (organization?.name || 'Organization') : `${userName}'s Account`}
              </p>
              {organizationRequired ? (
                <p className="text-xs text-slate-600">Role: {membership?.role || 'unknown'} • Status: {membership?.status || 'unknown'}</p>
              ) : (
                <p className="text-xs text-slate-600">Personal workspace mode for {billingSnapshot?.plan?.name || 'Starter'}.</p>
              )}
              <p className="text-xs text-slate-600">Membership Type: {membershipTypeLabel}</p>
            </div>

            <nav className="space-y-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveView(item.id)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold transition ${
                    activeView === item.id
                      ? 'bg-cyan-600 text-white'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span className="material-icons" style={{ fontSize: '1rem' }}>{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </nav>
          </aside>

          <div className="space-y-0 bg-slate-50">
            <article className="border-b border-slate-200 bg-white px-6 py-5">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-700">Active View</p>
              <h2 className="mt-2 text-2xl font-black text-slate-900">{currentViewLabel}</h2>
              {loading ? <p className="mt-2 text-sm text-slate-500">Loading settings intelligence...</p> : null}
            </article>

            {activeView === 'profile' && (
              <section className="grid gap-px bg-slate-200 md:grid-cols-2">
                <article className="bg-white px-6 py-5">
                  <h3 className="text-base font-black text-slate-900">Profile Summary</h3>
                  <p className="mt-2 text-sm text-slate-600">Display Name: {userName}</p>
                  {organizationRequired ? (
                    <>
                      <p className="mt-1 text-sm text-slate-600">Organization: {organization?.name || 'Unavailable'}</p>
                      <p className="mt-1 text-sm text-slate-600">Role: {membership?.role || 'unknown'}</p>
                      <p className="mt-1 text-sm text-slate-600">Membership Status: {membership?.status || 'unknown'}</p>
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-slate-600">Account Type: Personal</p>
                  )}
                  <p className="mt-1 text-sm text-slate-600">Membership Type: {membershipTypeLabel}</p>
                  <p className="mt-1 text-sm text-slate-600">License: {billingSnapshot?.plan.name || 'Starter'} ({billingSnapshot?.plan.displayPrice || 'Free'})</p>
                  <p className="mt-1 text-sm text-slate-600">Seat Limit: {effectiveSeatLimit}</p>
                  <p className="mt-1 text-sm text-slate-600">Documents: {documentsCount}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    AI Assistant: {
                      billingSnapshot?.plan?.featureHighlights?.some((item) => /AI Assistant/i.test(item))
                        ? 'Enabled'
                        : 'Not included in current license'
                    }
                  </p>
                  <button type="button" onClick={() => navigate('/security')} className="mt-4 bg-cyan-600 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-500">Open Account Security</button>
                </article>

                <article className="bg-white px-6 py-5">
                  <h3 className="text-base font-black text-slate-900">Usage Overview</h3>
                  <p className="mt-2 text-sm text-slate-600">
                    Documents Used: {documentsCount}{' '}
                    {typeof documentLimit === 'number' ? `/ ${documentLimit}` : '/ Unlimited'}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Documents Pending: {
                      typeof documentLimit === 'number'
                        ? Math.max(documentLimit - documentsCount, 0)
                        : 'Unlimited'
                    }
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Document Updates Used: {billingSnapshot?.usage.documentUpdates || 0}{' '}
                    {typeof documentUpdatesLimit === 'number' ? `/ ${documentUpdatesLimit}` : '/ Unlimited'}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Document Updates Pending: {
                      typeof documentUpdatesLimit === 'number'
                        ? Math.max(documentUpdatesLimit - (billingSnapshot?.usage.documentUpdates || 0), 0)
                        : 'Unlimited'
                    }
                  </p>
                  <p className="mt-1 text-sm text-slate-600">Version History: {typeof versionHistoryDays === 'number' ? `${versionHistoryDays} days` : 'Unlimited'}</p>
                  <p className="mt-1 text-sm text-slate-600">Grammar Checker Access: {typeof grammarAccessDays === 'number' ? `First ${grammarAccessDays} days` : 'Unlimited'}</p>
                  <p className="mt-1 text-sm text-slate-600">AI Assistant Access: {typeof aiAccessDays === 'number' ? `First ${aiAccessDays} days` : 'Unlimited'}</p>
                  <p className="mt-2 text-sm text-slate-600">AI Requests Used: {billingSnapshot?.usage.aiRequests || 0}</p>
                  <p className="mt-1 text-sm text-slate-600">AI Requests Pending: {Math.max((billingSnapshot?.limits.aiRequestsPerMonth || 0) - (billingSnapshot?.usage.aiRequests || 0), 0)}</p>
                  <p className="mt-1 text-sm text-slate-600">Storage Used: {formatBytes(billingSnapshot?.usage.storageUsedBytes || 0)}</p>
                  <p className="mt-1 text-sm text-slate-600">Storage Pending: {formatBytes(Math.max((billingSnapshot?.limits.storageBytes || 0) - (billingSnapshot?.usage.storageUsedBytes || 0), 0))}</p>
                  <p className="mt-1 text-sm text-slate-600">Collaborators Used: {billingSnapshot?.usage.collaboratorsAssigned || 0}</p>
                  <p className="mt-1 text-sm text-slate-600">Collaborators Pending: {Math.max((billingSnapshot?.limits.collaborators || 0) - (billingSnapshot?.usage.collaboratorsAssigned || 0), 0)}</p>
                  <p className="mt-1 text-sm text-slate-600">Seats Assigned: {billingSnapshot?.usage.assignedSeats || 0}</p>
                  <p className="mt-1 text-sm text-slate-600">Seats Pending: {Math.max(effectiveSeatLimit - (billingSnapshot?.usage.assignedSeats || 0), 0)}</p>
                </article>
              </section>
            )}

            {activeView === 'security' && (
              <section className="grid gap-px bg-slate-200 md:grid-cols-2">
                <article className="bg-white px-6 py-5">
                  <h3 className="text-base font-black text-slate-900">Access Security</h3>
                  <p className="mt-2 text-sm text-slate-600">MFA Policy: {security?.requireMfa ? 'Required for all users' : 'Not enforced'}</p>
                  <p className="mt-1 text-sm text-slate-600">IP Allowlist: {security?.ipAllowlistEnabled ? 'Enabled' : 'Disabled'}</p>
                  <p className="mt-1 text-sm text-slate-600">Allowed IP Count: {security?.ipAllowlist?.length || 0}</p>
                  <button type="button" onClick={() => setActiveView('security')} className="mt-4 bg-cyan-600 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-500">Open Security Policies</button>
                </article>

                <article className="bg-white px-6 py-5">
                  <h3 className="text-base font-black text-slate-900">Identity & Sessions</h3>
                  <p className="mt-2 text-sm text-slate-600">Session Timeout: {security?.sessionDurationHours || 8} hours</p>
                  <p className="mt-1 text-sm text-slate-600">Domain Mappings: {security?.domainMappings?.length || 0}</p>
                  <p className="mt-1 text-sm text-slate-600">SSO Providers: {security?.ssoProviders?.length || 0}</p>
                  <button type="button" onClick={() => navigate('/security')} className="mt-4 border border-cyan-200 bg-white px-4 py-2 text-sm font-bold text-cyan-700 hover:bg-cyan-50">Open Account Security</button>
                </article>
              </section>
            )}

            {activeView === 'billing' && (
              <section className="grid gap-px bg-slate-200 md:grid-cols-2">
                <article className="bg-white px-6 py-5">
                  <h3 className="text-base font-black text-slate-900">Plan & Seats</h3>
                  <p className="mt-2 text-sm text-slate-600">Plan: {billingSnapshot?.billing.planId || 'free'}</p>
                  <p className="mt-1 text-sm text-slate-600">Status: {billingSnapshot?.billing.status || 'active'}</p>
                  <p className="mt-1 text-sm text-slate-600">Purchased Seats: {billingSnapshot?.limits.seatsPurchased || 0}</p>
                  <p className="mt-1 text-sm text-slate-600">Assigned Seats: {billingSnapshot?.usage.assignedSeats || 0}</p>
                  <button type="button" onClick={() => setActiveView('billing')} className="mt-4 bg-cyan-600 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-500">Manage Billing</button>
                </article>

                <article className="bg-white px-6 py-5">
                  <h3 className="text-base font-black text-slate-900">Usage & Limits</h3>
                  <p className="mt-2 text-sm text-slate-600">AI Usage: {billingSnapshot?.usage.aiRequests || 0} / {billingSnapshot?.limits.aiRequestsPerMonth || 0}</p>
                  <p className="mt-1 text-sm text-slate-600">Storage: {formatBytes(billingSnapshot?.usage.storageUsedBytes || 0)} / {formatBytes(billingSnapshot?.limits.storageBytes || 0)}</p>
                  <p className="mt-1 text-sm text-slate-600">Collaborators: {billingSnapshot?.usage.collaboratorsAssigned || 0} / {billingSnapshot?.limits.collaborators || 0}</p>
                </article>

                <article className="bg-white px-6 py-5 md:col-span-2">
                  <h3 className="text-base font-black text-slate-900">License Options</h3>
                  <p className="mt-1 text-sm text-slate-600">Available plans and included capabilities.</p>
                  <div className="mt-4 grid gap-3 lg:grid-cols-4">
                    {[
                      {
                        name: 'Starter',
                        price: 'Free',
                        features: ['1 workspace', 'Basic editor', 'Version history (7 days)', 'Community support'],
                      },
                      {
                        name: 'Pro',
                        price: '$12/mo',
                        features: ['Unlimited workspaces', 'AI Assistant', 'Grammar checker', 'Priority support', 'Version history (90 days)'],
                      },
                      {
                        name: 'Enterprise',
                        price: 'Custom',
                        features: ['SSO & SAML', 'Custom roles & RBAC', 'Audit logs', 'SLA & dedicated support', 'On-premise option'],
                      },
                      {
                        name: 'Onprem',
                        price: 'Custom',
                        features: ['Self-hosted deployment', 'Private network only', 'Custom compliance controls', 'Dedicated success team'],
                      },
                    ].map((plan) => (
                      <div key={plan.name} className="border border-slate-200 p-4">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-700">{plan.name}</p>
                        <p className="mt-1 text-xl font-black text-slate-900">{plan.price}</p>
                        <ul className="mt-3 space-y-1 text-sm text-slate-700">
                          {plan.features.map((feature) => (
                            <li key={feature} className="flex items-start gap-2">
                              <span className="text-cyan-600">✓</span>
                              <span>{feature}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </article>
              </section>
            )}

            {activeView === 'audit' && (
              <section className="bg-white px-6 py-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-base font-black text-slate-900">Recent Audit Events</h3>
                  <button type="button" onClick={() => setActiveView('audit')} className="bg-cyan-600 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-500">Open Full Audit Section</button>
                </div>
                <div className="mt-4 space-y-2">
                  {recentAudit.length === 0 && <p className="text-sm text-slate-500">No recent audit events available.</p>}
                  {recentAudit.map((log) => (
                    <div key={log.id} className="border border-slate-200 px-3 py-2 text-sm">
                      <p className="font-semibold text-slate-800">{log.action}</p>
                      <p className="text-slate-600">Status: {log.status} • {formatDate(log.createdAt)}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {activeView === 'admin' && (
              <section className="grid gap-px bg-slate-200 md:grid-cols-2">
                <article className="bg-white px-6 py-5">
                  <h3 className="text-base font-black text-slate-900">Admin Console</h3>
                  <p className="mt-2 text-sm text-slate-600">Access member, role, invite, compliance, and operational tools from the admin interface.</p>
                  <button
                    type="button"
                    disabled={!canOpenAdminConsole}
                    onClick={() => window.open('/admin', '_blank', 'noopener,noreferrer')}
                    className="mt-4 bg-cyan-600 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {canOpenAdminConsole ? 'Open Admin Console' : 'Admin Access Required'}
                  </button>
                </article>

                <article className="bg-white px-6 py-5">
                  <h3 className="text-base font-black text-slate-900">Organization Context</h3>
                  <p className="mt-2 text-sm text-slate-600">Organization: {organization?.name || 'Unavailable'}</p>
                  <p className="mt-1 text-sm text-slate-600">Role: {membership?.role || 'unknown'}</p>
                  <p className="mt-1 text-sm text-slate-600">Membership Status: {membership?.status || 'unknown'}</p>
                </article>
              </section>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
