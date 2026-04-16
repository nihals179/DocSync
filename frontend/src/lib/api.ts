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
  role: 'owner' | 'admin' | 'editor' | 'viewer';
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
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  billingAdmin: boolean;
  status: 'active' | 'removed';
  createdAt: string;
  updatedAt: string;
};

export type OrganizationInvite = {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  billingAdmin: boolean;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  createdAt: string;
  expiresAt: string;
  inviteToken?: string;
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
};

function getCookie(name: string) {
  const match = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : '';
}

export async function apiFetch<T = unknown>(path: string, options: FetchOptions = {}): Promise<T> {
  const { token, headers: extraHeaders, includeCsrf = false, ...rest } = options;
  const csrfToken = includeCsrf ? getCookie('docsync_csrf') : '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    ...(extraHeaders as Record<string, string>),
  };

  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers,
    credentials: 'include',
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
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
  login: (email: string, password: string, remember: boolean) =>
    apiFetch<AuthSuccess | TwoFactorPending>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, remember }),
    }),
  loginWithTwoFactor: (tempToken: string, code: string) =>
    apiFetch<AuthSuccess>('/api/auth/login/2fa', {
      method: 'POST',
      body: JSON.stringify({ tempToken, code }),
    }),
  refresh: () =>
    apiFetch<AuthSuccess>('/api/auth/refresh', {
      method: 'POST',
      includeCsrf: true,
    }),
  logout: (token: string) =>
    apiFetch<{ message: string }>('/api/auth/logout', {
      method: 'POST',
      token,
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
  inviteMember: (token: string, payload: { email: string; role: 'owner' | 'admin' | 'editor' | 'viewer'; billingAdmin?: boolean }) =>
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
    patch: { role?: 'owner' | 'admin' | 'editor' | 'viewer'; billingAdmin?: boolean },
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
};
