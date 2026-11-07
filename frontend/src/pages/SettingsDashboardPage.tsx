import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import AccountSecurityPanel from '../components/settings/AccountSecurityPanel';
import { docsApi, tenantsApi, type AuthUser, type BillingSnapshot, type TenantAuditLog, type tenantMembership, type TenantSecurityState, type TenantSummary } from '../services/api';

type SettingsDashboardPageProps = {
  token: string;
  userName: string;
  user: AuthUser;
  onUserUpdate: (user: AuthUser) => void;
  onLoggedOut: () => void;
};

type SettingsView = 'profile' | 'security' | 'policies' | 'billing' | 'audit' | 'admin';

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

function initialsFor(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
}

function Panel({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article className={`rounded-2xl border border-slate-200 bg-white p-6 shadow-sm ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </article>
  );
}

function InfoRows({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-slate-100">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-4 py-2.5 text-sm">
          <dt className="text-slate-500">{row.label}</dt>
          <dd className="text-right font-semibold text-slate-900">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function StatusBadge({ tone, children }: { tone: 'good' | 'warn' | 'neutral'; children: ReactNode }) {
  const styles = {
    good: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    warn: 'bg-amber-50 text-amber-700 ring-amber-200',
    neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${styles[tone]}`}>
      {children}
    </span>
  );
}

function UsageMeter({
  label,
  used,
  limit,
  format = (value: number) => String(value),
}: {
  label: string;
  used: number;
  limit: number | null;
  format?: (value: number) => string;
}) {
  const unlimited = limit === null;
  const percent = unlimited || limit <= 0 ? 0 : Math.min((used / limit) * 100, 100);
  const barTone = percent >= 90 ? 'bg-red-500' : percent >= 70 ? 'bg-amber-500' : 'bg-cyan-600';
  const remaining = unlimited ? 'Unlimited' : `${format(Math.max(limit - used, 0))} left`;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold text-slate-800">{label}</span>
        <span className="text-slate-600">
          <span className="font-bold text-slate-900">{format(used)}</span>
          {' / '}
          {unlimited ? 'Unlimited' : format(limit)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(unlimited ? 0 : percent)}
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100"
      >
        <div className={`h-full rounded-full transition-all ${barTone}`} style={{ width: `${unlimited ? 0 : percent}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-slate-500">{remaining}</p>
    </div>
  );
}

export default function SettingsDashboardPage({ token, userName, user, onUserUpdate, onLoggedOut }: SettingsDashboardPageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedView = searchParams.get('view');
  const initialView: SettingsView =
    requestedView === 'profile' ||
    requestedView === 'security' ||
    requestedView === 'policies' ||
    requestedView === 'billing' ||
    requestedView === 'audit' ||
    requestedView === 'admin'
      ? requestedView
      : 'profile';
  const [activeView, setActiveView] = useState<SettingsView>(initialView);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [canOpenAdminConsole, setCanOpenAdminConsole] = useState(false);
  const [tenant, setTenant] = useState<TenantSummary | null>(null);
  const [membership, setMembership] = useState<tenantMembership | null>(null);
  const [security, setSecurity] = useState<TenantSecurityState | null>(null);
  const [billingSnapshot, setBillingSnapshot] = useState<BillingSnapshot | null>(null);
  const [recentAudit, setRecentAudit] = useState<TenantAuditLog[]>([]);
  const [documentsCount, setDocumentsCount] = useState(0);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (
      requestedView === 'profile' ||
      requestedView === 'security' ||
      requestedView === 'policies' ||
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
        const [context, securityState, entitlements, audit, docs, mine] = await Promise.all([
          tenantsApi.current(token),
          tenantsApi.getSecurity(token),
          tenantsApi.entitlements(token),
          tenantsApi.getTenantAuditLogs(token, { limit: 6 }),
          docsApi.list(token),
          tenantsApi.mine(token),
        ]);
        if (cancelled) return;
        const status = context.membership.status;
        setTenants(mine.tenants);
        setTenant(context.tenant);
        setMembership(context.membership);
        setSecurity(securityState.security);
        setBillingSnapshot({ ...entitlements.entitlements, invoices: [] });
        setRecentAudit(audit.logs);
        setDocumentsCount(Array.isArray(docs.docs) ? docs.docs.length : 0);
        setCanOpenAdminConsole(status === 'active');
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
  }, [token, reloadKey]);

  async function handleSwitchTenant(nextTenantId: string) {
    if (!nextTenantId || nextTenantId === tenant?.id) return;
    setError('');
    try {
      await tenantsApi.switchContext(token, nextTenantId);
      setReloadKey((key) => key + 1);
    } catch (switchError) {
      setError(switchError instanceof Error ? switchError.message : 'Failed to switch tenant.');
    }
  }

  const tenantSwitcher = tenants.length > 1 ? (
    <label className="mt-4 block">
      <span className="text-xs font-bold uppercase tracking-wider text-cyan-700">Switch tenant</span>
      <select
        value={tenant?.id || ''}
        onChange={(event) => void handleSwitchTenant(event.target.value)}
        disabled={loading}
        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 disabled:opacity-50"
      >
        {tenants.map((item) => (
          <option key={item.id} value={item.id}>{item.name}</option>
        ))}
      </select>
    </label>
  ) : null;

  const navItems = useMemo(
    () => [
      { id: 'profile' as const, label: 'Profile', icon: 'person' },
      { id: 'security' as const, label: 'Security', icon: 'shield' },
      { id: 'policies' as const, label: 'Security Policies', icon: 'policy' },
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
  const tenantRequired = currentPlanId === 'enterprise' || currentPlanId === 'onprem';
  const membershipTypeLabel = useMemo(() => {
    if (currentPlanId === 'onprem') return 'Onprem';
    if (currentPlanId === 'enterprise') return 'Enterprise';
    if (currentPlanId === 'pro') return 'Pro';
    return 'Free';
  }, [currentPlanId]);

  const aiRequestsLimit = billingSnapshot?.limits.aiRequestsPerMonth ?? 0;
  const storageLimit = billingSnapshot?.limits.storageBytes ?? 0;
  const collaboratorsLimit = billingSnapshot?.limits.collaborators ?? 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-6 lg:px-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">Workspace settings</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">Settings</h1>
            <p className="mt-1.5 text-sm text-slate-500">Signed in as <span className="font-semibold text-slate-700">{userName}</span></p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveView('security')}
              className="rounded-lg border border-cyan-200 bg-white px-4 py-2 text-sm font-semibold text-cyan-700 shadow-sm transition hover:bg-cyan-50"
            >
              Open security
            </button>
            <button
              type="button"
              onClick={() => navigate('/workspace')}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              Back to workspace
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="mx-6 mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 lg:mx-10">{error}</div>
      )}

      <div className="grid gap-6 p-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:px-10">
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-2xl border border-cyan-100 bg-cyan-50/60 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-cyan-700">Current context</p>
            <p className="mt-2 text-base font-bold text-slate-900">
              {tenantRequired ? (tenant?.name || 'Tenant') : `${userName}'s account`}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <StatusBadge tone="neutral">{membershipTypeLabel}</StatusBadge>
              {tenantRequired ? (
                <StatusBadge tone={membership?.status === 'active' ? 'good' : 'warn'}>
                  {membership?.status || 'unknown'}
                </StatusBadge>
              ) : (
                <StatusBadge tone="neutral">Personal workspace</StatusBadge>
              )}
            </div>
            {tenantSwitcher}
          </div>

          <nav className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
            {navItems.map((item) => {
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveView(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                    isActive ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <span className="material-icons" style={{ fontSize: '1.1rem' }} aria-hidden="true">{item.icon}</span>
                  {item.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Viewing</p>
              <h2 className="mt-1 text-2xl font-black text-slate-900">{currentViewLabel}</h2>
            </div>
            {loading && <p className="text-sm text-slate-500">Loading latest data…</p>}
          </div>

          {activeView === 'profile' && (
            <div className="grid gap-6 xl:grid-cols-2">
              {tenantSwitcher && (
                <Panel title="Tenant" description="Choose which tenant this session works in.">
                  <p className="text-sm text-slate-600">You belong to {tenants.length} tenants. Switching reloads this page for the selected tenant.</p>
                  {tenantSwitcher}
                </Panel>
              )}

              <Panel
                title="Profile summary"
                className="xl:col-span-1"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-cyan-100 text-lg font-black text-cyan-700">
                    {initialsFor(userName)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-base font-bold text-slate-900">{userName}</p>
                    <p className="text-sm text-slate-500">{tenantRequired ? (tenant?.name || 'Unavailable') : 'Personal account'}</p>
                  </div>
                </div>
                <div className="mt-5">
                  <InfoRows
                    rows={[
                      ...(tenantRequired
                        ? [
                            { label: 'Tenant', value: tenant?.name || 'Unavailable' },
                            { label: 'Membership status', value: <StatusBadge tone={membership?.status === 'active' ? 'good' : 'warn'}>{membership?.status || 'unknown'}</StatusBadge> },
                          ]
                        : [{ label: 'Account type', value: 'Personal' }]),
                      { label: 'Membership type', value: membershipTypeLabel },
                      { label: 'License', value: `${billingSnapshot?.plan.name || 'Starter'} (${billingSnapshot?.plan.displayPrice || 'Free'})` },
                      { label: 'Seat limit', value: effectiveSeatLimit },
                      {
                        label: 'AI assistant',
                        value: billingSnapshot?.plan?.featureHighlights?.some((item) => /AI Assistant/i.test(item))
                          ? <StatusBadge tone="good">Enabled</StatusBadge>
                          : <StatusBadge tone="neutral">Not included</StatusBadge>,
                      },
                    ]}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setActiveView('security')}
                  className="mt-5 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-500"
                >
                  Open account security
                </button>
              </Panel>

              <Panel title="Usage overview" description="Current month usage against your license." className="xl:col-span-2">
                <div className="grid gap-6 md:grid-cols-2">
                  <UsageMeter label="Documents" used={documentsCount} limit={typeof documentLimit === 'number' ? documentLimit : null} />
                  <UsageMeter label="Document updates" used={billingSnapshot?.usage.documentUpdates || 0} limit={typeof documentUpdatesLimit === 'number' ? documentUpdatesLimit : null} />
                  <UsageMeter label="AI requests" used={billingSnapshot?.usage.aiRequests || 0} limit={aiRequestsLimit} />
                  <UsageMeter label="Storage" used={billingSnapshot?.usage.storageUsedBytes || 0} limit={storageLimit} format={formatBytes} />
                  <UsageMeter label="Collaborators" used={billingSnapshot?.usage.collaboratorsAssigned || 0} limit={collaboratorsLimit} />
                  <UsageMeter label="Seats" used={billingSnapshot?.usage.assignedSeats || 0} limit={effectiveSeatLimit} />
                </div>
                <div className="mt-6 border-t border-slate-100 pt-4">
                  <InfoRows
                    rows={[
                      { label: 'Version history', value: typeof versionHistoryDays === 'number' ? `${versionHistoryDays} days` : 'Unlimited' },
                      { label: 'Grammar checker access', value: typeof grammarAccessDays === 'number' ? `First ${grammarAccessDays} days` : 'Unlimited' },
                      { label: 'AI assistant access', value: typeof aiAccessDays === 'number' ? `First ${aiAccessDays} days` : 'Unlimited' },
                    ]}
                  />
                </div>
              </Panel>
            </div>
          )}

          {activeView === 'security' && (
            <AccountSecurityPanel token={token} user={user} onUserUpdate={onUserUpdate} onLoggedOut={onLoggedOut} />
          )}

          {activeView === 'policies' && (
            <div className="grid gap-6 xl:grid-cols-2">
              <Panel
                title="Access security"
                action={
                  <button
                    type="button"
                    disabled={!canOpenAdminConsole}
                    onClick={() => window.open('/admin', '_blank', 'noopener,noreferrer')}
                    className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {canOpenAdminConsole ? 'Manage in admin console' : 'Admin access required'}
                  </button>
                }
              >
                <InfoRows
                  rows={[
                    {
                      label: 'MFA policy',
                      value: security?.requireMfa
                        ? <StatusBadge tone="good">Required for all users</StatusBadge>
                        : <StatusBadge tone="warn">Not enforced</StatusBadge>,
                    },
                    {
                      label: 'IP allowlist',
                      value: security?.ipAllowlistEnabled
                        ? <StatusBadge tone="good">Enabled</StatusBadge>
                        : <StatusBadge tone="neutral">Disabled</StatusBadge>,
                    },
                    { label: 'Allowed IP count', value: security?.ipAllowlist?.length || 0 },
                  ]}
                />
              </Panel>

              <Panel title="Identity & sessions">
                <InfoRows
                  rows={[
                    { label: 'Session timeout', value: `${security?.sessionDurationHours || 8} hours` },
                    { label: 'Domain mappings', value: security?.domainMappings?.length || 0 },
                    { label: 'SSO providers', value: security?.ssoProviders?.length || 0 },
                  ]}
                />
              </Panel>
            </div>
          )}

          {activeView === 'billing' && (
            <div className="grid gap-6 xl:grid-cols-2">
              <Panel
                title="Plan & seats"
                action={
                  <button type="button" onClick={() => setActiveView('billing')} className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-500">
                    Manage billing
                  </button>
                }
              >
                <InfoRows
                  rows={[
                    { label: 'Plan', value: billingSnapshot?.billing.planId || 'free' },
                    {
                      label: 'Status',
                      value: <StatusBadge tone={(billingSnapshot?.billing.status || 'active') === 'active' ? 'good' : 'warn'}>{billingSnapshot?.billing.status || 'active'}</StatusBadge>,
                    },
                    { label: 'Purchased seats', value: billingSnapshot?.limits.seatsPurchased || 0 },
                    { label: 'Assigned seats', value: billingSnapshot?.usage.assignedSeats || 0 },
                  ]}
                />
              </Panel>

              <Panel title="Usage & limits" description="How much of your plan you have used.">
                <div className="space-y-5">
                  <UsageMeter label="AI requests" used={billingSnapshot?.usage.aiRequests || 0} limit={aiRequestsLimit} />
                  <UsageMeter label="Storage" used={billingSnapshot?.usage.storageUsedBytes || 0} limit={storageLimit} format={formatBytes} />
                  <UsageMeter label="Collaborators" used={billingSnapshot?.usage.collaboratorsAssigned || 0} limit={collaboratorsLimit} />
                </div>
              </Panel>

              <Panel title="License options" description="Available plans and what each one includes." className="xl:col-span-2">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
                  ].map((plan) => {
                    const isCurrent = plan.name.toLowerCase() === currentPlanId;
                    return (
                      <div
                        key={plan.name}
                        className={`flex flex-col rounded-xl border p-5 ${isCurrent ? 'border-cyan-500 bg-cyan-50/50 ring-1 ring-cyan-500' : 'border-slate-200'}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-700">{plan.name}</p>
                          {isCurrent && <StatusBadge tone="good">Current plan</StatusBadge>}
                        </div>
                        <p className="mt-2 text-2xl font-black text-slate-900">{plan.price}</p>
                        <ul className="mt-4 space-y-2 text-sm text-slate-700">
                          {plan.features.map((feature) => (
                            <li key={feature} className="flex items-start gap-2">
                              <span className="font-bold text-cyan-600" aria-hidden="true">✓</span>
                              <span>{feature}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </Panel>
            </div>
          )}

          {activeView === 'audit' && (
            <Panel
              title="Recent audit events"
              description="The six most recent events for this tenant."
              action={
                <button type="button" onClick={() => setActiveView('audit')} className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-500">
                  Open full audit section
                </button>
              }
            >
              <ul className="divide-y divide-slate-100">
                {recentAudit.length === 0 && <li className="py-3 text-sm text-slate-500">No recent audit events available.</li>}
                {recentAudit.map((log) => (
                  <li key={log.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{log.action}</p>
                      <p className="text-xs text-slate-500">{formatDate(log.createdAt)}</p>
                    </div>
                    <StatusBadge tone={log.status === 'success' ? 'good' : log.status === 'failure' ? 'warn' : 'neutral'}>{log.status}</StatusBadge>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {activeView === 'admin' && (
            <div className="grid gap-6 xl:grid-cols-2">
              <Panel
                title="Admin console"
                description="Member, role, invite, compliance, and operational tools in the admin interface."
                action={
                  <button
                    type="button"
                    disabled={!canOpenAdminConsole}
                    onClick={() => window.open('/admin', '_blank', 'noopener,noreferrer')}
                    className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {canOpenAdminConsole ? 'Open admin console' : 'Admin access required'}
                  </button>
                }
              >
                <p className="text-sm text-slate-500">{canOpenAdminConsole ? 'Opens in a new tab.' : 'Your membership must be active to open the admin console.'}</p>
              </Panel>

              <Panel title="Tenant context">
                <InfoRows
                  rows={[
                    { label: 'Tenant', value: tenant?.name || 'Unavailable' },
                    { label: 'Membership status', value: membership?.status || 'unknown' },
                  ]}
                />
              </Panel>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
