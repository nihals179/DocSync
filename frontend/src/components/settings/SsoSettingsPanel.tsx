import { useEffect, useState } from 'react';
import type { SsoSecurityConfig } from '../../services/ssoApi';
import { ssoApi } from '../../services/ssoApi';

interface SsoSettingsPanelProps {
  token: string;
}

function SsoSettingsPanel({ token }: SsoSettingsPanelProps) {

  const [config, setConfig] = useState<SsoSecurityConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewProviderForm, setShowNewProviderForm] = useState(false);

  const handleAddProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const providerData = {
        ...formData,
        enabled: true,
        ...(formData.type === 'oidc' && {
          ssoUrl: null,
          certificate: null,
          entityId: null,
        }),
        ...(formData.type === 'saml' && {
          issuerUrl: null,
          clientId: null,
          clientSecret: null,
        }),
      };

      const { provider } = await ssoApi.createSsoProvider(token, providerData as any);

      setConfig((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          ssoProviders: [...prev.ssoProviders, provider],
        };
      });

      setFormData({ name: '', type: 'oidc', issuerUrl: '', clientId: '', clientSecret: '', ssoUrl: '', entityId: '', certificate: '' });
      setShowNewProviderForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create provider');
    }
  };

  const handleToggleProvider = async (providerId: string, enabled: boolean) => {
    try {
      await ssoApi.updateSsoProvider(token, providerId, { enabled: !enabled } as any);
      setConfig((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          ssoProviders: prev.ssoProviders.map((p) =>
            p.id === providerId ? { ...p, enabled: !enabled } : p,
          ),
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update provider');
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    if (!window.confirm('Are you sure you want to delete this SSO provider?')) {
      return;
    }

    try {
      await ssoApi.deleteSsoProvider(token, providerId);
      setConfig((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          ssoProviders: prev.ssoProviders.filter((p) => p.id !== providerId),
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete provider');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-gray-500">Loading SSO configuration...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div>
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg mb-4">
          <p className="text-sm text-gray-700 mb-2 font-medium">SAML ACS (Assertion Consumer Service) URL:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded text-sm font-mono text-gray-900">
              {typeof window !== 'undefined' ? `${window.location.origin}/auth/saml/acs` : 'http://localhost:3001/auth/saml/acs'}
            </code>
            <button
              onClick={() => {
                const acsUrl = `${window.location.origin}/auth/saml/acs`;
                navigator.clipboard.writeText(acsUrl);
              }}
              className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium transition-colors"
            >
              Copy
            </button>
          </div>
          <p className="text-xs text-gray-600 mt-2">
            Use this URL when configuring SAML in your Identity Provider (IdP)
          </p>
        </div>

        <div className="flex items-center justify-betffween mb-4">
          <h3 className="text-lg font-semibold text-gray-900">SSO Providers</h3>
          <button
            onClick={() => setShowNewProviderForm(!showNewProviderForm)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            {showNewProviderForm ? 'Cancel' : 'Add Provider'}
          </button>
        </div>

        {showNewProviderForm && (
          <form onSubmit={handleAddProvider} className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Provider Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Azure AD"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Provider Type
              </label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="oidc">OIDC</option>
                <option value="saml">SAML</option>
                <option value="ldap">LDAP</option>
              </select>
            </div>

            {formData.type === 'oidc' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Issuer URL
                  </label>
                  <input
                    type="url"
                    value={formData.issuerUrl}
                    onChange={(e) => setFormData({ ...formData, issuerUrl: e.target.value })}
                    placeholder="https://login.microsoftonline.com/YOUR_TENANT_ID/v2.0"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Azure AD: Azure Portal → App registrations → Endpoints → OpenID Connect metadata document. Okta: Admin dashboard → Security → API → Authorization servers
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Application ID
                  </label>
                  <input
                    type="text"
                    value={formData.clientId}
                    onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
                    placeholder="e.g., 46dfceb2-eff0-4541-bc2b-8305e7d5b676"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Azure AD: App registrations → Your app → copy Application ID (GUID)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Client Value
                  </label>
                  <input
                    type="password"
                    value={formData.clientSecret}
                    onChange={(e) => setFormData({ ...formData, clientSecret: e.target.value })}
                    placeholder="Paste the SECRET VALUE (shown only once)"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Azure AD: Certificates &amp; secrets → Client secrets → copy the VALUE column (not the ID)
                  </p>
                </div>
              </>
            )}

            {formData.type === 'saml' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Sign-On URL
                  </label>
                  <input
                    type="url"
                    value={formData.ssoUrl}
                    onChange={(e) => setFormData({ ...formData, ssoUrl: e.target.value })}
                    placeholder="https://login.microsoftonline.com/TENANT_ID/saml2"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Azure AD: Enterprise applications → Your app → Single sign-on → "Login URL". Okta: Applications → Your app → Sign On → "Identity Provider Single Sign-On URL"
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    EntraID (Entity ID)
                  </label>
                  <input
                    type="text"
                    value={formData.entityId}
                    onChange={(e) => setFormData({ ...formData, entityId: e.target.value })}
                    placeholder="https://sts.windows.net/YOUR_TENANT_ID/"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Azure AD: Enterprise applications → Your app → Single sign-on → "Identifier (Entity ID)". Okta: "Identity Provider Issuer"
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    X.509 Certificate
                  </label>
                  <textarea
                    value={formData.certificate}
                    onChange={(e) => setFormData({ ...formData, certificate: e.target.value })}
                    placeholder="-----BEGIN CERTIFICATE-----&#10;MIICXDCCAcWgAwIBAgIBADANBgkqhkiG...&#10;-----END CERTIFICATE-----"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs"
                    rows={6}
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Azure AD: Enterprise applications → Your app → Single sign-on → "SAML Signing Certificate" (download and copy full certificate content). Okta: "View SAML setup instructions" → Copy certificate block
                  </p>
                </div>
              </>
            )}

            <button
              type="submit"
              className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
            >
              Create Provider
            </button>
          </form>
        )}

        <div className="space-y-3">
          {config?.ssoProviders && config.ssoProviders.length > 0 ? (
            config.ssoProviders.map((provider) => (
              <div key={provider.id} className="p-4 border border-gray-200 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-900">{provider.name}</h4>
                      <p className="text-xs text-gray-500 mt-1">
                        Type: {provider.type.toUpperCase()}
                      </p>
                    </div>
                  </div>
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={provider.enabled}
                      onChange={() => handleToggleProvider(provider.id, provider.enabled)}
                      className="rounded"
                    />
                    <span className="ml-2 text-sm text-gray-700">Active</span>
                  </label>
                </div>

                {provider.issuerUrl && (
                  <p className="text-xs text-gray-600 mb-2 break-all">
                    Issuer: {provider.issuerUrl}
                  </p>
                )}

                <button
                  onClick={() => handleDeleteProvider(provider.id)}
                  className="text-xs text-red-600 hover:text-red-700 font-medium"
                >
                  Delete
                </button>
              </div>
            ))
          ) : (
            <p className="text-center py-6 text-gray-500">
              No SSO providers configured yet
            </p>
          )}
        </div>
      </div>

      {config && (
        <div className="pt-4 border-t border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Domain Mappings</h3>
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600 mb-2">
              Email domains that will be routed to this tenant:
            </p>
            <div className="flex flex-wrap gap-2">
              {config.domainMappings && config.domainMappings.length > 0 ? (
                config.domainMappings.map((domain) => (
                  <span
                    key={domain}
                    className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm"
                  >
                    @{domain}
                  </span>
                ))
              ) : (
                <p className="text-sm text-gray-500">No domains mapped yet</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SsoSettingsPanel;
