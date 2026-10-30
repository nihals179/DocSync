const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

export const NETWORK_ACTIVITY_EVENT = 'docsync:network-activity';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  role: string;
  currentTenantId?: string | null;
};

export type TenantSummary = {
  id: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type tenantMembership = {
  id: string;
  tenantId: string;
  userId: string;
  billingAdmin: boolean;
  status: 'active' | 'removed';
  createdAt: string;
  updatedAt: string;
};

export type TenantMember = {
  id: string;
  userId: string;
  email: string;
  name: string;
  billingAdmin: boolean;
  status: 'active' | 'removed';
  createdAt: string;
  updatedAt: string;
};

export type TenantInvite = {
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
  tenantId: string;
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

export type EditorBootstrapResponse = {
  doc: {
    id: string;
    title: string;
    content: string;
    userId: string;
    tenantId: string;
    createdAt: string;
    updatedAt: string;
    parentId?: string | null;
    workspaceId?: string | null;
    sortOrder?: number;
    preview: string;
  };
  versions: Array<{ id: string; preview: string; savedAt: string }>;
  docs: Array<{
    id: string;
    title: string;
    content: string;
    userId: string;
    tenantId: string;
    createdAt: string;
    updatedAt: string;
    parentId?: string | null;
    workspaceId?: string | null;
    sortOrder?: number;
    preview: string;
  }>;
  workspaces: Array<{
    id: string;
    name: string;
    ownerId: string;
    memberIds: string[];
    createdAt: string;
    updatedAt: string;
  }>;
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

export type TenantSecurityState = {
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
  tenant: {
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
  security: TenantSecurityState;
  entitlements: Omit<BillingSnapshot, 'invoices'> | null;
};

export type TenantAuditLog = {
  id: string;
  userId: string;
  tenantId: string | null;
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
  mfaSetupRequired?: boolean;
  message?: string;
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
const TENANT_CONTEXT_STORAGE_KEY = 'docsync.tenantContextId';
let unauthorizedHandler: (() => void) | null = null;
let passwordPublicKeyPromise: Promise<string> | null = null;
let inFlightApiRequests = 0;

const inFlightGetRequests = new Map<string, Promise<unknown>>();

function buildRequestDedupeKey(path: string, options: FetchOptions) {
  const method = String(options.method || 'GET').toUpperCase();
  const token = options.token || '';
  const authScope = options.authScope || 'workspace';
  const includeCsrf = options.includeCsrf ? '1' : '0';
  const body = typeof options.body === 'string' ? options.body : '';
  return `${method}|${authScope}|csrf:${includeCsrf}|token:${token}|${path}|${body}`;
}

function emitNetworkActivity() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NETWORK_ACTIVITY_EVENT, {
    detail: {
      activeRequests: inFlightApiRequests,
      isLoading: inFlightApiRequests > 0,
    },
  }));
}

function beginApiRequest() {
  inFlightApiRequests += 1;
  emitNetworkActivity();
}

function endApiRequest() {
  inFlightApiRequests = Math.max(0, inFlightApiRequests - 1);
  emitNetworkActivity();
}

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

export function getPersistedTenantContextId() {
  if (typeof window === 'undefined') return '';
  try {
    return window.sessionStorage.getItem(TENANT_CONTEXT_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function persistTenantContextId(tenantId: string | null | undefined) {
  if (typeof window === 'undefined') return;
  try {
    const normalized = String(tenantId || '').trim();
    if (normalized) {
      window.sessionStorage.setItem(TENANT_CONTEXT_STORAGE_KEY, normalized);
    } else {
      window.sessionStorage.removeItem(TENANT_CONTEXT_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

function getCookie(name: string) {
  const match = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : '';
}

async function apiFetch<T = unknown>(path: string, options: FetchOptions = {}): Promise<T> {
  const dedupeKey = buildRequestDedupeKey(path, options);
  const method = String(options.method || 'GET').toUpperCase();
  const shouldDedupeGet = method === 'GET';

  if (shouldDedupeGet) {
    const inFlight = inFlightGetRequests.get(dedupeKey);
    if (inFlight) {
      return inFlight as Promise<T>;
    }
  }

  const run = async (): Promise<T> => {
  const { token, headers: extraHeaders, includeCsrf = false, authScope = 'workspace', ...rest } = options;
  const csrfCookieName = authScope === 'admin' ? 'docsync_admin_csrf' : 'docsync_csrf';
  const csrfToken = includeCsrf ? getCookie(csrfCookieName) || getStoredCsrfToken() : '';
  const extraHeaderRecord = (extraHeaders as Record<string, string>) || {};
  const explicitTenantHeader =
    extraHeaderRecord['x-tenant-id']
    || extraHeaderRecord['X-Tenant-Id']
    || extraHeaderRecord['X-TENANT-ID'];
  const tenantContextId = explicitTenantHeader ? '' : getPersistedTenantContextId();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    ...(tenantContextId ? { 'x-tenant-id': tenantContextId } : {}),
    ...(authScope === 'admin' ? { 'x-auth-scope': 'admin' } : {}),
    ...extraHeaderRecord,
  };

  beginApiRequest();
  try {
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
  } finally {
    endApiRequest();
  }
  };

  const requestPromise = run();

  if (shouldDedupeGet) {
    inFlightGetRequests.set(dedupeKey, requestPromise as Promise<unknown>);
  }

  try {
    return await requestPromise;
  } finally {
    if (shouldDedupeGet) {
      inFlightGetRequests.delete(dedupeKey);
    }
  }
}

async function apiFetchText(path: string, options: FetchOptions = {}): Promise<string> {
  const { token, headers: extraHeaders, includeCsrf = false, authScope = 'workspace', ...rest } = options;
  const csrfCookieName = authScope === 'admin' ? 'docsync_admin_csrf' : 'docsync_csrf';
  const csrfToken = includeCsrf ? getCookie(csrfCookieName) || getStoredCsrfToken() : '';
  const extraHeaderRecord = (extraHeaders as Record<string, string>) || {};
  const explicitTenantHeader =
    extraHeaderRecord['x-tenant-id']
    || extraHeaderRecord['X-Tenant-Id']
    || extraHeaderRecord['X-TENANT-ID'];
  const tenantContextId = explicitTenantHeader ? '' : getPersistedTenantContextId();
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    ...(tenantContextId ? { 'x-tenant-id': tenantContextId } : {}),
    ...(authScope === 'admin' ? { 'x-auth-scope': 'admin' } : {}),
    ...extraHeaderRecord,
  };

  beginApiRequest();
  try {
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
  } finally {
    endApiRequest();
  }
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function fetchPasswordPublicKey() {
  if (!passwordPublicKeyPromise) {
    passwordPublicKeyPromise = apiFetch<{ publicKey?: string }>('/api/auth/public-key')
      .then((response) => {
        if (!response?.publicKey) {
          throw new Error('Password encryption public key is unavailable.');
        }
        return response.publicKey;
      })
      .catch((error) => {
        passwordPublicKeyPromise = null;
        throw error;
      });
  }
  return passwordPublicKeyPromise;
}

async function encryptPasswordForTransport(password: string) {
  const keyPem = await fetchPasswordPublicKey();
  const pemBody = keyPem
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s+/g, '');
  const binaryDer = Uint8Array.from(atob(pemBody), (char) => char.charCodeAt(0));
  const cryptoKey = await window.crypto.subtle.importKey(
    'spki',
    binaryDer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    cryptoKey,
    new TextEncoder().encode(password),
  );
  return toBase64(new Uint8Array(encrypted));
}

function isInvalidPasswordEncryptionError(error: unknown) {
  return error instanceof Error
    && error.message.toLowerCase().includes('invalid encrypted password payload');
}

async function withPasswordEncryptionRetry<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (!isInvalidPasswordEncryptionError(error)) {
      throw error;
    }

    // Backend key rotated after restart; force public-key refresh and retry once.
    passwordPublicKeyPromise = null;
    return operation();
  }
}

export const authApi = {
  resumeLogin: (identifier: string, authScope: 'workspace' | 'admin' = 'workspace') =>
    apiFetch<AuthSuccess>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: identifier, remember: false }),
      includeCsrf: true,
      authScope,
    }).then((auth) => {
      persistTenantContextId(auth.user?.currentTenantId ?? null);
      return auth;
    }),
  register: async (name: string, email: string, password: string) =>
    withPasswordEncryptionRetry(async () => apiFetch<RegisterResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name,
        email,
        passwordEncrypted: await encryptPasswordForTransport(password),
      }),
    })),
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
  login: async (email: string, password: string, remember: boolean, authScope: 'workspace' | 'admin' = 'workspace') =>
    withPasswordEncryptionRetry(async () => apiFetch<AuthSuccess | TwoFactorPending>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email,
        passwordEncrypted: await encryptPasswordForTransport(password),
        remember,
      }),
      authScope,
    })).then((result) => {
      if (!('requiresTwoFactor' in result)) {
        persistTenantContextId(result.user?.currentTenantId ?? null);
      }
      return result;
    }),
  loginWithTwoFactor: (tempToken: string, code: string, authScope: 'workspace' | 'admin' = 'workspace') =>
    apiFetch<AuthSuccess>('/api/auth/login/2fa', {
      method: 'POST',
      body: JSON.stringify({ tempToken, code }),
      authScope,
    }).then((auth) => {
      persistTenantContextId(auth.user?.currentTenantId ?? null);
      return auth;
    }),
  refresh: (token?: string, authScope: 'workspace' | 'admin' = 'workspace') =>
    apiFetch<AuthSuccess>('/api/auth/refresh', {
      method: 'POST',
      includeCsrf: true,
      token,
      authScope,
    }).then((auth) => {
      persistTenantContextId(auth.user?.currentTenantId ?? null);
      return auth;
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
  resetPassword: async (token: string, password: string) =>
    withPasswordEncryptionRetry(async () => apiFetch<{ message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        token,
        passwordEncrypted: await encryptPasswordForTransport(password),
      }),
    })),
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
  update: (token: string, id: string, patch: { title?: string; content?: string; workspaceId?: string | null }) =>
    apiFetch<{ doc: { id: string; title: string; content: string } }>(
      `/api/docs/${id}`,
      { method: 'PUT', token, body: JSON.stringify(patch) },
    ),
  /** Re-parents a document (with its subtree) and places it at `index` among its new siblings. */
  move: (token: string, id: string, target: { parentId: string | null; index: number; workspaceId?: string | null }) =>
    apiFetch<{ doc: { id: string; parentId: string | null; workspaceId: string | null; sortOrder: number } }>(
      `/api/docs/${id}/move`,
      { method: 'POST', token, body: JSON.stringify(target) },
    ),
};

export const editorApi = {
  bootstrap: (token: string, docId: string) =>
    apiFetch<EditorBootstrapResponse>(`/api/editor/${docId}/bootstrap`, { token }),
};

export const commentsApi = {
  list: (token: string, docId: string) =>
    apiFetch<{ comments: Array<{ id: string; text: string; userId: string; userName?: string; createdAt: string }> }>(
      `/api/docs/${docId}/comments`,
      { token },
    ),
  add: (token: string, docId: string, text: string) =>
    apiFetch<{ comment: { id: string; text: string; userId: string; userName?: string; createdAt: string } }>(
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
  listAll: (
    token: string,
    filters?: {
      workspaceId?: string;
      docId?: string;
      userId?: string;
      q?: string;
      limit?: number;
    },
  ) => {
    const params = new URLSearchParams();
    if (filters?.workspaceId) params.set('workspaceId', filters.workspaceId);
    if (filters?.docId) params.set('docId', filters.docId);
    if (filters?.userId) params.set('userId', filters.userId);
    if (filters?.q) params.set('q', filters.q);
    if (typeof filters?.limit === 'number') params.set('limit', String(filters.limit));

    const query = params.toString();
    const url = query ? `/api/versions/all?${query}` : '/api/versions/all';

    return apiFetch<{
      versions: Array<{
        id: string;
        docId: string;
        workspaceId: string | null;
        userId: string;
        docTitle: string;
        preview: string;
        savedAt: string;
      }>;
    }>(url, { token });
  },
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
  delete: (token: string, workspaceId: string) =>
    apiFetch<{ message: string }>(`/api/workspaces/${workspaceId}`, {
      method: 'DELETE',
      token,
    }),
  setCurrent: (token: string, workspaceId: string) =>
    apiFetch<{ message: string }>('/api/workspaces/current', {
      method: 'POST',
      token,
      body: JSON.stringify({ workspaceId }),
    }),
};

export const templatesApi = {
  list: (token: string) =>
    apiFetch<{ templates: TemplateSummary[] }>('/api/templates', { token }),
};

export const tenantsApi = {
  mine: (token: string) =>
    apiFetch<{ tenants: TenantSummary[]; currentTenantId: string | null }>('/api/tenants/mine', {
      token,
    }).then((response) => {
      persistTenantContextId(response.currentTenantId);
      return response;
    }),
  switchContext: (token: string, tenantId: string) =>
    apiFetch<{ message: string; tenantId: string }>('/api/tenants/switch', {
      method: 'POST',
      token,
      body: JSON.stringify({ tenantId }),
    }).then((response) => {
      persistTenantContextId(response.tenantId);
      return response;
    }),
  current: (token: string) =>
    apiFetch<{ tenant: TenantSummary; membership: tenantMembership }>('/api/tenants/current', {
      token,
    }).then((response) => {
      persistTenantContextId(response.tenant?.id || null);
      return response;
    }),
  listMembers: (token: string) =>
    apiFetch<{ members: TenantMember[] }>('/api/tenants/current/members', {
      token,
    }),
  listInvites: (token: string) =>
    apiFetch<{ invites: TenantInvite[] }>('/api/tenants/current/invites', {
      token,
    }),
  inviteMember: (token: string, payload: { email: string; billingAdmin?: boolean }) =>
    apiFetch<{ invite: TenantInvite }>('/api/tenants/current/sendinvites', {
      method: 'POST',
      token,
      body: JSON.stringify(payload),
    }),
  acceptInvite: (token: string, tokenValue: string) =>
    apiFetch<{ message: string; tenantId: string; email: string }>('/api/tenants/invites/accept', {
      method: 'POST',
      token,
      body: JSON.stringify({ token: tokenValue }),
    }).then((response) => {
      persistTenantContextId(response.tenantId);
      return response;
    }),
  acceptInviteAnonymous: (inviteToken: string) =>
    apiFetch<{ message: string; tenantId: string; email: string }>('/api/tenants/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ token: inviteToken }),
    }).then((response) => {
      persistTenantContextId(response.tenantId);
      return response;
    }),
  updateMember: (
    token: string,
    membershipId: string,
    patch: { billingAdmin?: boolean },
  ) =>
    apiFetch<{ member: TenantMember }>(`/api/tenants/current/members/${membershipId}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify(patch),
    }),
  removeMember: (token: string, membershipId: string) =>
    apiFetch<{ message: string }>(`/api/tenants/current/members/${membershipId}`, {
      method: 'DELETE',
      token,
    }),
  entitlements: (token: string) =>
    apiFetch<{ entitlements: Omit<BillingSnapshot, 'invoices'> }>('/api/tenants/current/entitlements', {
      token,
    }),
  getSecurity: (token: string) =>
    apiFetch<{ security: TenantSecurityState }>('/api/tenants/current/security', {
      token,
    }),
  createEnterpriseEnvironment: (token: string, payload: EnterpriseEnvironmentPayload) =>
    apiFetch<EnterpriseEnvironmentResponse>('/api/tenants/current/enterprise/environment', {
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
    apiFetch<{ message: string; security: TenantSecurityState }>('/api/tenants/current/security/policies', {
      method: 'PUT',
      token,
      body: JSON.stringify(payload),
    }),
  updateSecurityDomains: (token: string, domains: string[]) =>
    apiFetch<{ domains: string[]; updatedAt: string }>('/api/tenants/current/security/domains', {
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
    apiFetch<{ provider: SsoProvider }>('/api/tenants/current/security/sso/providers', {
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
    apiFetch<{ provider: SsoProvider }>(`/api/tenants/current/security/sso/providers/${providerId}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify(payload),
    }),
  removeSsoProvider: (token: string, providerId: string) =>
    apiFetch<{ message: string }>(`/api/tenants/current/security/sso/providers/${providerId}`, {
      method: 'DELETE',
      token,
    }),
  simulateSsoLogin: (token: string, email: string) =>
    apiFetch<{
      tenant: { id: string; name: string };
      provider: SsoProvider;
      user: { id: string; email: string; name: string } | null;
      membershipStatus: string | null;
    }>('/api/tenants/sso/simulate-login', {
      method: 'POST',
      token,
      body: JSON.stringify({ email }),
    }),
  getTenantAuditLogs: (
    token: string,
    query: { userId?: string; action?: string; status?: string; limit?: number } = {},
  ) => {
    const search = new URLSearchParams();
    if (query.userId) search.set('userId', query.userId);
    if (query.action) search.set('action', query.action);
    if (query.status) search.set('status', query.status);
    if (query.limit != null) search.set('limit', String(query.limit));
    const suffix = search.toString() ? `?${search.toString()}` : '';
    return apiFetch<{ logs: TenantAuditLog[] }>(`/api/tenants/current/audit-logs${suffix}`, { token });
  },
  exportTenantAuditCsv: (
    token: string,
    query: { userId?: string; action?: string; status?: string; limit?: number } = {},
  ) => {
    const search = new URLSearchParams();
    if (query.userId) search.set('userId', query.userId);
    if (query.action) search.set('action', query.action);
    if (query.status) search.set('status', query.status);
    if (query.limit != null) search.set('limit', String(query.limit));
    const suffix = search.toString() ? `?${search.toString()}` : '';
    return apiFetchText(`/api/tenants/current/audit-logs/export.csv${suffix}`, { token });
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
