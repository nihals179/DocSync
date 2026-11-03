import { api } from './api';

export interface SsoProvider {
  id: string;
  name: string;
  type: 'oidc' | 'saml' | 'ldap';
  issuerUrl: string | null;
  ssoUrl: string | null;
  clientId: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SsoSecurityConfig {
  requireMfa: boolean;
  allowSignInWithoutSlug: boolean;
  sessionDurationHours: number;
  ipAllowlistEnabled: boolean;
  ipAllowlist: string[];
  domainMappings: string[];
  ssoProviders: SsoProvider[];
  updatedAt: string;
}

export interface OrganizationInfo {
  name: string;
  slug: string;
  ssoAvailable: boolean;
  providerName: string | null;
  passwordSignIn?: boolean;
}

export interface AuthorizationUrlResponse {
  authorizationUrl: string;
}

export interface SsoLoginSimulation {
  tenant: {
    id: string;
    name: string;
  };
  provider: SsoProvider;
  user: {
    id: string;
    email: string;
    name: string;
  } | null;
  membershipStatus: string | null;
}

class SsoApiService {
  async getSamlAuthorizationUrl(email: string): Promise<AuthorizationUrlResponse> {
    const response = await api.get<AuthorizationUrlResponse>(`/api/auth/saml/authorize?email=${encodeURIComponent(email)}`);
    return response.data as AuthorizationUrlResponse;
  }

  async getOrganization(slug: string): Promise<OrganizationInfo> {
    const response = await api.get<OrganizationInfo>(`/api/auth/sso/org/${encodeURIComponent(slug)}`);
    return response.data as OrganizationInfo;
  }

  async getSecurityConfig(token: string): Promise<SsoSecurityConfig> {
    const response = await api.get<{ security: SsoSecurityConfig }>('/api/security/current/security', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return (response.data as { security: SsoSecurityConfig }).security;
  }

  async createSsoProvider(
    token: string,
    provider: Omit<SsoProvider, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<{ provider: SsoProvider }> {
    const response = await api.post<{ provider: SsoProvider }>('/api/security/current/security/sso/providers', provider, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data as { provider: SsoProvider };
  }

  async updateSsoProvider(
    token: string,
    providerId: string,
    updates: Partial<SsoProvider>,
  ): Promise<{ provider: SsoProvider }> {
    const response = await api.patch<{ provider: SsoProvider }>(
      `/api/security/current/security/sso/providers/${providerId}`,
      updates,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    return response.data as { provider: SsoProvider };
  }

  async deleteSsoProvider(token: string, providerId: string): Promise<{ message: string }> {
    const response = await api.delete<{ message: string }>(
      `/api/security/current/security/sso/providers/${providerId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    return response.data as { message: string };
  }

  async simulateSsoLogin(email: string): Promise<SsoLoginSimulation> {
    const response = await api.post<SsoLoginSimulation>('/api/security/sso/simulate-login', { email });
    return response.data as SsoLoginSimulation;
  }

  async updateSecurityPolicies(
    token: string,
    policies: Partial<{
      requireMfa: boolean;
      allowSignInWithoutSlug: boolean;
      sessionDurationHours: number;
      ipAllowlistEnabled: boolean;
      ipAllowlist: string[];
    }>,
  ): Promise<{ security: SsoSecurityConfig }> {
    const response = await api.put<{ security: SsoSecurityConfig }>('/api/security/current/security/policies', policies, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data as { security: SsoSecurityConfig };
  }

  async updateDomainMappings(
    token: string,
    domains: string[],
  ): Promise<{ domains: string[]; updatedAt: string }> {
    const response = await api.put<{ domains: string[]; updatedAt: string }>(
      '/api/security/current/security/domains',
      { domains },
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    return response.data as { domains: string[]; updatedAt: string };
  }
}

export const ssoApi = new SsoApiService();
