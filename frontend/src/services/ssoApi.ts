import { api } from './api';

export interface OrganizationInfo {
  name: string;
  slug: string;
  ssoAvailable: boolean;
  providerName: string | null;
  passwordSignIn?: boolean;
}

interface AuthorizationUrlResponse {
  authorizationUrl: string;
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
}

export const ssoApi = new SsoApiService();
