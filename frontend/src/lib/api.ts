const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  role: string;
  currentOrganizationId?: string | null;
};

export type OrganizationSummary = {
  id: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationMembership = {
  id: string;
  organizationId: string;
  userId: string;
  billingAdmin: boolean;
  status: 'active' | 'removed';
  createdAt: string;
  updatedAt: string;
};

export type OrganizationMember = {
  id: string;
  userId: string;
  email: string;
  name: string;
  billingAdmin: boolean;
  status: 'active' | 'removed';
  createdAt: string;
  updatedAt: string;
};

export type OrganizationInvite = {
  id: string;
  email: string;
  billingAdmin: boolean;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  createdAt: string;
  expiresAt: string;
  inviteToken?: string;
};

export type BillingPlan = {
  id: 'free' | 'pro' | 'enterprise' | 'onprem';
  name: string;
  priceMonthlyCents: number;
  displayPrice?: string;
  featureHighlights?: string[];
  limits: {
    seats: number;
    storageBytes: number;
    aiRequestsPerMonth: number;
    collaborators: number;
    documents?: number | null;
    documentUpdatesPerMonth?: number | null;
    versionHistoryDays?: number | null;
    grammarAccessDays?: number | null;
    aiAccessDays?: number | null;
  };
};

export type TemplateSummary = {
  id: string;
  title: string;
  description: string;
  icon: string;
  content: string;
};

export type BillingInvoice = {
  id: string;
  organizationId: string;
  provider: string;
  status: 'draft' | 'open' | 'paid' | 'failed' | 'void';
  amountCents: number;
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  issuedAt: string;
  paidAt: string | null;
  hostedUrl: string | null;
};

export type BillingSnapshot = {
  billing: {
    planId: string;
    status: string;
    purchasedSeats: number;
    trialEndsAt: string | null;
    trialUsed: boolean;
    subscriptionId: string | null;
    customerId: string | null;
    currentPeriodEndAt: string | null;
    graceEndsAt: string | null;
    updatedAt: string;
  };
  plan: BillingPlan;
  limits: {
    seatsPurchased: number;
    storageBytes: number;
    aiRequestsPerMonth: number;
    collaborators: number;
    documents?: number | null;
    documentUpdatesPerMonth?: number | null;
    versionHistoryDays?: number | null;
    grammarAccessDays?: number | null;
    aiAccessDays?: number | null;
  };
  usage: {
    monthKey: string;
    aiRequests: number;
    documentUpdates?: number;
    assignedSeats: number;
    storageUsedBytes: number;
    collaboratorsAssigned: number;
  };
  invoices: BillingInvoice[];
};

export type SsoProvider = {
  id: string;
  type: 'oidc' | 'saml' | 'ldap';
  name: string;
  issuerUrl: string | null;
  ssoUrl: string | null;
  clientId: string | null;
  certificate: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationSecurityState = {
  requireMfa: boolean;
  sessionDurationHours: number;
  ipAllowlistEnabled: boolean;
  ipAllowlist: string[];
  domainMappings: string[];
  ssoProviders: SsoProvider[];
  updatedAt: string;
};

export type EnterpriseEnvironmentPayload = {
  purchasedSeats?: number;
  requireMfa?: boolean;
  sessionDurationHours?: number;
  ipAllowlistEnabled?: boolean;
  ipAllowlist?: string[];
  domains?: string[];
  ssoProvider?: {
    type: 'oidc' | 'saml' | 'ldap';
    name: string;
    issuerUrl?: string;
    ssoUrl?: string;
    clientId?: string;
    clientSecret?: string;
    certificate?: string;
    enabled?: boolean;
  };
};

export type EnterpriseEnvironmentResponse = {
  message: string;
  organization: {
    id: string;
    name: string;
  };
  billing: {
    planId: string;
    status: string;
    purchasedSeats: number;
    trialEndsAt: string | null;
    trialUsed: boolean;
    subscriptionId: string | null;
    customerId: string | null;
    currentPeriodEndAt: string | null;
    graceEndsAt: string | null;
    updatedAt: string;
  };
  security: OrganizationSecurityState;
  entitlements: Omit<BillingSnapshot, 'invoices'> | null;
};

export type OrganizationAuditLog = {
  id: string;
  userId: string;
  organizationId: string | null;
  action: string;
  status: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type AuthSessionSummary = {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  remember: boolean;
  userAgent: string;
  ipAddress: string;
  current?: boolean;
};

export type AuthSuccess = {
  accessToken: string;
  accessTokenExpiresAt: string;
  csrfToken: string;
  user: AuthUser;
  session: AuthSessionSummary;
};

export type TwoFactorPending = {
  requiresTwoFactor: true;
  tempToken: string;
  message: string;
  user: AuthUser;
};

export type RegisterResponse = {
  message: string;
  verificationRequired: boolean;
  user: AuthUser;
  verificationTokenPreview?: string;
  verificationLinkPreview?: string;
};

export type PasswordResetPreview = {
  message: string;
  resetTokenPreview?: string;
  resetLinkPreview?: string;
};

export type VerificationPreview = {
  message: string;
  verificationTokenPreview?: string;
  verificationLinkPreview?: string;
};

type FetchOptions = RequestInit & {
  token?: string;
  includeCsrf?: boolean;
  authScope?: 'workspace' | 'admin';
};

const CSRF_STORAGE_KEY = 'docsync.csrfToken';
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

function getStoredCsrfToken() {
  if (typeof window === 'undefined') return '';
  try {
    return window.sessionStorage.getItem(CSRF_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function persistCsrfToken(token: string) {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      window.sessionStorage.setItem(CSRF_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(CSRF_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

export function clearPersistedCsrfToken() {
  persistCsrfToken('');
}

function getCookie(name: string) {
  const match = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : '';
}

async function apiFetch<T = unknown>(path: string, options: FetchOptions = {}): Promise<T> {
  const { token, headers: extraHeaders, includeCsrf = false, authScope = 'workspace', ...rest } = options;
  const csrfCookieName = authScope === 'admin' ? 'docsync_admin_csrf' : 'docsync_csrf';
  const csrfToken = includeCsrf ? getCookie(csrfCookieName) || getStoredCsrfToken() : '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    ...(authScope === 'admin' ? { 'x-auth-scope': 'admin' } : {}),
    ...(extraHeaders as Record<string, string>),
  };

  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers,
    credentials: 'include',
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) unauthorizedHandler?.();
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

async function apiFetchText(path: string, options: FetchOptions = {}): Promise<string> {
  const { token, headers: extraHeaders, includeCsrf = false, authScope = 'workspace', ...rest } = options;
  const csrfCookieName = authScope === 'admin' ? 'docsync_admin_csrf' : 'docsync_csrf';
  const csrfToken = includeCsrf ? getCookie(csrfCookieName) || getStoredCsrfToken() : '';
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    ...(authScope === 'admin' ? { 'x-auth-scope': 'admin' } : {}),
    ...(extraHeaders as Record<string, string>),
  };

  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers,
    credentials: 'include',
  });

  if (res.status === 401) unauthorizedHandler?.();

  const text = await res.text();
  if (!res.ok) {
    try {
      const parsed = JSON.parse(text) as { error?: string };
      throw new Error(parsed.error ?? `HTTP ${res.status}`);
    } catch {
      throw new Error(`HTTP ${res.status}`);
    }
  }

  return text;
}

export const authApi = {
  register: (name: string, email: string, password: string) =>
    apiFetch<RegisterResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    }),
  verifyEmail: (token: string) =>
    apiFetch<{ message: string }>('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  resendVerification: (email: string) =>
    apiFetch<VerificationPreview>('/api/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  login: (email: string, password: string, remember: boolean, authScope: 'workspace' | 'admin' = 'workspace') =>
    apiFetch<AuthSuccess | TwoFactorPending>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, remember }),
      authScope,
    }),
  loginWithTwoFactor: (tempToken: string, code: string, authScope: 'workspace' | 'admin' = 'workspace') =>
    apiFetch<AuthSuccess>('/api/auth/login/2fa', {
      method: 'POST',
      body: JSON.stringify({ tempToken, code }),
      authScope,
    }),
  refresh: (authScope: 'workspace' | 'admin' = 'workspace') =>
    apiFetch<AuthSuccess>('/api/auth/refresh', {
      method: 'POST',
      includeCsrf: true,
      authScope,
    }),
  logout: (token: string, authScope: 'workspace' | 'admin' = 'workspace') =>
    apiFetch<{ message: string }>('/api/auth/logout', {
      method: 'POST',
      token,
      authScope,
    }),
  me: (token: string) =>
    apiFetch<{ user: AuthUser; session: AuthSessionSummary; csrfToken: string }>('/api/auth/me', {
      token,
    }),
  forgotPassword: (email: string) =>
    apiFetch<PasswordResetPreview>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, password: string) =>
    apiFetch<{ message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),
  getSessions: (token: string) =>
    apiFetch<{ sessions: AuthSessionSummary[] }>('/api/auth/sessions', { token }),
  revokeSession: (token: string, sessionId: string) =>
    apiFetch<{ message: string }>(`/api/auth/sessions/${sessionId}`, {
      method: 'DELETE',
      token,
    }),
  revokeAllSessions: (token: string) =>
    apiFetch<{ message: string }>('/api/auth/sessions/revoke-all', {
      method: 'POST',
      token,
    }),
  getAuditLogs: (token: string) =>
    apiFetch<{ logs: Array<{ id: string; action: string; status: string; ipAddress: string; userAgent: string; createdAt: string; metadata?: Record<string, unknown> }> }>('/api/auth/audit-logs', { token }),
  getSecurity: (token: string) =>
    apiFetch<{ user: AuthUser; activeSessions: number }>('/api/auth/security', { token }),
  setupTwoFactor: (token: string) =>
    apiFetch<{ secret: string; otpauth: string; qrDataUrl: string }>('/api/auth/2fa/setup', {
      method: 'POST',
      token,
    }),
  enableTwoFactor: (token: string, code: string) =>
    apiFetch<{ message: string; user: AuthUser }>('/api/auth/2fa/enable', {
      method: 'POST',
      token,
      body: JSON.stringify({ code }),
    }),
  disableTwoFactor: (token: string, code: string) =>
    apiFetch<{ message: string; user: AuthUser }>('/api/auth/2fa/disable', {
      method: 'POST',
      token,
      body: JSON.stringify({ code }),
    }),
};

export const docsApi = {
  create: (
    token: string,
    title = 'Untitled',
    content = '',
    parentId?: string | null,
    workspaceId?: string | null,
  ) =>
    apiFetch<{ doc: { id: string; title: string; content: string; parentId?: string | null; workspaceId?: string | null } }>(
      '/api/docs',
      {
        method: 'POST',
        token,
        body: JSON.stringify({
          title,
          content,
          ...(parentId != null ? { parentId } : {}),
          ...(workspaceId !== undefined ? { workspaceId } : {}),
        }),
      },
    ),
  list: (token: string) =>
    apiFetch<{ docs: Array<{ id: string; title: string; preview: string; updatedAt: string; createdAt: string; parentId?: string | null; workspaceId?: string | null; sortOrder?: number }> }>(
      '/api/docs',
      { token },
    ),
  get: (token: string, id: string) =>
    apiFetch<{ doc: { id: string; title: string; content: string } }>(
      `/api/docs/${id}`,
      { token },
    ),
  update: (token: string, id: string, patch: { title?: string; content?: string; parentId?: string | null; workspaceId?: string | null; sortOrder?: number }) =>
    apiFetch<{ doc: { id: string; title: string; content: string } }>(
      `/api/docs/${id}`,
      { method: 'PUT', token, body: JSON.stringify(patch) },
    ),
};

export const commentsApi = {
  list: (token: string, docId: string) =>
    apiFetch<{ comments: Array<{ id: string; text: string; userName: string; createdAt: string }> }>(
      `/api/docs/${docId}/comments`,
      { token },
    ),
  add: (token: string, docId: string, text: string) =>
    apiFetch<{ comment: { id: string; text: string; userName: string; createdAt: string } }>(
      `/api/docs/${docId}/comments`,
      { method: 'POST', token, body: JSON.stringify({ text }) },
    ),
  delete: (token: string, docId: string, commentId: string) =>
    apiFetch(`/api/docs/${docId}/comments/${commentId}`, { method: 'DELETE', token }),
};

export const versionsApi = {
  list: (token: string, docId: string) =>
    apiFetch<{ versions: Array<{ id: string; preview: string; savedAt: string }> }>(
      `/api/docs/${docId}/versions`,
      { token },
    ),
  save: (token: string, docId: string, content: string, preview?: string) =>
    apiFetch<{ version: { id: string; preview: string; savedAt: string } }>(
      `/api/docs/${docId}/versions`,
      { method: 'POST', token, body: JSON.stringify({ content, preview }) },
    ),
  restore: (token: string, docId: string, versionId: string) =>
    apiFetch<{ doc: { content: string } }>(
      `/api/docs/${docId}/versions/${versionId}/restore`,
      { method: 'POST', token },
    ),
  delete: (token: string, docId: string, versionId: string) =>
    apiFetch(`/api/docs/${docId}/versions/${versionId}`, { method: 'DELETE', token }),
};

export const todosApi = {
  list: (token: string, docId: string) =>
    apiFetch<{ todos: Array<{ id: string; text: string; done: boolean }> }>(
      `/api/docs/${docId}/todos`,
      { token },
    ),
  add: (token: string, docId: string, text: string) =>
    apiFetch<{ todo: { id: string; text: string; done: boolean } }>(
      `/api/docs/${docId}/todos`,
      { method: 'POST', token, body: JSON.stringify({ text }) },
    ),
  update: (token: string, docId: string, todoId: string, patch: { done?: boolean; text?: string }) =>
    apiFetch<{ todo: { id: string; text: string; done: boolean } }>(
      `/api/docs/${docId}/todos/${todoId}`,
      { method: 'PUT', token, body: JSON.stringify(patch) },
    ),
  delete: (token: string, docId: string, todoId: string) =>
    apiFetch(`/api/docs/${docId}/todos/${todoId}`, { method: 'DELETE', token }),
};

export const aiApi = {
  chat: (token: string, message: string, context?: string) =>
    apiFetch<{ response: string }>('/api/ai/chat', {
      method: 'POST',
      token,
      body: JSON.stringify({ message, context }),
    }),
};

export const grammarApi = {
  check: (token: string, text: string) =>
    apiFetch<{ issues: Array<{ id: number; type: string; text: string; suggestion: string }> }>('/api/grammar/check', {
      method: 'POST',
      token,
      body: JSON.stringify({ text }),
    }),
};

export const workspaceApi = {
  list: (token: string) =>
    apiFetch<{
      workspaces: Array<{
        id: string;
        name: string;
        ownerId: string;
        memberIds: string[];
        createdAt: string;
        updatedAt: string;
      }>;
    }>('/api/workspaces', { token }),
  create: (token: string, name: string) =>
    apiFetch<{
      workspace: {
        id: string;
        name: string;
        ownerId: string;
        memberIds: string[];
        createdAt: string;
        updatedAt: string;
      };
    }>('/api/workspaces', {
      method: 'POST',
      token,
      body: JSON.stringify({ name }),
    }),
};

export const templatesApi = {
  list: (token: string) =>
    apiFetch<{ templates: TemplateSummary[] }>('/api/templates', { token }),
};

export const organizationsApi = {
  mine: (token: string) =>
    apiFetch<{ organizations: OrganizationSummary[]; currentOrganizationId: string | null }>('/api/organizations/mine', {
      token,
    }),
  switchContext: (token: string, organizationId: string) =>
    apiFetch<{ message: string; organizationId: string }>('/api/organizations/switch', {
      method: 'POST',
      token,
      body: JSON.stringify({ organizationId }),
    }),
  current: (token: string) =>
    apiFetch<{ organization: OrganizationSummary; membership: OrganizationMembership }>('/api/organizations/current', {
      token,
    }),
  listMembers: (token: string) =>
    apiFetch<{ members: OrganizationMember[] }>('/api/organizations/current/members', {
      token,
    }),
  listInvites: (token: string) =>
    apiFetch<{ invites: OrganizationInvite[] }>('/api/organizations/current/invites', {
      token,
    }),
  inviteMember: (token: string, payload: { email: string; billingAdmin?: boolean }) =>
    apiFetch<{ invite: OrganizationInvite }>('/api/organizations/current/invites', {
      method: 'POST',
      token,
      body: JSON.stringify(payload),
    }),
  acceptInvite: (token: string, tokenValue: string) =>
    apiFetch<{ message: string; organizationId: string }>('/api/organizations/invites/accept', {
      method: 'POST',
      token,
      body: JSON.stringify({ token: tokenValue }),
    }),
  updateMember: (
    token: string,
    membershipId: string,
    patch: { billingAdmin?: boolean },
  ) =>
    apiFetch<{ member: OrganizationMember }>(`/api/organizations/current/members/${membershipId}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify(patch),
    }),
  removeMember: (token: string, membershipId: string) =>
    apiFetch<{ message: string }>(`/api/organizations/current/members/${membershipId}`, {
      method: 'DELETE',
      token,
    }),
  entitlements: (token: string) =>
    apiFetch<{ entitlements: Omit<BillingSnapshot, 'invoices'> }>('/api/organizations/current/entitlements', {
      token,
    }),
  getSecurity: (token: string) =>
    apiFetch<{ security: OrganizationSecurityState }>('/api/organizations/current/security', {
      token,
    }),
  createEnterpriseEnvironment: (token: string, payload: EnterpriseEnvironmentPayload) =>
    apiFetch<EnterpriseEnvironmentResponse>('/api/organizations/current/enterprise/environment', {
      method: 'POST',
      token,
      body: JSON.stringify(payload),
    }),
  updateSecurityPolicies: (
    token: string,
    payload: {
      requireMfa?: boolean;
      sessionDurationHours?: number;
      ipAllowlistEnabled?: boolean;
      ipAllowlist?: string[];
    },
  ) =>
    apiFetch<{ message: string; security: OrganizationSecurityState }>('/api/organizations/current/security/policies', {
      method: 'PUT',
      token,
      body: JSON.stringify(payload),
    }),
  updateSecurityDomains: (token: string, domains: string[]) =>
    apiFetch<{ domains: string[]; updatedAt: string }>('/api/organizations/current/security/domains', {
      method: 'PUT',
      token,
      body: JSON.stringify({ domains }),
    }),
  createSsoProvider: (
    token: string,
    payload: {
      type: 'oidc' | 'saml' | 'ldap';
      name: string;
      issuerUrl?: string;
      ssoUrl?: string;
      clientId?: string;
      clientSecret?: string;
      certificate?: string;
      enabled?: boolean;
    },
  ) =>
    apiFetch<{ provider: SsoProvider }>('/api/organizations/current/security/sso/providers', {
      method: 'POST',
      token,
      body: JSON.stringify(payload),
    }),
  updateSsoProvider: (
    token: string,
    providerId: string,
    payload: Partial<{
      type: 'oidc' | 'saml' | 'ldap';
      name: string;
      issuerUrl: string;
      ssoUrl: string;
      clientId: string;
      clientSecret: string;
      certificate: string;
      enabled: boolean;
    }>,
  ) =>
    apiFetch<{ provider: SsoProvider }>(`/api/organizations/current/security/sso/providers/${providerId}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify(payload),
    }),
  removeSsoProvider: (token: string, providerId: string) =>
    apiFetch<{ message: string }>(`/api/organizations/current/security/sso/providers/${providerId}`, {
      method: 'DELETE',
      token,
    }),
  simulateSsoLogin: (token: string, email: string) =>
    apiFetch<{
      organization: { id: string; name: string };
      provider: SsoProvider;
      user: { id: string; email: string; name: string } | null;
      membershipStatus: string | null;
    }>('/api/organizations/sso/simulate-login', {
      method: 'POST',
      token,
      body: JSON.stringify({ email }),
    }),
  getOrganizationAuditLogs: (
    token: string,
    query: { userId?: string; action?: string; status?: string; limit?: number } = {},
  ) => {
    const search = new URLSearchParams();
    if (query.userId) search.set('userId', query.userId);
    if (query.action) search.set('action', query.action);
    if (query.status) search.set('status', query.status);
    if (query.limit != null) search.set('limit', String(query.limit));
    const suffix = search.toString() ? `?${search.toString()}` : '';
    return apiFetch<{ logs: OrganizationAuditLog[] }>(`/api/organizations/current/audit-logs${suffix}`, { token });
  },
  exportOrganizationAuditCsv: (
    token: string,
    query: { userId?: string; action?: string; status?: string; limit?: number } = {},
  ) => {
    const search = new URLSearchParams();
    if (query.userId) search.set('userId', query.userId);
    if (query.action) search.set('action', query.action);
    if (query.status) search.set('status', query.status);
    if (query.limit != null) search.set('limit', String(query.limit));
    const suffix = search.toString() ? `?${search.toString()}` : '';
    return apiFetchText(`/api/organizations/current/audit-logs/export.csv${suffix}`, { token });
  },
};

export const billingApi = {
  plans: (token: string) => apiFetch<{ plans: BillingPlan[] }>('/api/billing/plans', { token }),
  current: (token: string) => apiFetch<{ snapshot: BillingSnapshot }>('/api/billing/current', { token }),
  invoices: (token: string) => apiFetch<{ invoices: BillingInvoice[] }>('/api/billing/invoices', { token }),
  checkout: (
    token: string,
    payload: {
      planId: 'free' | 'pro' | 'enterprise' | 'onprem';
      purchasedSeats?: number;
      successUrl?: string;
      cancelUrl?: string;
      autoQueueCompletion?: boolean;
    },
  ) =>
    apiFetch<{
      checkoutSession: {
        id: string;
        provider: string;
        checkoutUrl: string;
        cancelUrl: string;
      };
      currentPlanId: string;
      note: string;
    }>('/api/billing/checkout', {
      method: 'POST',
      token,
      body: JSON.stringify(payload),
    }),
  changeSubscription: (
    token: string,
    payload: { planId: 'free' | 'pro' | 'enterprise' | 'onprem'; purchasedSeats?: number },
  ) =>
    apiFetch<{ message: string; eventId: string }>('/api/billing/subscription/change', {
      method: 'POST',
      token,
      body: JSON.stringify(payload),
    }),
  updateSeats: (token: string, purchasedSeats: number) =>
    apiFetch<{ message: string; purchasedSeats: number; assignedSeats: number }>('/api/billing/seats', {
      method: 'PATCH',
      token,
      body: JSON.stringify({ purchasedSeats }),
    }),
  webhookJobs: (token: string) =>
    apiFetch<{
      jobs: Array<{
        id: string;
        eventId: string;
        type: string;
        status: string;
        attempts: number;
        nextAttemptAt: string;
        lastError: string | null;
      }>;
    }>('/api/billing/webhooks/jobs', { token }),
};
