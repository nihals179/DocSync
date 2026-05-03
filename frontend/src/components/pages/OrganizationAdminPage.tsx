import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  billingApi,
  docsApi,
  organizationsApi,
  versionsApi,
  type BillingInvoice,
  type BillingPlan,
  type BillingSnapshot,
  type OrganizationAuditLog,
  type OrganizationInvite,
  type OrganizationMember,
  type OrganizationMembership,
  type OrganizationSecurityState,
  type OrganizationSummary,
  type SsoProvider,
} from '../../lib/api';

const ROLE_OPTIONS = ['owner', 'admin', 'editor', 'viewer'] as const;

type RoleValue = (typeof ROLE_OPTIONS)[number];

type MemberDrafts = Record<string, { role: RoleValue; billingAdmin: boolean }>;

type AdminView = 'dashboard' | 'members' | 'invites' | 'documents' | 'versions' | 'usage' | 'licenses' | 'billing' | 'audit' | 'enterpriseSecurity' | 'fileRepository';

type AdminDocument = {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
};

type VersionActivity = {
  docId: string;
  docTitle: string;
  count: number;
  lastSavedAt: string | null;
};

type ProviderDraft = {
  type: 'oidc' | 'saml' | 'ldap';
  name: string;
  issuerUrl: string;
  ssoUrl: string;
  clientId: string;
  clientSecret: string;
  certificate: string;
  enabled: boolean;
};

const EMPTY_PROVIDER: ProviderDraft = {
  type: 'oidc',
  name: '',
  issuerUrl: '',
  ssoUrl: '',
  clientId: '',
  clientSecret: '',
  certificate: '',
  enabled: true,
};

interface OrganizationAdminPageProps {
  token: string;
  userName: string;
  onAdminLogout: () => void;
}

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-violet-100 text-violet-700',
  admin: 'bg-cyan-100 text-cyan-700',
  editor: 'bg-blue-100 text-blue-700',
  viewer: 'bg-slate-100 text-slate-600',
};

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatCurrency(cents: number, currency = 'USD') {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function toPercent(used: number, total: number) {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
}

function contains(source: string | number | null | undefined, query: string) {
  if (!query.trim()) return true;
  return String(source ?? '').toLowerCase().includes(query.trim().toLowerCase());
}

export default function OrganizationAdminPage({ token, userName, onAdminLogout }: OrganizationAdminPageProps) {
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [currentOrganizationId, setCurrentOrganizationId] = useState<string>('');
  const [membership, setMembership] = useState<OrganizationMembership | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [memberDrafts, setMemberDrafts] = useState<MemberDrafts>({});
  const [invites, setInvites] = useState<OrganizationInvite[]>([]);
  const [documents, setDocuments] = useState<AdminDocument[]>([]);
  const [versionActivity, setVersionActivity] = useState<VersionActivity[]>([]);
  const [activeView, setActiveView] = useState<AdminView>('dashboard');
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [adminInsights, setAdminInsights] = useState({
    documents: 0,
    versionHistory: 0,
    versionSampleCount: 0,
    aiUsed: 0,
    aiLimit: 0,
    storageUsed: 0,
    storageLimit: 0,
    assignedSeats: 0,
    purchasedSeats: 0,
  });

  const [memberFilters, setMemberFilters] = useState({ member: '', role: '', billing: '' });
  const [inviteDraft, setInviteDraft] = useState<{ email: string; role: RoleValue }>({
    email: '',
    role: 'viewer',
  });
  const [inviteFilters, setInviteFilters] = useState({ email: '', role: '', billing: '', expires: '', status: '' });
  const [documentFilters, setDocumentFilters] = useState({ title: '', preview: '', updated: '' });
  const [versionFilters, setVersionFilters] = useState({ document: '', versions: '', lastSaved: '' });

  const [security, setSecurity] = useState<OrganizationSecurityState | null>(null);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [requireMfa, setRequireMfa] = useState(false);
  const [sessionDurationHours, setSessionDurationHours] = useState(8);
  const [ipAllowlistEnabled, setIpAllowlistEnabled] = useState(false);
  const [ipAllowlistText, setIpAllowlistText] = useState('');
  const [domainText, setDomainText] = useState('');
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(EMPTY_PROVIDER);
  const [simulateEmail, setSimulateEmail] = useState('');
  const [simulateResult, setSimulateResult] = useState('');

  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState('');
  const [billingSnapshot, setBillingSnapshot] = useState<BillingSnapshot | null>(null);
  const [billingPlans, setBillingPlans] = useState<BillingPlan[]>([]);
  const [billingInvoices, setBillingInvoices] = useState<BillingInvoice[]>([]);
  const [billingPlanId, setBillingPlanId] = useState('free');
  const [billingSeats, setBillingSeats] = useState(1);
  const [billingMonths, setBillingMonths] = useState(12);

  const [auditLoading, setAuditLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState<OrganizationAuditLog[]>([]);
  const [auditActionFilter, setAuditActionFilter] = useState('');
  const [auditStatusFilter, setAuditStatusFilter] = useState('');
  const [auditLimit, setAuditLimit] = useState(200);

  const canManageMembers = useMemo(() => {
    const role = membership?.role;
    return role === 'owner' || role === 'admin';
  }, [membership]);

  const aiUsagePct = useMemo(
    () => toPercent(adminInsights.aiUsed, adminInsights.aiLimit),
    [adminInsights.aiUsed, adminInsights.aiLimit],
  );

  const storageUsagePct = useMemo(
    () => toPercent(adminInsights.storageUsed, adminInsights.storageLimit),
    [adminInsights.storageLimit, adminInsights.storageUsed],
  );

  const seatUsagePct = useMemo(
    () => toPercent(adminInsights.assignedSeats, adminInsights.purchasedSeats),
    [adminInsights.assignedSeats, adminInsights.purchasedSeats],
  );

  const menuSections = useMemo(
    () => [
      {
        title: 'Maintainace',
        items: [
          { key: 'dashboard' as const, label: 'Dashboard', icon: 'dashboard' },
          { key: 'documents' as const, label: 'Documents', icon: 'description' },
        ],
      },
      {
        title: 'Configuration',
        items: [
          { key: 'enterpriseSecurity' as const, label: 'Enterprise Security', icon: 'shield' },
          { key: 'fileRepository' as const, label: 'File Repository', icon: 'folder_open' },
        ],
      },
      {
        title: 'Management',
        items: [
          { key: 'members' as const, label: 'Members', icon: 'groups' },
          { key: 'invites' as const, label: 'Pending Invites', icon: 'mail' },
          { key: 'licenses' as const, label: 'Licenses', icon: 'workspace_premium' },
          { key: 'billing' as const, label: 'Billing', icon: 'receipt_long' },
        ],
      },
      {
        title: 'Reports',
        items: [
          { key: 'usage' as const, label: 'Usage & Limits', icon: 'analytics' },
          { key: 'versions' as const, label: 'Version History', icon: 'history' },
          { key: 'audit' as const, label: 'Audit Console', icon: 'fact_check' },
        ],
      },
    ],
    [],
  );

  const activeViewMeta = useMemo(() => {
    const map: Record<AdminView, { title: string; subtitle: string }> = {
      dashboard: { title: 'Dashboard', subtitle: 'Active organization overview and key stats' },
      members: { title: 'Members', subtitle: `${members.length} active member${members.length !== 1 ? 's' : ''}` },
      invites: { title: 'Pending Invites', subtitle: `${invites.filter((i) => i.status === 'pending').length} awaiting acceptance` },
      documents: { title: 'Documents', subtitle: `${documents.length} total document${documents.length !== 1 ? 's' : ''}` },
      versions: { title: 'Version History', subtitle: `Count from ${adminInsights.versionSampleCount} sampled docs` },
      usage: { title: 'Usage & Limits', subtitle: 'AI, storage, and seat utilization overview' },
      licenses: { title: 'Licenses', subtitle: 'Seat licenses, assignment, and availability' },
      billing: { title: 'Billing', subtitle: 'Calculator, invoices, and spend to date' },
      audit: { title: 'Audit Console', subtitle: 'Login, access, and permission change events' },
      enterpriseSecurity: { title: 'Enterprise Security', subtitle: 'SSO, domain mapping, policy, and access controls' },
      fileRepository: { title: 'File Repository', subtitle: 'Repository source and storage synchronization settings' },
    };
    return map[activeView];
  }, [activeView, adminInsights.versionSampleCount, documents.length, invites, members.length]);

  const activeOrganization = useMemo(
    () => organizations.find((org) => org.id === currentOrganizationId) ?? null,
    [currentOrganizationId, organizations],
  );

  const filteredMembers = useMemo(
    () =>
      members.filter((member) => {
        const billingLabel = member.billingAdmin ? 'yes' : 'no';
        return (
          contains(`${member.name} ${member.email}`, memberFilters.member) &&
          contains(member.role, memberFilters.role) &&
          contains(billingLabel, memberFilters.billing)
        );
      }),
    [memberFilters.billing, memberFilters.member, memberFilters.role, members],
  );

  const filteredInvites = useMemo(
    () =>
      invites.filter((invite) => {
        const expires = formatDate(invite.expiresAt);
        const billingLabel = invite.billingAdmin ? 'yes' : 'no';
        return (
          contains(invite.email, inviteFilters.email) &&
          contains(invite.role, inviteFilters.role) &&
          contains(billingLabel, inviteFilters.billing) &&
          contains(expires, inviteFilters.expires) &&
          contains(invite.status, inviteFilters.status)
        );
      }),
    [inviteFilters.billing, inviteFilters.email, inviteFilters.expires, inviteFilters.role, inviteFilters.status, invites],
  );

  const filteredDocuments = useMemo(
    () =>
      documents.filter((doc) => {
        const updated = formatDate(doc.updatedAt);
        return (
          contains(doc.title, documentFilters.title) &&
          contains(doc.preview || 'No preview available', documentFilters.preview) &&
          contains(updated, documentFilters.updated)
        );
      }),
    [documentFilters.preview, documentFilters.title, documentFilters.updated, documents],
  );

  const filteredVersionActivity = useMemo(
    () =>
      versionActivity.filter((row) => {
        const lastSaved = row.lastSavedAt ? formatDate(row.lastSavedAt) : 'Not saved yet';
        return (
          contains(row.docTitle, versionFilters.document) &&
          contains(row.count, versionFilters.versions) &&
          contains(lastSaved, versionFilters.lastSaved)
        );
      }),
    [versionActivity, versionFilters.document, versionFilters.lastSaved, versionFilters.versions],
  );

  const selectedBillingPlan = useMemo(
    () => billingPlans.find((plan) => plan.id === billingPlanId) ?? null,
    [billingPlanId, billingPlans],
  );

  const estimatedBillingCents = useMemo(() => {
    if (!selectedBillingPlan) return 0;
    return selectedBillingPlan.priceMonthlyCents * Math.max(1, billingSeats) * Math.max(1, billingMonths);
  }, [billingMonths, billingSeats, selectedBillingPlan]);

  const paidToDateCents = useMemo(
    () => billingInvoices.filter((invoice) => invoice.status === 'paid').reduce((sum, invoice) => sum + invoice.amountCents, 0),
    [billingInvoices],
  );

  const billedToDateCents = useMemo(
    () => billingInvoices.filter((invoice) => invoice.status !== 'void').reduce((sum, invoice) => sum + invoice.amountCents, 0),
    [billingInvoices],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setStatsLoading(true);
    setError('');

    try {
      const [
        { organizations: orgs, currentOrganizationId: selectedOrgId },
        currentOrg,
        membersRes,
        invitesRes,
        docsRes,
        entitlementsRes,
      ] = await Promise.all([
        organizationsApi.mine(token),
        organizationsApi.current(token),
        organizationsApi.listMembers(token),
        organizationsApi.listInvites(token),
        docsApi.list(token),
        organizationsApi.entitlements(token),
      ]);

      setOrganizations(orgs);
      setCurrentOrganizationId(selectedOrgId || currentOrg.organization.id);
      setMembership(currentOrg.membership);
      setMembers(membersRes.members);
      setInvites(invitesRes.invites);
      setMemberDrafts(
        membersRes.members.reduce<MemberDrafts>((acc, member) => {
          acc[member.id] = { role: member.role, billingAdmin: member.billingAdmin };
          return acc;
        }, {}),
      );

      const docs = docsRes.docs;
      setDocuments(
        docs
          .map((doc) => ({
            id: doc.id,
            title: doc.title || 'Untitled',
            preview: doc.preview || '',
            updatedAt: doc.updatedAt,
          }))
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
      );
      const versionSampleDocs = docs.slice(0, 25);
      const versionRows = await Promise.all(
        versionSampleDocs.map(async (doc) => {
          try {
            const { versions } = await versionsApi.list(token, doc.id);
            return {
              docId: doc.id,
              docTitle: doc.title || 'Untitled',
              count: versions.length,
              lastSavedAt: versions[0]?.savedAt ?? null,
            };
          } catch {
            return {
              docId: doc.id,
              docTitle: doc.title || 'Untitled',
              count: 0,
              lastSavedAt: null,
            };
          }
        }),
      );
      setVersionActivity(
        versionRows.sort((a, b) => {
          const aTs = a.lastSavedAt ? new Date(a.lastSavedAt).getTime() : 0;
          const bTs = b.lastSavedAt ? new Date(b.lastSavedAt).getTime() : 0;
          return bTs - aTs;
        }),
      );
      const sampledVersionTotal = versionRows.reduce((sum, row) => sum + row.count, 0);
      const entitlements = entitlementsRes.entitlements;

      setAdminInsights({
        documents: docs.length,
        versionHistory: sampledVersionTotal,
        versionSampleCount: versionSampleDocs.length,
        aiUsed: entitlements.usage.aiRequests,
        aiLimit: entitlements.limits.aiRequestsPerMonth,
        storageUsed: entitlements.usage.storageUsedBytes,
        storageLimit: entitlements.limits.storageBytes,
        assignedSeats: entitlements.usage.assignedSeats,
        purchasedSeats: entitlements.limits.seatsPurchased,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load organization administration data.');
    } finally {
      setLoading(false);
      setStatsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadSecurity = useCallback(async () => {
    setSecurityLoading(true);
    setError('');
    try {
      const { security: next } = await organizationsApi.getSecurity(token);
      setSecurity(next);
      setRequireMfa(next.requireMfa);
      setSessionDurationHours(next.sessionDurationHours);
      setIpAllowlistEnabled(next.ipAllowlistEnabled);
      setIpAllowlistText(next.ipAllowlist.join('\n'));
      setDomainText(next.domainMappings.join('\n'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load enterprise security settings.');
    } finally {
      setSecurityLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (activeView !== 'enterpriseSecurity') return;
    void loadSecurity();
  }, [activeView, loadSecurity]);

  const loadBilling = useCallback(async () => {
    setBillingLoading(true);
    setBillingError('');
    try {
      const [plansRes, currentRes, invoicesRes] = await Promise.all([
        billingApi.plans(token),
        billingApi.current(token),
        billingApi.invoices(token),
      ]);
      setBillingPlans(plansRes.plans);
      setBillingSnapshot(currentRes.snapshot);
      setBillingInvoices(invoicesRes.invoices);
      setBillingPlanId(currentRes.snapshot.billing.planId || 'free');
      setBillingSeats(Math.max(1, currentRes.snapshot.limits.seatsPurchased || 1));
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : 'Failed to load billing information.');
    } finally {
      setBillingLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (activeView !== 'billing') return;
    void loadBilling();
  }, [activeView, loadBilling]);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    setBillingError('');
    try {
      const { logs } = await organizationsApi.getOrganizationAuditLogs(token, {
        action: auditActionFilter || undefined,
        status: auditStatusFilter || undefined,
        limit: auditLimit,
      });
      setAuditLogs(logs);
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : 'Failed to load audit logs.');
    } finally {
      setAuditLoading(false);
    }
  }, [auditActionFilter, auditLimit, auditStatusFilter, token]);

  useEffect(() => {
    if (activeView !== 'audit') return;
    void loadAudit();
  }, [activeView, loadAudit]);

  async function exportAuditCsv() {
    setMessage('');
    setError('');
    try {
      const csv = await organizationsApi.exportOrganizationAuditCsv(token, {
        action: auditActionFilter || undefined,
        status: auditStatusFilter || undefined,
        limit: auditLimit,
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'organization-audit-logs.csv';
      link.click();
      window.URL.revokeObjectURL(url);
      setMessage('Audit CSV exported.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export audit logs.');
    }
  }

  async function handleSwitchOrganization(nextOrganizationId: string) {
    setMessage('');
    setError('');
    try {
      await organizationsApi.switchContext(token, nextOrganizationId);
      setCurrentOrganizationId(nextOrganizationId);
      await load();
      setMessage('Organization context updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch organization context.');
    }
  }

  async function handleSaveMember(memberId: string) {
    const draft = memberDrafts[memberId];
    if (!draft) return;

    setMessage('');
    setError('');
    try {
      const { member } = await organizationsApi.updateMember(token, memberId, {
        role: draft.role,
        billingAdmin: draft.billingAdmin,
      });
      setMembers((prev) => prev.map((item) => (item.id === member.id ? member : item)));
      setMessage('Member updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update member.');
    }
  }

  async function handleRemoveMember(memberId: string) {
    setMessage('');
    setError('');
    try {
      await organizationsApi.removeMember(token, memberId);
      setMembers((prev) => prev.filter((member) => member.id !== memberId));
      setMemberDrafts((prev) => {
        const next = { ...prev };
        delete next[memberId];
        return next;
      });
      setMessage('Member removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member.');
    }
  }

  async function handleInviteMember() {
    const email = inviteDraft.email.trim().toLowerCase();
    if (!email) {
      setError('Invite email is required.');
      return;
    }

    setMessage('');
    setError('');
    try {
      const { invite } = await organizationsApi.inviteMember(token, {
        email,
        role: inviteDraft.role,
      });
      setInvites((prev) => [invite, ...prev]);
      setInviteDraft({ email: '', role: 'viewer' });
      setMessage('Invite sent.');
      setActiveView('invites');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite member.');
    }
  }

  async function saveSecurityPolicies() {
    setMessage('');
    setError('');
    try {
      const ips = ipAllowlistText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const { security: next } = await organizationsApi.updateSecurityPolicies(token, {
        requireMfa,
        sessionDurationHours,
        ipAllowlistEnabled,
        ipAllowlist: ips,
      });
      setSecurity(next);
      setMessage('Security policies saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save security policies.');
    }
  }

  async function saveSecurityDomains() {
    setMessage('');
    setError('');
    try {
      const domains = domainText
        .split('\n')
        .map((line) => line.trim().replace(/^@+/, '').toLowerCase())
        .filter(Boolean);
      await organizationsApi.updateSecurityDomains(token, domains);
      await loadSecurity();
      setMessage('Domain mappings updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update domain mappings.');
    }
  }

  async function addSecurityProvider() {
    setMessage('');
    setError('');
    try {
      await organizationsApi.createSsoProvider(token, providerDraft);
      setProviderDraft(EMPTY_PROVIDER);
      await loadSecurity();
      setMessage('SSO provider created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create SSO provider.');
    }
  }

  async function toggleSecurityProvider(provider: SsoProvider) {
    setMessage('');
    setError('');
    try {
      await organizationsApi.updateSsoProvider(token, provider.id, { enabled: !provider.enabled });
      await loadSecurity();
      setMessage('SSO provider updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update SSO provider.');
    }
  }

  async function deleteSecurityProvider(providerId: string) {
    setMessage('');
    setError('');
    try {
      await organizationsApi.removeSsoProvider(token, providerId);
      await loadSecurity();
      setMessage('SSO provider removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove SSO provider.');
    }
  }

  async function runSecuritySimulation() {
    setMessage('');
    setError('');
    setSimulateResult('');
    try {
      const result = await organizationsApi.simulateSsoLogin(token, simulateEmail.trim().toLowerCase());
      setSimulateResult(
        `Org: ${result.organization.name} | Provider: ${result.provider.name} (${result.provider.type}) | Membership: ${result.membershipStatus || 'none'}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run domain routing simulation.');
    }
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-cyan-50 via-sky-50 to-slate-100 text-slate-800">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex w-full items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-none bg-cyan-600">
              <span className="material-icons text-white" style={{ fontSize: '1.2rem' }}>admin_panel_settings</span>
            </div>
            <div>
              <p className="text-lg font-black tracking-tight text-cyan-700">DocSync Admin</p>
              <p className="text-xs text-slate-500">Organization control center</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden text-xs text-slate-500 sm:block">
              Signed in as <span className="font-semibold text-slate-700">{userName}</span>
            </span>
            <button
              type="button"
              onClick={onAdminLogout}
              className="inline-flex items-center gap-1.5 rounded-none border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:border-red-300 hover:bg-red-50 hover:text-red-600"
            >
              <span className="material-icons" style={{ fontSize: '0.9rem' }}>logout</span>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="min-h-[calc(100vh-73px)] w-full bg-stone-50">
        {message && (
          <div className="mb-4 flex items-center gap-2 rounded-none bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <span className="material-icons shrink-0" style={{ fontSize: '1rem' }}>check_circle</span>
            {message}
          </div>
        )}
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-none bg-red-50 px-4 py-3 text-sm text-red-700">
            <span className="material-icons shrink-0" style={{ fontSize: '1rem' }}>error_outline</span>
            {error}
          </div>
        )}

        <section className="grid min-h-[calc(100vh-73px)] gap-0 lg:grid-cols-12">
          <div className="lg:col-span-2 lg:sticky lg:top-18.25 lg:self-start lg:h-[calc(100vh-73px)]">
            <article className="flex h-full min-h-[calc(100vh-73px)] flex-col overflow-hidden rounded-none border-r border-slate-200 bg-white py-3 pr-3 pl-4 sm:pl-6 lg:pl-8">
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center gap-2.5">
                  <span className="material-icons text-cyan-700" style={{ fontSize: '1rem' }}>admin_panel_settings</span>
                  <h2 className="text-sm font-black text-slate-900">Admin Menu</h2>
                </div>
                {statsLoading && <span className="text-xs font-semibold text-slate-400">Loading...</span>}
              </div>
              <p className="mt-1 text-xs text-slate-500">Choose a panel to view organization data.</p>

              <nav className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1" aria-label="Admin sections">
                {menuSections.map((section) => (
                  <div key={section.title}>
                    <p
                      className={`mb-1 text-xs font-bold uppercase tracking-[0.16em] ${
                        section.title === 'Maintainace'
                          ? 'text-cyan-700'
                          : section.title === 'Configuration'
                            ? 'text-violet-700'
                            : section.title === 'Management'
                              ? 'text-emerald-700'
                              : 'text-amber-700'
                      }`}
                    >
                      {section.title}
                    </p>
                    <div className="space-y-1.5">
                      {section.items.map((item) => {
                        const isActive = activeView === item.key;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => setActiveView(item.key)}
                            className={`flex w-full items-center justify-between rounded-none border px-2.5 py-2 text-left transition ${
                              isActive
                                ? 'border-cyan-200 bg-cyan-50 text-cyan-800'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                              <span className="material-icons" style={{ fontSize: '1rem' }}>{item.icon}</span>
                              {item.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </nav>
            </article>
          </div>

          <section className="h-full overflow-hidden rounded-none border-l border-cyan-200 bg-slate-50 lg:col-span-10">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-black text-slate-900">{activeViewMeta.title}</h2>
                <p className="text-sm text-slate-500">{activeViewMeta.subtitle}</p>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12 text-sm text-slate-500">
                <span className="material-icons mr-2 animate-spin" style={{ fontSize: '1.1rem' }}>hourglass_empty</span>
                Loading members...
              </div>
            ) : (
              <>
                {activeView === 'dashboard' && (
                  <div className="space-y-4 p-6">
                    <section className="rounded-none border border-slate-200 bg-white p-5">
                      <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Active Organization</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                        <select
                          value={currentOrganizationId}
                          onChange={(e) => void handleSwitchOrganization(e.target.value)}
                          className="w-full rounded-none border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-500"
                        >
                          {organizations.map((org) => (
                            <option key={org.id} value={org.id}>{org.name}</option>
                          ))}
                        </select>
                        <span className={`inline-flex justify-center rounded-none px-3 py-1 text-xs font-bold ${ROLE_COLORS[membership?.role ?? ''] ?? 'bg-slate-100 text-slate-600'}`}>
                          {membership?.role ?? 'unknown'}
                        </span>
                        <span className={`inline-flex justify-center rounded-none px-3 py-1 text-xs font-bold ${membership?.billingAdmin ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                          {membership?.billingAdmin ? 'Billing Admin' : 'Standard Access'}
                        </span>
                      </div>
                    </section>

                    <section className="grid grid-cols-2 gap-3">
                      <div className="rounded-none border border-slate-200 bg-white px-4 py-4 text-center">
                        <p className="truncate text-base font-black text-slate-700">{activeOrganization?.name ?? 'Organization'}</p>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Active Org</p>
                        <p className="mt-2 text-xs text-slate-500">{members.length} member{members.length !== 1 ? 's' : ''}</p>
                      </div>
                      <div className="rounded-none border border-cyan-100 bg-cyan-50 px-4 py-4 text-center">
                        <p className="text-2xl font-black text-cyan-700">{members.length}</p>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-cyan-700/80">Members</p>
                      </div>
                      <div className="rounded-none border border-amber-100 bg-amber-50 px-4 py-4 text-center">
                        <p className="text-2xl font-black text-amber-700">{invites.filter((i) => i.status === 'pending').length}</p>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-amber-700/80">Pending</p>
                      </div>
                      <div className="rounded-none border border-slate-200 bg-white px-4 py-4 text-center">
                        <p className="text-2xl font-black text-slate-700">{organizations.length}</p>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Orgs</p>
                      </div>
                    </section>
                  </div>
                )}

                {activeView === 'members' && (
                  <div className="overflow-x-auto">
                    <div className="grid gap-2 border-b border-slate-200 bg-cyan-50/50 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                      <input
                        value={inviteDraft.email}
                        onChange={(e) => setInviteDraft((prev) => ({ ...prev, email: e.target.value }))}
                        placeholder="Invite by email"
                        disabled={!canManageMembers}
                        className="w-full rounded-none border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-cyan-500 disabled:bg-slate-100 disabled:text-slate-400"
                      />
                      <select
                        value={inviteDraft.role}
                        onChange={(e) => setInviteDraft((prev) => ({ ...prev, role: e.target.value as RoleValue }))}
                        disabled={!canManageMembers}
                        className="rounded-none border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-cyan-500 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleInviteMember()}
                        disabled={!canManageMembers}
                        className="rounded-none border border-cyan-200 bg-cyan-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Invite member
                      </button>
                    </div>
                    <div className="grid gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-3 sm:grid-cols-3">
                      <input
                        value={memberFilters.member}
                        onChange={(e) => setMemberFilters((prev) => ({ ...prev, member: e.target.value }))}
                        placeholder="Search member/email"
                        className="w-full rounded-none border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-cyan-500"
                      />
                      <input
                        value={memberFilters.role}
                        onChange={(e) => setMemberFilters((prev) => ({ ...prev, role: e.target.value }))}
                        placeholder="Search role"
                        className="w-full rounded-none border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-cyan-500"
                      />
                      <input
                        value={memberFilters.billing}
                        onChange={(e) => setMemberFilters((prev) => ({ ...prev, billing: e.target.value }))}
                        placeholder="Billing (yes/no)"
                        className="w-full rounded-none border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-cyan-500"
                      />
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left">
                          <th className="px-6 py-3 text-xs font-bold uppercase tracking-widest text-slate-500">Member</th>
                          <th className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-slate-500">Role</th>
                          <th className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-slate-500">Billing</th>
                          <th className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-slate-500">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredMembers.map((member) => {
                          const draft = memberDrafts[member.id] ?? { role: member.role, billingAdmin: member.billingAdmin };
                          const isOwner = member.role === 'owner';
                          const canEdit = canManageMembers && !(isOwner && membership?.userId !== member.userId);
                          return (
                            <tr key={member.id} className="transition-colors hover:bg-cyan-50/40">
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-none bg-cyan-100 text-xs font-black text-cyan-700">
                                    {initials(member.name)}
                                  </div>
                                  <div>
                                    <p className="font-semibold text-slate-800">{member.name}</p>
                                    <p className="text-xs text-slate-500">{member.email}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-4">
                                <select
                                  value={draft.role}
                                  onChange={(e) => {
                                    const role = e.target.value as RoleValue;
                                    setMemberDrafts((prev) => ({ ...prev, [member.id]: { ...draft, role } }));
                                  }}
                                  disabled={!canEdit}
                                  className="rounded-none border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-cyan-500 disabled:bg-slate-100 disabled:text-slate-400"
                                >
                                  {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                                </select>
                              </td>
                              <td className="px-4 py-4">
                                <label className="inline-flex cursor-pointer items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={draft.billingAdmin}
                                    onChange={(e) => {
                                      const billingAdmin = e.target.checked;
                                      setMemberDrafts((prev) => ({ ...prev, [member.id]: { ...draft, billingAdmin } }));
                                    }}
                                    disabled={!canEdit}
                                    className="h-4 w-4 rounded accent-cyan-500"
                                  />
                                  <span className="text-xs text-slate-600">Billing admin</span>
                                </label>
                              </td>
                              <td className="px-4 py-4">
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void handleSaveMember(member.id)}
                                    disabled={!canEdit}
                                    className="rounded-none border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-bold text-cyan-700 transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleRemoveMember(member.id)}
                                    disabled={!canManageMembers || isOwner}
                                    className="rounded-none border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {filteredMembers.length === 0 && (
                          <tr>
                            <td className="px-4 py-8 text-center text-sm text-slate-500" colSpan={4}>No members match these filters.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {activeView === 'invites' && (
                  invites.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-slate-400">
                      <span className="material-icons" style={{ fontSize: '1.8rem' }}>mark_email_read</span>
                      <p className="text-sm">No pending invites</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <div className="grid gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-3 sm:grid-cols-5">
                        <input
                          value={inviteFilters.email}
                          onChange={(e) => setInviteFilters((prev) => ({ ...prev, email: e.target.value }))}
                          placeholder="Search email"
                          className="w-full rounded-none border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-cyan-500"
                        />
                        <input
                          value={inviteFilters.role}
                          onChange={(e) => setInviteFilters((prev) => ({ ...prev, role: e.target.value }))}
                          placeholder="Search role"
                          className="w-full rounded-none border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-cyan-500"
                        />
                        <input
                          value={inviteFilters.billing}
                          onChange={(e) => setInviteFilters((prev) => ({ ...prev, billing: e.target.value }))}
                          placeholder="Billing (yes/no)"
                          className="w-full rounded-none border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-cyan-500"
                        />
                        <input
                          value={inviteFilters.expires}
                          onChange={(e) => setInviteFilters((prev) => ({ ...prev, expires: e.target.value }))}
                          placeholder="Search expiry"
                          className="w-full rounded-none border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-cyan-500"
                        />
                        <input
                          value={inviteFilters.status}
                          onChange={(e) => setInviteFilters((prev) => ({ ...prev, status: e.target.value }))}
                          placeholder="Search status"
                          className="w-full rounded-none border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-cyan-500"
                        />
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left">
                            <th className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-slate-500">Email</th>
                            <th className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-slate-500">Role</th>
                            <th className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-slate-500">Billing</th>
                            <th className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-slate-500">Expires</th>
                            <th className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-slate-500">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredInvites.map((invite) => (
                            <tr key={invite.id} className="align-top hover:bg-slate-50">
                              <td className="px-4 py-3 font-medium text-slate-800">{invite.email}</td>
                              <td className="px-4 py-3">
                                <span className={`rounded-none px-2 py-0.5 text-xs font-bold ${ROLE_COLORS[invite.role] ?? 'bg-slate-100 text-slate-600'}`}>
                                  {invite.role}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-xs text-slate-600">{invite.billingAdmin ? 'Yes' : 'No'}</td>
                              <td className="px-4 py-3 text-xs text-slate-600">{formatDate(invite.expiresAt)}</td>
                              <td className="px-4 py-3">
                                <span className="rounded-none bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">{invite.status}</span>
                              </td>
                            </tr>
                          ))}
                          {filteredInvites.length === 0 && (
                            <tr>
                              <td className="px-4 py-8 text-center text-sm text-slate-500" colSpan={5}>No invites match these filters.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )
                )}

                {activeView === 'documents' && (
                  documents.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-slate-400">
                      <span className="material-icons" style={{ fontSize: '1.8rem' }}>description</span>
                      <p className="text-sm">No documents found</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <div className="grid gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-3 sm:grid-cols-3">
                        <input
                          value={documentFilters.title}
                          onChange={(e) => setDocumentFilters((prev) => ({ ...prev, title: e.target.value }))}
                          placeholder="Search title"
                          className="w-full rounded-none border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-cyan-500"
                        />
                        <input
                          value={documentFilters.preview}
                          onChange={(e) => setDocumentFilters((prev) => ({ ...prev, preview: e.target.value }))}
                          placeholder="Search preview"
                          className="w-full rounded-none border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-cyan-500"
                        />
                        <input
                          value={documentFilters.updated}
                          onChange={(e) => setDocumentFilters((prev) => ({ ...prev, updated: e.target.value }))}
                          placeholder="Search updated"
                          className="w-full rounded-none border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-cyan-500"
                        />
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left">
                            <th className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-slate-500">Title</th>
                            <th className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-slate-500">Preview</th>
                            <th className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-slate-500">Updated</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredDocuments.map((doc) => (
                            <tr key={doc.id} className="align-top hover:bg-slate-50">
                              <td className="px-4 py-3 font-medium text-slate-800">{doc.title}</td>
                              <td className="px-4 py-3 text-xs text-slate-600">{doc.preview || 'No preview available'}</td>
                              <td className="px-4 py-3 text-xs text-slate-600">{formatDate(doc.updatedAt)}</td>
                            </tr>
                          ))}
                          {filteredDocuments.length === 0 && (
                            <tr>
                              <td className="px-4 py-8 text-center text-sm text-slate-500" colSpan={3}>No documents match these filters.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )
                )}

                {activeView === 'versions' && (
                  versionActivity.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-slate-400">
                      <span className="material-icons" style={{ fontSize: '1.8rem' }}>history</span>
                      <p className="text-sm">No version activity available</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <div className="grid gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-3 sm:grid-cols-3">
                        <input
                          value={versionFilters.document}
                          onChange={(e) => setVersionFilters((prev) => ({ ...prev, document: e.target.value }))}
                          placeholder="Search document"
                          className="w-full rounded-none border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-cyan-500"
                        />
                        <input
                          value={versionFilters.versions}
                          onChange={(e) => setVersionFilters((prev) => ({ ...prev, versions: e.target.value }))}
                          placeholder="Search count"
                          className="w-full rounded-none border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-cyan-500"
                        />
                        <input
                          value={versionFilters.lastSaved}
                          onChange={(e) => setVersionFilters((prev) => ({ ...prev, lastSaved: e.target.value }))}
                          placeholder="Search last saved"
                          className="w-full rounded-none border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-cyan-500"
                        />
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left">
                            <th className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-slate-500">Document</th>
                            <th className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-slate-500">Saved Versions</th>
                            <th className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-slate-500">Last Saved</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredVersionActivity.map((row) => (
                            <tr key={row.docId} className="align-top hover:bg-slate-50">
                              <td className="px-4 py-3 font-medium text-slate-800">{row.docTitle}</td>
                              <td className="px-4 py-3 text-xs text-slate-600">{row.count}</td>
                              <td className="px-4 py-3 text-xs text-slate-600">{row.lastSavedAt ? formatDate(row.lastSavedAt) : 'Not saved yet'}</td>
                            </tr>
                          ))}
                          {filteredVersionActivity.length === 0 && (
                            <tr>
                              <td className="px-4 py-8 text-center text-sm text-slate-500" colSpan={3}>No versions match these filters.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )
                )}

                {activeView === 'usage' && (
                  <div className="grid gap-4 p-6 sm:grid-cols-2">
                    <div className="rounded-none border border-slate-200 bg-slate-50 p-4">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">AI Usage</p>
                      <p className="mt-1 text-xl font-black text-slate-800">{adminInsights.aiUsed}/{adminInsights.aiLimit || 0}</p>
                      <div className="mt-2 h-2 overflow-hidden rounded-none bg-slate-200">
                        <div className="h-full rounded-none bg-cyan-500" style={{ width: `${aiUsagePct}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{aiUsagePct}% monthly quota used</p>
                    </div>

                    <div className="rounded-none border border-slate-200 bg-slate-50 p-4">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Storage</p>
                      <p className="mt-1 text-xl font-black text-slate-800">{formatBytes(adminInsights.storageUsed)} / {formatBytes(adminInsights.storageLimit)}</p>
                      <div className="mt-2 h-2 overflow-hidden rounded-none bg-slate-200">
                        <div className="h-full rounded-none bg-blue-500" style={{ width: `${storageUsagePct}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{storageUsagePct}% used</p>
                    </div>

                    <div className="rounded-none border border-slate-200 bg-slate-50 p-4 sm:col-span-2">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Seat Utilization</p>
                      <p className="mt-1 text-xl font-black text-slate-800">{adminInsights.assignedSeats}/{adminInsights.purchasedSeats || 0}</p>
                      <div className="mt-2 h-2 overflow-hidden rounded-none bg-slate-200">
                        <div className="h-full rounded-none bg-emerald-500" style={{ width: `${seatUsagePct}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{seatUsagePct}% seats assigned</p>
                    </div>
                  </div>
                )}

                {activeView === 'licenses' && (
                  <div className="grid gap-4 p-6 sm:grid-cols-2">
                    <div className="rounded-none border border-slate-200 bg-slate-50 p-4">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Purchased Seats</p>
                      <p className="mt-1 text-xl font-black text-slate-800">{adminInsights.purchasedSeats || 0}</p>
                      <p className="mt-1 text-xs text-slate-500">Total seat licenses purchased for this organization.</p>
                    </div>

                    <div className="rounded-none border border-slate-200 bg-slate-50 p-4">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Assigned Seats</p>
                      <p className="mt-1 text-xl font-black text-slate-800">{adminInsights.assignedSeats || 0}</p>
                      <p className="mt-1 text-xs text-slate-500">Seats currently allocated to members.</p>
                    </div>

                    <div className="rounded-none border border-slate-200 bg-slate-50 p-4">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Available Seats</p>
                      <p className="mt-1 text-xl font-black text-slate-800">{Math.max(0, (adminInsights.purchasedSeats || 0) - (adminInsights.assignedSeats || 0))}</p>
                      <p className="mt-1 text-xs text-slate-500">Remaining seats available for assignment.</p>
                    </div>

                    <div className="rounded-none border border-slate-200 bg-slate-50 p-4">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Utilization</p>
                      <p className="mt-1 text-xl font-black text-slate-800">{seatUsagePct}%</p>
                      <div className="mt-2 h-2 overflow-hidden rounded-none bg-slate-200">
                        <div className="h-full rounded-none bg-emerald-500" style={{ width: `${seatUsagePct}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">Percentage of purchased licenses in active use.</p>
                    </div>
                  </div>
                )}

                {activeView === 'billing' && (
                  <div className="space-y-4 p-6">
                    {billingError ? (
                      <div className="rounded-none border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {billingError}
                      </div>
                    ) : null}

                    <section className="grid gap-4 sm:grid-cols-3">
                      <div className="rounded-none border border-slate-200 bg-white p-4">
                        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Money Till Date (Paid)</p>
                        <p className="mt-1 text-2xl font-black text-emerald-700">{formatCurrency(paidToDateCents)}</p>
                      </div>
                      <div className="rounded-none border border-slate-200 bg-white p-4">
                        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Total Billed</p>
                        <p className="mt-1 text-2xl font-black text-slate-800">{formatCurrency(billedToDateCents)}</p>
                      </div>
                      <div className="rounded-none border border-slate-200 bg-white p-4">
                        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Current Plan</p>
                        <p className="mt-1 text-2xl font-black text-cyan-700">{billingSnapshot?.plan.name || 'N/A'}</p>
                        <p className="mt-1 text-xs text-slate-500">Status: {billingSnapshot?.billing.status || 'unknown'}</p>
                      </div>
                    </section>

                    <section className="rounded-none border border-slate-200 bg-white p-5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Billing Calculator</p>
                        <button type="button" onClick={() => void loadBilling()} className="rounded-none border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700">
                          {billingLoading ? 'Refreshing...' : 'Refresh'}
                        </button>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-4">
                        <select
                          value={billingPlanId}
                          onChange={(event) => setBillingPlanId(event.target.value)}
                          className="rounded-none border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                        >
                          {billingPlans.map((plan) => (
                            <option key={plan.id} value={plan.id}>{plan.name}</option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={1}
                          value={billingSeats}
                          onChange={(event) => setBillingSeats(Math.max(1, Number(event.target.value) || 1))}
                          className="rounded-none border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                          placeholder="Seats"
                        />
                        <input
                          type="number"
                          min={1}
                          value={billingMonths}
                          onChange={(event) => setBillingMonths(Math.max(1, Number(event.target.value) || 1))}
                          className="rounded-none border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                          placeholder="Months"
                        />
                        <div className="rounded-none border border-cyan-200 bg-cyan-50 px-3 py-2">
                          <p className="text-[11px] uppercase tracking-widest text-cyan-700">Estimated Total</p>
                          <p className="text-lg font-black text-cyan-800">{formatCurrency(estimatedBillingCents)}</p>
                        </div>
                      </div>
                    </section>

                    <section className="rounded-none border border-slate-200 bg-white p-5">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Bills Invoice</p>
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 text-left">
                              <th className="px-3 py-2 text-xs font-bold uppercase tracking-widest text-slate-500">Invoice</th>
                              <th className="px-3 py-2 text-xs font-bold uppercase tracking-widest text-slate-500">Status</th>
                              <th className="px-3 py-2 text-xs font-bold uppercase tracking-widest text-slate-500">Amount</th>
                              <th className="px-3 py-2 text-xs font-bold uppercase tracking-widest text-slate-500">Issued</th>
                              <th className="px-3 py-2 text-xs font-bold uppercase tracking-widest text-slate-500">Paid</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {billingInvoices.map((invoice) => (
                              <tr key={invoice.id} className="hover:bg-slate-50">
                                <td className="px-3 py-2 font-mono text-xs text-slate-700">{invoice.id}</td>
                                <td className="px-3 py-2 text-xs font-semibold uppercase text-slate-700">{invoice.status}</td>
                                <td className="px-3 py-2 text-xs text-slate-700">{formatCurrency(invoice.amountCents, invoice.currency.toUpperCase())}</td>
                                <td className="px-3 py-2 text-xs text-slate-600">{formatDate(invoice.issuedAt)}</td>
                                <td className="px-3 py-2 text-xs text-slate-600">{invoice.paidAt ? formatDate(invoice.paidAt) : 'N/A'}</td>
                              </tr>
                            ))}
                            {!billingInvoices.length && !billingLoading ? (
                              <tr>
                                <td className="px-3 py-6 text-center text-sm text-slate-500" colSpan={5}>No invoices yet.</td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </div>
                )}

                {activeView === 'audit' && (
                  <div className="space-y-4 p-6">
                    <section className="rounded-none border border-slate-200 bg-white p-5">
                      <div className="grid gap-3 md:grid-cols-[1.5fr,1fr,140px,auto,auto] md:items-end">
                        <input
                          value={auditActionFilter}
                          onChange={(event) => setAuditActionFilter(event.target.value)}
                          placeholder="Action filter (e.g. organization.member.role.update)"
                          className="w-full rounded-none border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                        />
                        <input
                          value={auditStatusFilter}
                          onChange={(event) => setAuditStatusFilter(event.target.value)}
                          placeholder="Status (e.g. success)"
                          className="w-full rounded-none border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                        />
                        <input
                          type="number"
                          min={1}
                          max={1000}
                          value={auditLimit}
                          onChange={(event) => setAuditLimit(Math.max(1, Math.min(1000, Number(event.target.value) || 200)))}
                          className="w-full rounded-none border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                        />
                        <button type="button" onClick={() => void loadAudit()} className="rounded-none border border-cyan-200 px-4 py-2 text-sm font-bold text-cyan-700">
                          {auditLoading ? 'Loading...' : 'Apply filters'}
                        </button>
                        <button type="button" onClick={() => void exportAuditCsv()} className="rounded-none bg-cyan-600 px-4 py-2 text-sm font-bold text-white">
                          Export CSV
                        </button>
                      </div>
                    </section>

                    <section className="rounded-none border border-slate-200 bg-white p-5">
                      {auditLoading ? (
                        <p className="text-sm text-slate-500">Loading audit logs...</p>
                      ) : auditLogs.length === 0 ? (
                        <p className="text-sm text-slate-500">No audit logs found for the current filters.</p>
                      ) : (
                        <div className="space-y-3">
                          {auditLogs.map((entry) => (
                            <article key={entry.id} className="rounded-none border border-slate-200 p-4">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-slate-900">{entry.action}</p>
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{entry.status}</p>
                              </div>
                              <p className="mt-1 text-xs text-slate-500">{formatDate(entry.createdAt)} • Actor {entry.userId}</p>
                              {entry.metadata ? (
                                <pre className="mt-3 overflow-x-auto rounded-none bg-slate-50 p-3 text-xs text-slate-700">{JSON.stringify(entry.metadata, null, 2)}</pre>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                )}

                {activeView === 'enterpriseSecurity' && (
                  <div className="space-y-4 p-6">
                    {securityLoading ? <p className="text-sm text-slate-500">Loading enterprise security settings...</p> : null}

                    <section className="rounded-none border border-slate-200 bg-white p-5">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Access Policies</p>
                      <div className="mt-4 space-y-4">
                        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                          <input type="checkbox" checked={requireMfa} onChange={(event) => setRequireMfa(event.target.checked)} />
                          Require MFA for all organization users
                        </label>

                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Session duration (hours)</p>
                          <input
                            type="number"
                            min={1}
                            max={24}
                            value={sessionDurationHours}
                            onChange={(event) => setSessionDurationHours(Number(event.target.value))}
                            className="mt-2 w-36 rounded-none border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                          />
                        </div>

                        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                          <input type="checkbox" checked={ipAllowlistEnabled} onChange={(event) => setIpAllowlistEnabled(event.target.checked)} />
                          Enable IP allowlist
                        </label>

                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Allowed IPs (one per line)</p>
                          <textarea
                            rows={4}
                            value={ipAllowlistText}
                            onChange={(event) => setIpAllowlistText(event.target.value)}
                            className="mt-2 w-full rounded-none border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                          />
                        </div>

                        <button type="button" onClick={() => void saveSecurityPolicies()} className="rounded-none bg-cyan-600 px-4 py-2 text-sm font-bold text-white">
                          Save policies
                        </button>
                      </div>
                    </section>

                    <section className="rounded-none border border-slate-200 bg-white p-5">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Domain Mapping</p>
                      <p className="mt-2 text-sm text-slate-600">Users registering with mapped domains can be attached to this organization.</p>
                      <textarea
                        rows={4}
                        value={domainText}
                        onChange={(event) => setDomainText(event.target.value)}
                        className="mt-3 w-full rounded-none border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                      />
                      <button type="button" onClick={() => void saveSecurityDomains()} className="mt-3 rounded-none border border-cyan-200 px-4 py-2 text-sm font-bold text-cyan-700">
                        Save domain mappings
                      </button>
                    </section>

                    <section className="rounded-none border border-slate-200 bg-white p-5">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">SSO Providers</p>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <input placeholder="Provider name" value={providerDraft.name} onChange={(event) => setProviderDraft((prev) => ({ ...prev, name: event.target.value }))} className="rounded-none border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
                        <select value={providerDraft.type} onChange={(event) => setProviderDraft((prev) => ({ ...prev, type: event.target.value as 'oidc' | 'saml' | 'ldap' }))} className="rounded-none border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500">
                          <option value="oidc">OIDC</option>
                          <option value="saml">SAML</option>
                          <option value="ldap">LDAP</option>
                        </select>
                        <input placeholder="Issuer URL (OIDC)" value={providerDraft.issuerUrl} onChange={(event) => setProviderDraft((prev) => ({ ...prev, issuerUrl: event.target.value }))} className="rounded-none border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
                        <input placeholder="SSO URL (SAML)" value={providerDraft.ssoUrl} onChange={(event) => setProviderDraft((prev) => ({ ...prev, ssoUrl: event.target.value }))} className="rounded-none border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
                        <input placeholder="Client ID" value={providerDraft.clientId} onChange={(event) => setProviderDraft((prev) => ({ ...prev, clientId: event.target.value }))} className="rounded-none border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
                        <input placeholder="Client Secret" value={providerDraft.clientSecret} onChange={(event) => setProviderDraft((prev) => ({ ...prev, clientSecret: event.target.value }))} className="rounded-none border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
                      </div>
                      <textarea
                        rows={3}
                        placeholder="SAML certificate (optional)"
                        value={providerDraft.certificate}
                        onChange={(event) => setProviderDraft((prev) => ({ ...prev, certificate: event.target.value }))}
                        className="mt-3 w-full rounded-none border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                      />
                      <button type="button" onClick={() => void addSecurityProvider()} className="mt-3 rounded-none bg-cyan-600 px-4 py-2 text-sm font-bold text-white">
                        Add provider
                      </button>

                      <div className="mt-4 space-y-3">
                        {security?.ssoProviders.map((provider) => (
                          <article key={provider.id} className="rounded-none border border-slate-200 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-slate-900">{provider.name}</p>
                                <p className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">{provider.type}</p>
                              </div>
                              <div className="flex gap-2">
                                <button type="button" onClick={() => void toggleSecurityProvider(provider)} className="rounded-none border border-cyan-200 px-3 py-1 text-xs font-semibold text-cyan-700">
                                  {provider.enabled ? 'Disable' : 'Enable'}
                                </button>
                                <button type="button" onClick={() => void deleteSecurityProvider(provider.id)} className="rounded-none border border-red-200 px-3 py-1 text-xs font-semibold text-red-600">
                                  Delete
                                </button>
                              </div>
                            </div>
                          </article>
                        ))}
                        {!security?.ssoProviders.length && !securityLoading ? (
                          <p className="text-xs text-slate-500">No SSO providers configured yet.</p>
                        ) : null}
                      </div>
                    </section>

                    <section className="rounded-none border border-slate-200 bg-white p-5">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Domain Routing Simulation</p>
                      <div className="mt-3 flex flex-wrap gap-3">
                        <input
                          value={simulateEmail}
                          onChange={(event) => setSimulateEmail(event.target.value)}
                          placeholder="employee@company.com"
                          className="w-full rounded-none border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500 md:max-w-md"
                        />
                        <button type="button" onClick={() => void runSecuritySimulation()} className="rounded-none border border-cyan-200 px-4 py-2 text-sm font-bold text-cyan-700">
                          Simulate login mapping
                        </button>
                      </div>
                      {simulateResult ? <p className="mt-3 text-sm text-slate-700">{simulateResult}</p> : null}
                    </section>
                  </div>
                )}

                {activeView === 'fileRepository' && (
                  <div className="grid gap-4 p-6 sm:grid-cols-2">
                    <div className="rounded-none border border-slate-200 bg-slate-50 p-4">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Repository Source</p>
                      <p className="mt-1 text-sm font-semibold text-slate-800">Local Store</p>
                      <p className="mt-2 text-xs text-slate-600">Current storage is managed by internal document services.</p>
                    </div>
                    <div className="rounded-none border border-slate-200 bg-slate-50 p-4">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Sync Status</p>
                      <p className="mt-1 text-sm font-semibold text-slate-800">Healthy</p>
                      <p className="mt-2 text-xs text-slate-600">No pending sync or repository consistency warnings.</p>
                    </div>
                    <div className="rounded-none border border-slate-200 bg-white p-4 sm:col-span-2">
                      <p className="text-xs text-slate-600">
                        Add support here for S3, SharePoint, or on-prem file repositories if you want external repository connectors.
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </section>

      </main>
    </div>
  );
}
