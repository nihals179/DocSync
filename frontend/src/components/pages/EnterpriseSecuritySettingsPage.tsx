import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { organizationsApi, type OrganizationSecurityState, type SsoProvider } from '../../lib/api';

interface EnterpriseSecuritySettingsPageProps {
  token: string;
  userName: string;
}

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

export default function EnterpriseSecuritySettingsPage({ token, userName }: EnterpriseSecuritySettingsPageProps) {
  const [security, setSecurity] = useState<OrganizationSecurityState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [requireMfa, setRequireMfa] = useState(false);
  const [sessionDurationHours, setSessionDurationHours] = useState(8);
  const [ipAllowlistEnabled, setIpAllowlistEnabled] = useState(false);
  const [ipAllowlistText, setIpAllowlistText] = useState('');
  const [domainText, setDomainText] = useState('');
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(EMPTY_PROVIDER);
  const [simulateEmail, setSimulateEmail] = useState('');
  const [simulateResult, setSimulateResult] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
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
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function savePolicies() {
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
      setError(err instanceof Error ? err.message : 'Failed to save policies.');
    }
  }

  async function saveDomains() {
    setMessage('');
    setError('');
    try {
      const domains = domainText
        .split('\n')
        .map((line) => line.trim().replace(/^@+/, '').toLowerCase())
        .filter(Boolean);
      await organizationsApi.updateSecurityDomains(token, domains);
      await load();
      setMessage('Domain mappings updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update domain mappings.');
    }
  }

  async function addProvider() {
    setMessage('');
    setError('');
    try {
      await organizationsApi.createSsoProvider(token, providerDraft);
      setProviderDraft(EMPTY_PROVIDER);
      await load();
      setMessage('SSO provider created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add SSO provider.');
    }
  }

  async function toggleProvider(provider: SsoProvider) {
    setMessage('');
    setError('');
    try {
      await organizationsApi.updateSsoProvider(token, provider.id, { enabled: !provider.enabled });
      await load();
      setMessage('SSO provider updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update provider.');
    }
  }

  async function deleteProvider(providerId: string) {
    setMessage('');
    setError('');
    try {
      await organizationsApi.removeSsoProvider(token, providerId);
      await load();
      setMessage('SSO provider removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove provider.');
    }
  }

  async function runSimulation() {
    setMessage('');
    setError('');
    setSimulateResult('');
    try {
      const result = await organizationsApi.simulateSsoLogin(token, simulateEmail.trim().toLowerCase());
      setSimulateResult(
        `Org: ${result.organization.name} | Provider: ${result.provider.name} (${result.provider.type}) | Membership: ${result.membershipStatus || 'none'}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to simulate SSO login.');
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">Enterprise Security</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">SSO and policy controls</h1>
            <p className="mt-2 text-sm text-slate-600">Configured by {userName}</p>
          </div>
          <div className="flex gap-2">
            <Link to="/organization-audit" className="rounded-xl border border-cyan-200 px-4 py-2 text-sm font-bold text-cyan-700">
              Audit console
            </Link>
            <Link to="/admin" className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-bold text-white">
              Organization admin
            </Link>
          </div>
        </div>

        {message && <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
        {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-900">Access policies</h2>
          {loading ? <p className="mt-4 text-sm text-slate-500">Loading security policies...</p> : null}
          {!loading && (
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
                  className="mt-2 w-32 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"
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
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                />
              </div>

              <button type="button" onClick={() => void savePolicies()} className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-bold text-white">
                Save policies
              </button>
            </div>
          )}
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-900">Domain mapping</h2>
          <p className="mt-2 text-sm text-slate-600">Users registering with mapped domains can be attached to this organization.</p>
          <textarea
            rows={4}
            value={domainText}
            onChange={(event) => setDomainText(event.target.value)}
            className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"
          />
          <button type="button" onClick={() => void saveDomains()} className="mt-3 rounded-xl border border-cyan-200 px-4 py-2 text-sm font-bold text-cyan-700">
            Save domain mappings
          </button>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-900">SSO providers</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <input placeholder="Provider name" value={providerDraft.name} onChange={(event) => setProviderDraft((prev) => ({ ...prev, name: event.target.value }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
            <select value={providerDraft.type} onChange={(event) => setProviderDraft((prev) => ({ ...prev, type: event.target.value as 'oidc' | 'saml' | 'ldap' }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500">
              <option value="oidc">OIDC</option>
              <option value="saml">SAML</option>
              <option value="ldap">LDAP</option>
            </select>
            <input placeholder="Issuer URL (OIDC)" value={providerDraft.issuerUrl} onChange={(event) => setProviderDraft((prev) => ({ ...prev, issuerUrl: event.target.value }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
            <input placeholder="SSO URL (SAML)" value={providerDraft.ssoUrl} onChange={(event) => setProviderDraft((prev) => ({ ...prev, ssoUrl: event.target.value }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
            <input placeholder="Client ID" value={providerDraft.clientId} onChange={(event) => setProviderDraft((prev) => ({ ...prev, clientId: event.target.value }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
            <input placeholder="Client Secret" value={providerDraft.clientSecret} onChange={(event) => setProviderDraft((prev) => ({ ...prev, clientSecret: event.target.value }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
          </div>
          <textarea
            rows={3}
            placeholder="SAML certificate (optional)"
            value={providerDraft.certificate}
            onChange={(event) => setProviderDraft((prev) => ({ ...prev, certificate: event.target.value }))}
            className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"
          />
          <button type="button" onClick={() => void addProvider()} className="mt-3 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-bold text-white">
            Add provider
          </button>

          <div className="mt-4 space-y-3">
            {security?.ssoProviders.map((provider) => (
              <article key={provider.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{provider.name}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">{provider.type}</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void toggleProvider(provider)} className="rounded-lg border border-cyan-200 px-3 py-1 text-xs font-semibold text-cyan-700">
                      {provider.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button type="button" onClick={() => void deleteProvider(provider.id)} className="rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-600">
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-900">Domain routing simulation</h2>
          <div className="mt-3 flex flex-wrap gap-3">
            <input
              value={simulateEmail}
              onChange={(event) => setSimulateEmail(event.target.value)}
              placeholder="employee@company.com"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500 md:max-w-md"
            />
            <button type="button" onClick={() => void runSimulation()} className="rounded-xl border border-cyan-200 px-4 py-2 text-sm font-bold text-cyan-700">
              Simulate login mapping
            </button>
          </div>
          {simulateResult ? <p className="mt-3 text-sm text-slate-700">{simulateResult}</p> : null}
        </section>
      </div>
    </div>
  );
}
