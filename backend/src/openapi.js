const bearerSecurity = [{ bearerAuth: [] }];

const tenantHeader = {
  name: 'x-tenant-id',
  in: 'header',
  required: false,
  schema: { type: 'string' },
  description: 'Optional tenant context header. The server can also fall back to the signed-in user\'s current tenant.',
};

const csrfHeader = {
  name: 'x-csrf-token',
  in: 'header',
  required: true,
  schema: { type: 'string' },
  description: 'CSRF token for refresh and session-rotation requests. Must match the session CSRF token.',
};

const sessionCookieNote = 'Send the refresh cookie (`docsync_refresh` or `docsync_admin_refresh`) and the CSRF cookie (`docsync_csrf` or `docsync_admin_csrf`) as issued by the login endpoint. For refresh requests also send `x-csrf-token`.';

function jsonResponse(example, description = 'OK', status = 200) {
  return {
    [status]: {
      description,
      content: {
        'application/json': {
          schema: { type: 'object' },
          example,
        },
      },
    },
  };
}

function textResponse(example, description = 'OK', status = 200, contentType = 'text/plain') {
  return {
    [status]: {
      description,
      content: {
        [contentType]: {
          schema: { type: 'string' },
          example,
        },
      },
    },
  };
}

function requestBody(example, schema = { type: 'object' }) {
  return {
    required: true,
    content: {
      'application/json': {
        schema,
        example,
      },
    },
  };
}

function op({
  summary,
  description = '',
  tags = [],
  parameters = [],
  requestExample,
  requestSchema,
  responseExample,
  responseStatus = 200,
  responseDescription = 'OK',
  responseContentType = 'application/json',
  security = bearerSecurity,
  extraResponses = {},
}) {
  const operation = {
    summary,
    description,
    tags,
    security,
    parameters,
    responses: {
      ...(responseContentType === 'text/plain'
        ? textResponse(responseExample, responseDescription, responseStatus, responseContentType)
        : jsonResponse(responseExample, responseDescription, responseStatus)),
      ...extraResponses,
    },
  };

  if (requestExample !== undefined) {
    operation.requestBody = requestBody(requestExample, requestSchema);
  }

  return operation;
}

const commonErrors = {
  400: jsonResponse({ error: 'Bad request.' }, 'Bad Request', 400),
  401: jsonResponse({ error: 'Unauthorized.' }, 'Unauthorized', 401),
  402: jsonResponse({ error: 'Payment required.' }, 'Payment Required', 402),
  403: jsonResponse({ error: 'Forbidden.' }, 'Forbidden', 403),
  404: jsonResponse({ error: 'Not found.' }, 'Not Found', 404),
  409: jsonResponse({ error: 'Conflict.' }, 'Conflict', 409),
  423: jsonResponse({ error: 'Locked.' }, 'Locked', 423),
  502: jsonResponse({ error: 'Upstream service unavailable.' }, 'Bad Gateway', 502),
};

const tenantRequestSchema = {
  type: 'object',
  properties: {
    tenantId: { type: 'string' },
  },
};

const authRegisterSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    email: { type: 'string', format: 'email' },
    password: { type: 'string', description: 'Plain password for local testing.' },
    passwordEncrypted: { type: 'string', description: 'Base64 RSA-OAEP encrypted password payload. If decryption fails and `password` is present, the plain password is used as fallback.' },
  },
  required: ['name', 'email'],
};

const authLoginSchema = {
  type: 'object',
  properties: {
    identifier: { type: 'string', description: 'Legacy alias for email/username.' },
    email: { type: 'string', format: 'email', description: 'Required for credential login. Optional when reusing an existing cookie session.' },
    username: { type: 'string', description: 'Optional alias for identifier matching when reusing session.' },
    password: { type: 'string', description: 'Plain password for local testing.' },
    passwordEncrypted: { type: 'string', description: 'Encrypted password payload used by UI clients. If decryption fails and `password` is present, the plain password is used as fallback.' },
    remember: { type: 'boolean', description: 'Session duration preference for credential login.' },
  },
};

const resetPasswordSchema = {
  type: 'object',
  properties: {
    token: { type: 'string' },
    password: { type: 'string' },
    passwordEncrypted: { type: 'string', description: 'Encrypted password payload. If decryption fails and `password` is present, the plain password is used as fallback.' },
  },
  required: ['token'],
};

const verifyTokenSchema = {
  type: 'object',
  properties: {
    token: { type: 'string' },
    email: { type: 'string', format: 'email' },
  },
};

const twoFactorCodeSchema = {
  type: 'object',
  properties: {
    code: { type: 'string' },
    tempToken: { type: 'string' },
  },
  required: ['code'],
};

const tenantInviteSchema = {
  type: 'object',
  properties: {
    email: { type: 'string', format: 'email' },
    billingAdmin: { type: 'boolean' },
    role: { type: 'string', description: 'Legacy compatibility field.' },
  },
  required: ['email'],
};

const profileCreateSchema = {
  type: 'object',
  properties: {
    role: { type: 'string', description: 'Unique role identifier' },
    permissions: {
      type: 'object',
      properties: {
        canAccessAdminBoard: { type: 'boolean' },
        canReviewSecurityAudit: { type: 'boolean' },
        canManageGlobalSettings: { type: 'boolean' },
        canManageMembers: { type: 'boolean' },
        canManageMemberBillingAdmin: { type: 'boolean' },
        canManageTenantBilling: { type: 'boolean' },
        canManageWorkspacesDocuments: { type: 'boolean' },
        canReadTenantResources: { type: 'boolean' },
        canUseAiGrammarByPlan: { type: 'boolean' },
        canManageBillingSettings: { type: 'boolean' },
        canViewInvoicesSubscription: { type: 'boolean' },
      },
    },
  },
  required: ['role'],
};

const securityPoliciesSchema = {
  type: 'object',
  properties: {
    requireMfa: { type: 'boolean' },
    sessionDurationHours: { type: 'number' },
    ipAllowlistEnabled: { type: 'boolean' },
    ipAllowlist: { type: 'array', items: { type: 'string' } },
  },
};

const securityDomainsSchema = {
  type: 'object',
  properties: {
    domains: { type: 'array', items: { type: 'string' } },
  },
};

const ssoProviderSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['oidc', 'saml', 'ldap'] },
    name: { type: 'string' },
    issuerUrl: { type: 'string' },
    ssoUrl: { type: 'string' },
    clientId: { type: 'string' },
    clientSecret: { type: 'string' },
    certificate: { type: 'string' },
    enabled: { type: 'boolean' },
  },
  required: ['name'],
};

const enterpriseEnvironmentSchema = {
  type: 'object',
  properties: {
    purchasedSeats: { type: 'number' },
    requireMfa: { type: 'boolean' },
    sessionDurationHours: { type: 'number' },
    ipAllowlistEnabled: { type: 'boolean' },
    ipAllowlist: { type: 'array', items: { type: 'string' } },
    domains: { type: 'array', items: { type: 'string' } },
    ssoProvider: ssoProviderSchema,
  },
};

const documentSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 255, description: 'Trimmed. Defaults to "Untitled" on create.' },
    content: { type: 'string', description: 'HTML content. Defaults to an empty string on create.' },
    workspaceId: { type: ['string', 'null'], description: 'A workspace of the current tenant (or your personal workspace) that you can see; null for no workspace. On update, moves the document and its subtree to the top level of that workspace.' },
  },
};

const documentCreateSchema = {
  ...documentSchema,
  properties: {
    ...documentSchema.properties,
    parentId: { type: ['string', 'null'], description: 'Create as a child of this document. The child takes the parent\'s workspace; workspaceId, if given, must match it.' },
  },
};

const documentMoveSchema = {
  type: 'object',
  required: ['parentId', 'index'],
  properties: {
    parentId: { type: ['string', 'null'], description: 'New parent, or null for the top level. Cannot be the document itself or one of its descendants.' },
    index: { type: 'integer', minimum: 0, description: 'Position among the new siblings (0 = first). Values past the end place the document last.' },
    workspaceId: { type: ['string', 'null'], description: 'Optional target workspace. Defaults to the parent\'s workspace, or the current one for top-level moves.' },
  },
};

const documentExample = {
  id: 'doc_1',
  title: 'Project Plan',
  content: '<p>Initial draft</p>',
  userId: 'usr_123',
  tenantId: 'ten_123',
  workspaceId: 'ws_123',
  parentId: null,
  sortOrder: 1,
  createdAt: '2026-10-30T10:00:00.000Z',
  updatedAt: '2026-10-30T10:05:00.000Z',
  preview: 'Initial draft',
};

const { content: _documentContent, ...documentSummaryExample } = documentExample;

const documentIdParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };

const commentSchema = {
  type: 'object',
  properties: {
    text: { type: 'string' },
  },
  required: ['text'],
};

const versionSchema = {
  type: 'object',
  properties: {
    content: { type: 'string' },
    preview: { type: 'string' },
  },
  required: ['content'],
};

const todoSchema = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    done: { type: 'boolean' },
  },
};

const aiChatSchema = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    docId: { type: 'string' },
    context: { type: 'string' },
  },
  required: ['message'],
};

const grammarSchema = {
  type: 'object',
  properties: {
    text: { type: 'string' },
  },
  required: ['text'],
};

const workspaceSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
  },
};

const tenantSwitchSchema = {
  type: 'object',
  properties: {
    tenantId: { type: 'string' },
    tenants: { type: 'string', description: 'Backward-compatible legacy key.' },
  },
  required: ['tenantId'],
};

const importUsersSchema = {
  type: 'object',
  properties: {
    providerId: { type: 'string' },
    users: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
        },
        required: ['email'],
      },
    },
  },
  required: ['users'],
};

const basePath = '/';

const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'DocSync Backend API',
    version: '1.0.0',
    description: 'OpenAPI specification for the DocSync backend. Tenant-scoped endpoints accept the optional `x-tenant-id` header and also fall back to the current tenant on the authenticated user. In Swagger UI, successful auth responses automatically populate bearer authorization, cache the returned CSRF token for session refresh calls, and reuse the returned current tenant as the default `x-tenant-id` header when one is not explicitly set.',
  },
  servers: [
    { url: 'http://localhost:4000', description: 'Local development server' },
  ],
  security: bearerSecurity,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    parameters: {
      tenantHeader,
      csrfHeader,
    },
  },
  paths: {
    [basePath]: {
      get: op({
        summary: 'Health check',
        tags: ['Health'],
        security: bearerSecurity,
        responseExample: 'DocSync backend running!',
        responseStatus: 200,
        responseDescription: 'Service is healthy',
        responseContentType: 'text/plain',
      }),
    },

    '/api/auth/register': {
      post: op({
        summary: 'Register a new account',
        tags: ['Auth'],
        security: bearerSecurity,
        requestExample: {
          name: 'Ava Smith',
          email: 'ava@example.com',
          password: 'Password123!',
        },
        requestSchema: authRegisterSchema,
        responseExample: {
          message: 'Account created. Verify your email to continue.',
          verificationRequired: true,
          user: {
            id: 'usr_123',
            name: 'Ava Smith',
            email: 'ava@example.com',
            emailVerified: false,
            currentTenantId: 'ten_123',
          },
          billing: {
            userId: 'usr_123',
            email: 'ava@example.com',
            planId: 'free',
            status: 'active',
          },
        },
        responseStatus: 201,
        responseDescription: 'Created',
        extraResponses: {
          400: commonErrors[400],
          409: commonErrors[409],
          500: jsonResponse({ error: 'Failed to create account. Please try again.' }, 'Server Error', 500),
        },
      }),
    },

    '/api/auth/login': {
      post: op({
        summary: 'Log in with credentials or reuse existing session',
        tags: ['Auth'],
        security: bearerSecurity,
        description: 'Two modes are supported: (1) session reuse using refresh/csrf cookies plus `x-csrf-token`; (2) credential login using `email` (or `username`) with password/passwordEncrypted. If `email` or `username` is provided during session reuse, it must match the existing session user identity. In Swagger UI, a successful response automatically authorizes the returned access token, stores the CSRF token for refresh calls, and reuses the returned `user.currentTenantId` as the default `x-tenant-id` header.',
        parameters: [{
          name: 'x-csrf-token',
          in: 'header',
          required: false,
          schema: { type: 'string' },
          description: 'Required for session-reuse mode. Must match the stored CSRF token for the refresh session cookie.',
        }],
        requestExample: {
          email: 'ava@example.com',
          password: 'Password123!',
          remember: true,
        },
        requestSchema: authLoginSchema,
        responseExample: {
          accessToken: 'eyJhbGciOi...access',
          accessTokenExpiresAt: '2026-10-19T12:00:00.000Z',
          user: {
            id: 'usr_123',
            name: 'Ava Smith',
            email: 'ava@example.com',
            emailVerified: true,
            currentTenantId: 'ten_123',
          },
          csrfToken: 'csrf_token_value',
          session: {
            id: 'ses_123',
            createdAt: '2026-10-19T11:00:00.000Z',
            lastUsedAt: '2026-10-19T11:00:00.000Z',
            expiresAt: '2026-10-19T11:15:00.000Z',
            remember: true,
            userAgent: 'PostmanRuntime/7.0',
            ipAddress: '127.0.0.1',
          },
        },
        responseDescription: 'Authenticated',
        extraResponses: {
          400: commonErrors[400],
          401: commonErrors[401],
          403: commonErrors[403],
          423: commonErrors[423],
        },
      }),
    },

    '/api/auth/verify-email': {
      post: op({
        summary: 'Verify email address',
        tags: ['Auth'],
        security: bearerSecurity,
        requestExample: { token: 'verify_token_123' },
        requestSchema: verifyTokenSchema,
        responseExample: { message: 'Email verified successfully.' },
        extraResponses: { 400: commonErrors[400], 404: commonErrors[404] },
      }),
    },

    '/api/auth/resend-verification': {
      post: op({
        summary: 'Resend verification email',
        tags: ['Auth'],
        security: bearerSecurity,
        requestExample: { email: 'ava@example.com' },
        requestSchema: { type: 'object', properties: { email: { type: 'string', format: 'email' } }, required: ['email'] },
        responseExample: { message: 'Verification email queued.' },
        extraResponses: { 400: commonErrors[400], 404: commonErrors[404] },
      }),
    },

    '/api/auth/forgot-password': {
      post: op({
        summary: 'Start password reset',
        tags: ['Auth'],
        security: bearerSecurity,
        requestExample: { email: 'ava@example.com' },
        requestSchema: { type: 'object', properties: { email: { type: 'string', format: 'email' } }, required: ['email'] },
        responseExample: { message: 'If the email exists, a reset link was sent.' },
        extraResponses: { 400: commonErrors[400] },
      }),
    },

    '/api/auth/reset-password': {
      post: op({
        summary: 'Reset password with token',
        tags: ['Auth'],
        security: bearerSecurity,
        requestExample: { token: 'reset_token_123', password: 'NewP@ssw0rd123' },
        requestSchema: resetPasswordSchema,
        responseExample: { message: 'Password updated, sign in again.' },
        extraResponses: { 400: commonErrors[400], 404: commonErrors[404] },
      }),
    },

    '/api/sessions/refresh': {
      post: op({
        summary: 'Rotate the refresh session',
        tags: ['Sessions'],
        security: bearerSecurity,
        parameters: [csrfHeader],
        description: `${sessionCookieNote} In Swagger UI, a successful response automatically refreshes the stored bearer token and CSRF token, and keeps the current tenant header in sync with the returned user context.`,
        requestExample: {},
        responseExample: {
          accessToken: 'eyJhbGciOi...rotated',
          accessTokenExpiresAt: '2026-10-19T12:15:00.000Z',
          user: { id: 'usr_123', name: 'Ava Smith', email: 'ava@example.com' },
          csrfToken: 'new_csrf_token_value',
          session: {
            id: 'ses_123',
            createdAt: '2026-10-19T11:00:00.000Z',
            lastUsedAt: '2026-10-19T11:10:00.000Z',
            expiresAt: '2026-10-19T11:25:00.000Z',
            remember: true,
            userAgent: 'PostmanRuntime/7.0',
            ipAddress: '127.0.0.1',
          },
        },
        extraResponses: { 401: commonErrors[401], 403: commonErrors[403] },
      }),
    },

    '/api/auth/refresh': {
      post: op({
        summary: 'Rotate the refresh session',
        tags: ['Sessions'],
        security: bearerSecurity,
        parameters: [csrfHeader],
        description: `${sessionCookieNote} This is the backward-compatible alias under /api/auth. In Swagger UI, a successful response automatically refreshes the stored bearer token and CSRF token, and keeps the current tenant header in sync with the returned user context.`,
        requestExample: {},
        responseExample: {
          accessToken: 'eyJhbGciOi...rotated',
          accessTokenExpiresAt: '2026-10-19T12:15:00.000Z',
          user: { id: 'usr_123', name: 'Ava Smith', email: 'ava@example.com' },
          csrfToken: 'new_csrf_token_value',
          session: {
            id: 'ses_123',
            createdAt: '2026-10-19T11:00:00.000Z',
            lastUsedAt: '2026-10-19T11:10:00.000Z',
            expiresAt: '2026-10-19T11:25:00.000Z',
            remember: true,
            userAgent: 'PostmanRuntime/7.0',
            ipAddress: '127.0.0.1',
          },
        },
        extraResponses: { 401: commonErrors[401], 403: commonErrors[403] },
      }),
    },

    '/api/sessions/logout': {
      post: op({
        summary: 'Acknowledge logout without clearing session',
        tags: ['Sessions'],
        description: 'Requires a valid bearer access token. This endpoint records logout intent but retains the current session and cookies.',
        responseExample: { message: 'Logout acknowledged. Session is retained.' },
        extraResponses: { 401: commonErrors[401] },
      }),
    },

    '/api/sessions/me': {
      get: op({
        summary: 'Get current session snapshot',
        tags: ['Sessions'],
        responseExample: {
          user: { id: 'usr_123', name: 'Ava Smith', email: 'ava@example.com' },
          session: {
            id: 'ses_123',
            createdAt: '2026-10-19T11:00:00.000Z',
            lastUsedAt: '2026-10-19T11:10:00.000Z',
            expiresAt: '2026-10-19T11:25:00.000Z',
            remember: true,
            userAgent: 'PostmanRuntime/7.0',
            ipAddress: '127.0.0.1',
          },
          csrfToken: 'csrf_token_value',
        },
      }),
    },

    '/api/sessions/allSessions': {
      get: op({
        summary: 'List active sessions',
        tags: ['Sessions'],
        responseExample: {
          sessions: [
            {
              id: 'ses_123',
              createdAt: '2026-10-19T11:00:00.000Z',
              lastUsedAt: '2026-10-19T11:10:00.000Z',
              expiresAt: '2026-10-19T11:25:00.000Z',
              remember: true,
              userAgent: 'PostmanRuntime/7.0',
              ipAddress: '127.0.0.1',
              current: true,
            },
          ],
        },
      }),
    },

    '/api/sessions/listSessions': {
      get: op({
        summary: 'List active sessions',
        tags: ['Sessions'],
        requestExample : { tenantId: 'ten_123' },
        responseExample: {
          sessions: [
            {
              id: 'ses_123',
              createdAt: '2026-10-19T11:00:00.000Z',
              lastUsedAt: '2026-10-19T11:10:00.000Z',
              expiresAt: '2026-10-19T11:25:00.000Z',
              remember: true,
              userAgent: 'PostmanRuntime/7.0',
              ipAddress: '127.0.0.1',
              current: true,
            },
          ],
        },
      }),
    },

    '/api/sessions/sessions/{sessionId}': {
      delete: op({
        summary: 'Revoke one session',
        tags: ['Sessions'],
        parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } }],
        responseExample: { message: 'Session revoked.' },
        extraResponses: { 401: commonErrors[401], 404: commonErrors[404] },
      }),
    },

    '/api/sessions/sessions/revoke-all': {
      post: op({
        summary: 'Revoke all sessions',
        tags: ['Sessions'],
        responseExample: { message: 'All sessions revoked.' },
      }),
    },

    '/api/security/login/2fa': {
      post: op({
        summary: 'Complete two-factor login',
        tags: ['Security'],
        security: bearerSecurity,
        description: 'On success, Swagger UI automatically authorizes the returned access token, stores the returned CSRF token for session refresh calls, and reuses the returned `user.currentTenantId` as the default `x-tenant-id` header.',
        requestExample: { tempToken: 'pending_2fa_token', code: '123456' },
        requestSchema: twoFactorCodeSchema,
        responseExample: {
          accessToken: 'eyJhbGciOi...access',
          accessTokenExpiresAt: '2026-10-19T12:00:00.000Z',
          user: { id: 'usr_123', name: 'Ava Smith', email: 'ava@example.com' },
          csrfToken: 'csrf_token_value',
          session: { id: 'ses_123', createdAt: '2026-10-19T11:00:00.000Z', lastUsedAt: '2026-10-19T11:00:00.000Z', expiresAt: '2026-10-19T11:25:00.000Z', remember: true, userAgent: 'PostmanRuntime/7.0', ipAddress: '127.0.0.1' },
        },
        extraResponses: { 400: commonErrors[400], 401: commonErrors[401], 403: commonErrors[403] },
      }),
    },

    '/api/security/public-key': {
      get: op({
        summary: 'Get password encryption public key',
        tags: ['Security'],
        security: bearerSecurity,
        responseExample: {
          algorithm: 'RSA-OAEP',
          hash: 'sha256',
          publicKey: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
        },
      }),
    },

    '/api/security/audit-logs': {
      get: op({
        summary: 'List personal audit logs',
        tags: ['Security'],
        responseExample: { logs: [{ id: 'log_1', action: 'login', status: 'success', createdAt: '2026-10-19T11:00:00.000Z' }] },
      }),
    },

    '/api/security/security': {
      get: op({
        summary: 'Get security snapshot for current user',
        tags: ['Security'],
        responseExample: {
          user: { id: 'usr_123', name: 'Ava Smith', email: 'ava@example.com' },
          activeSessions: 2,
        },
      }),
    },

    '/api/security/2fa/setup': {
      post: op({
        summary: 'Start 2FA setup',
        tags: ['Security'],
        responseExample: {
          secret: 'JBSWY3DPEHPK3PXP',
          otpauth: 'otpauth://totp/DocSync:ava@example.com?secret=JBSWY3DPEHPK3PXP&issuer=DocSync',
          qrDataUrl: 'data:image/png;base64,...',
        },
      }),
    },

    '/api/security/2fa/enable': {
      post: op({
        summary: 'Enable 2FA',
        tags: ['Security'],
        requestExample: { code: '123456' },
        requestSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
        responseExample: { message: 'Two-factor authentication enabled.', user: { id: 'usr_123', name: 'Ava Smith', email: 'ava@example.com' } },
      }),
    },

    '/api/security/2fa/disable': {
      post: op({
        summary: 'Disable 2FA',
        tags: ['Security'],
        requestExample: { code: '123456' },
        requestSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
        responseExample: { message: 'Two-factor authentication disabled.', user: { id: 'usr_123', name: 'Ava Smith', email: 'ava@example.com' } },
      }),
    },

    '/api/tenants/mine': {
      get: op({
        summary: 'List current user tenants',
        tags: ['Tenants'],
        responseExample: { tenants: [{ id: 'ten_123', name: 'Acme', ownerUserId: 'usr_123' }], currentTenantId: 'ten_123' },
      }),
    },

    '/api/tenants/profiles': {
      get: op({
        summary: 'Get tenant profile table',
        tags: ['Tenants'],
        parameters: [tenantHeader],
        responseExample: { profiles: [{ id: 'prof_1', role: 'owner', canManageMembers: true }] },
      }),
      post: op({
        summary: 'Create a new profile',
        tags: ['Tenants'],
        parameters: [tenantHeader],
        requestExample: {
          role: 'editor',
          permissions: {
            canManageMembers: false,
            canManageWorkspacesDocuments: true,
            canReadTenantResources: true,
            canAccessAdminBoard: false,
            canReviewSecurityAudit: false,
            canManageGlobalSettings: false,
            canManageMemberBillingAdmin: false,
            canManageTenantBilling: false,
            canUseAiGrammarByPlan: false,
            canManageBillingSettings: false,
            canViewInvoicesSubscription: false,
          },
        },
        requestSchema: profileCreateSchema,
        responseExample: {
          message: 'Profile created.',
          profile: {
            id: 'editor',
            role: 'editor',
            canAccessAdminBoard: false,
            canManageMembers: false,
            canManageWorkspacesDocuments: true,
            canReadTenantResources: true,
            canReviewSecurityAudit: false,
            canManageGlobalSettings: false,
            canManageMemberBillingAdmin: false,
            canManageTenantBilling: false,
            canUseAiGrammarByPlan: false,
            canManageBillingSettings: false,
            canViewInvoicesSubscription: false,
          },
        },
        responseStatus: 201,
        responseDescription: 'Created',
        extraResponses: { 400: commonErrors[400], 409: commonErrors[409] },
      }),
    },

    '/api/tenants/profiles/{role}': {
      delete: op({
        summary: 'Delete a profile',
        tags: ['Tenants'],
        parameters: [{ name: 'role', in: 'path', required: true, schema: { type: 'string' } }, tenantHeader],
        responseExample: { message: 'Profile deleted.', role: 'editor' },
        extraResponses: { 404: commonErrors[404] },
      }),
    },

    '/api/tenants/switch': {
      post: op({
        summary: 'Switch current tenant',
        tags: ['Tenants'],
        requestExample: { tenantId: 'ten_123' },
        requestSchema: tenantSwitchSchema,
        responseExample: { message: 'Tenant context updated.', tenantId: 'ten_123' },
        extraResponses: { 400: commonErrors[400], 403: commonErrors[403], 404: commonErrors[404] },
      }),
    },

    '/api/tenants/current': {
      get: op({
        summary: 'Get current tenant context',
        tags: ['Tenants'],
        parameters: [tenantHeader],
        responseExample: {
          tenant: { id: 'ten_123', name: 'Acme', ownerUserId: 'usr_123' },
          membership: { id: 'mem_123', tenantId: 'ten_123', userId: 'usr_123', billingAdmin: true, status: 'active' },
        },
      }),
    },

    '/api/tenants/current/members': {
      get: op({
        summary: 'List active tenant members',
        tags: ['Tenants'],
        parameters: [tenantHeader],
        responseExample: { members: [{ id: 'mem_123', userId: 'usr_123', email: 'ava@example.com', name: 'Ava', billingAdmin: true, status: 'active' }] },
      }),
    },

    '/api/tenants/current/invites': {
      get: op({
        summary: 'List pending tenant invites',
        tags: ['Tenants'],
        parameters: [tenantHeader],
        responseExample: { invites: [{ id: 'inv_123', email: 'bob@example.com', role: 'tenant_member', billingAdmin: false, status: 'pending', createdAt: '2026-10-19T11:00:00.000Z', expiresAt: '2026-10-26T11:00:00.000Z' }] },
      }),
    },

    '/api/tenants/current/sendinvites': {
      post: op({
        summary: 'Create tenant invite',
        tags: ['Tenants'],
        parameters: [tenantHeader],
        requestExample: { email: 'bob@example.com', billingAdmin: true },
        requestSchema: tenantInviteSchema,
        responseExample: { invite: { id: 'inv_123', email: 'bob@example.com', role: 'tenant_member', billingAdmin: true, status: 'pending', createdAt: '2026-10-19T11:00:00.000Z', expiresAt: '2026-10-26T11:00:00.000Z' } },
        responseStatus: 201,
        responseDescription: 'Created',
        extraResponses: { 400: commonErrors[400], 402: commonErrors[402], 409: commonErrors[409] },
      }),
    },

    '/api/tenants/invites/accept': {
      post: op({
        summary: 'Accept a tenant invite',
        tags: ['Tenants'],
        security: bearerSecurity,
        requestExample: { token: 'invite_token_123' },
        requestSchema: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'] },
        responseExample: { message: 'Tenant invite accepted.', tenantId: 'ten_123' },
        extraResponses: { 400: commonErrors[400], 403: commonErrors[403], 404: commonErrors[404], 402: commonErrors[402], 500: jsonResponse({ error: 'Invite accepted, but workspace provisioning failed.' }, 'Server Error', 500) },
      }),
    },

    '/api/tenants/current/members/{membershipId}': {
      patch: op({
        summary: 'Update member billing admin flag',
        tags: ['Tenants'],
        parameters: [{ name: 'membershipId', in: 'path', required: true, schema: { type: 'string' } }, tenantHeader],
        requestExample: { billingAdmin: true },
        requestSchema: { type: 'object', properties: { billingAdmin: { type: 'boolean' } } },
        responseExample: { member: { id: 'mem_123', userId: 'usr_123', email: 'ava@example.com', name: 'Ava', billingAdmin: true, status: 'active' } },
        extraResponses: { 400: commonErrors[400], 403: commonErrors[403], 404: commonErrors[404] },
      }),
      delete: op({
        summary: 'Remove a tenant member',
        tags: ['Tenants'],
        parameters: [{ name: 'membershipId', in: 'path', required: true, schema: { type: 'string' } }, tenantHeader],
        responseExample: { message: 'Member removed.' },
        extraResponses: { 403: commonErrors[403], 404: commonErrors[404] },
      }),
    },

    '/api/tenants/current/entitlements': {
      get: op({
        summary: 'Get tenant entitlements',
        tags: ['Tenants'],
        parameters: [tenantHeader],
        responseExample: {
          entitlements: {
            billing: { planId: 'pro', status: 'active', purchasedSeats: 10 },
            plan: { id: 'pro', name: 'Pro' },
            limits: { seatsPurchased: 10, storageBytes: 1000000, aiRequestsPerMonth: 1000, collaborators: 10 },
            usage: { monthKey: '2026-10', aiRequests: 12, documentUpdates: 4, assignedSeats: 3, storageUsedBytes: 12345, collaboratorsAssigned: 3 },
          },
        },
      }),
    },

    '/api/tenants/current/security': {
      get: op({
        summary: 'Get tenant security settings',
        tags: ['Enterprise Security'],
        parameters: [tenantHeader],
        responseExample: {
          security: {
            requireMfa: true,
            sessionDurationHours: 8,
            ipAllowlistEnabled: false,
            ipAllowlist: [],
            domainMappings: ['example.com'],
            ssoProviders: [],
            updatedAt: '2026-10-19T11:00:00.000Z',
          },
        },
      }),
    },

    '/api/tenants/current/enterprise/environment': {
      post: op({
        summary: 'Initialize enterprise tenant environment',
        tags: ['Enterprise Security'],
        parameters: [tenantHeader],
        requestExample: {
          purchasedSeats: 25,
          requireMfa: true,
          sessionDurationHours: 8,
          ipAllowlistEnabled: true,
          ipAllowlist: ['127.0.0.1'],
          domains: ['example.com'],
          ssoProvider: { type: 'oidc', name: 'Okta', issuerUrl: 'https://example.okta.com', clientId: 'client-id', clientSecret: 'client-secret', enabled: true },
        },
        requestSchema: enterpriseEnvironmentSchema,
        responseExample: {
          message: 'Enterprise environment initialized.',
          tenant: { id: 'ten_123', name: 'Acme' },
          billing: { planId: 'enterprise', status: 'active', purchasedSeats: 25 },
          security: { requireMfa: true, sessionDurationHours: 8, ipAllowlistEnabled: true, ipAllowlist: ['127.0.0.1'], domainMappings: ['example.com'], ssoProviders: [] },
          entitlements: { billing: { planId: 'enterprise', purchasedSeats: 25 } },
        },
        responseStatus: 201,
        responseDescription: 'Created',
      }),
    },

    '/api/tenants/current/security/policies': {
      put: op({
        summary: 'Update tenant security policies',
        tags: ['Enterprise Security'],
        parameters: [tenantHeader],
        requestExample: { requireMfa: true, sessionDurationHours: 8, ipAllowlistEnabled: true, ipAllowlist: ['127.0.0.1'] },
        requestSchema: securityPoliciesSchema,
        responseExample: { message: 'Security policies updated.', security: { requireMfa: true, sessionDurationHours: 8, ipAllowlistEnabled: true, ipAllowlist: ['127.0.0.1'], domainMappings: [], ssoProviders: [] } },
      }),
    },

    '/api/tenants/current/security/domains': {
      put: op({
        summary: 'Replace allowed email domains',
        tags: ['Enterprise Security'],
        parameters: [tenantHeader],
        requestExample: { domains: ['example.com', 'acme.com'] },
        requestSchema: securityDomainsSchema,
        responseExample: { domains: ['example.com', 'acme.com'], updatedAt: '2026-10-19T11:00:00.000Z' },
      }),
    },

    '/api/tenants/current/security/sso/providers': {
      post: op({
        summary: 'Create SSO provider',
        tags: ['Enterprise Security'],
        parameters: [tenantHeader],
        requestExample: { type: 'oidc', name: 'Okta', issuerUrl: 'https://example.okta.com', clientId: 'client-id', clientSecret: 'client-secret', enabled: true },
        requestSchema: ssoProviderSchema,
        responseExample: { provider: { id: 'sso_123', type: 'oidc', name: 'Okta', issuerUrl: 'https://example.okta.com', enabled: true } },
        responseStatus: 201,
        responseDescription: 'Created',
      }),
    },

    '/api/tenants/current/security/sso/providers/{providerId}': {
      patch: op({
        summary: 'Update SSO provider',
        tags: ['Enterprise Security'],
        parameters: [{ name: 'providerId', in: 'path', required: true, schema: { type: 'string' } }, tenantHeader],
        requestExample: { name: 'Okta (Updated)', enabled: true },
        requestSchema: ssoProviderSchema,
        responseExample: { provider: { id: 'sso_123', type: 'oidc', name: 'Okta (Updated)', enabled: true } },
      }),
      delete: op({
        summary: 'Delete SSO provider',
        tags: ['Enterprise Security'],
        parameters: [{ name: 'providerId', in: 'path', required: true, schema: { type: 'string' } }, tenantHeader],
        responseExample: { message: 'SSO provider removed.' },
      }),
    },

    '/api/tenants/sso/simulate-login': {
      post: op({
        summary: 'Simulate SSO login by email domain',
        tags: ['Enterprise Security'],
        parameters: [tenantHeader],
        requestExample: { email: 'user@example.com' },
        requestSchema: { type: 'object', properties: { email: { type: 'string', format: 'email' } }, required: ['email'] },
        responseExample: { tenant: { id: 'ten_123', name: 'Acme' }, provider: { id: 'sso_123', type: 'oidc', name: 'Okta', enabled: true }, user: { id: 'usr_123', email: 'user@example.com', name: 'User' }, membershipStatus: 'active' },
      }),
    },

    '/api/tenants/current/security/ldap/import-users': {
      post: op({
        summary: 'Import LDAP users',
        tags: ['Enterprise Security'],
        parameters: [tenantHeader],
        requestExample: { providerId: 'sso_ldap_1', users: [{ email: 'alice@example.com', name: 'Alice' }, { email: 'bob@example.com', name: 'Bob' }] },
        requestSchema: importUsersSchema,
        responseExample: { providerId: 'sso_ldap_1', imported: [{ email: 'alice@example.com', userId: 'usr_1' }], skipped: [], failed: [] },
      }),
    },

    '/api/tenants/current/audit-logs': {
      get: op({
        summary: 'List tenant audit logs',
        tags: ['Enterprise Security'],
        parameters: [tenantHeader],
        responseExample: { logs: [{ id: 'log_1', action: 'tenant.security.policies.update', status: 'success', createdAt: '2026-10-19T11:00:00.000Z' }] },
      }),
    },

    '/api/tenants/current/audit-logs/export.csv': {
      get: op({
        summary: 'Export tenant audit logs as CSV',
        tags: ['Enterprise Security'],
        parameters: [tenantHeader],
        responseExample: 'id,action,status,createdAt\nlog_1,tenant.security.policies.update,success,2026-10-19T11:00:00.000Z',
        responseContentType: 'text/csv',
        responseDescription: 'CSV export',
      }),
    },

    '/api/billing/plans': {
      get: op({
        summary: 'List billing plans',
        tags: ['Billing'],
        parameters: [tenantHeader],
        responseExample: { plans: [{ id: 'free', name: 'Free', priceMonthlyCents: 0 }, { id: 'pro', name: 'Pro', priceMonthlyCents: 2000 }] },
      }),
    },

    '/api/billing/current': {
      get: op({
        summary: 'Get current billing snapshot',
        tags: ['Billing'],
        parameters: [tenantHeader],
        responseExample: { snapshot: { billing: { planId: 'pro', status: 'active', purchasedSeats: 10 }, plan: { id: 'pro', name: 'Pro' }, limits: { seatsPurchased: 10 }, usage: { monthKey: '2026-10', aiRequests: 12, documentUpdates: 4 } } },
      }),
    },

    '/api/billing/invoices': {
      get: op({
        summary: 'List tenant invoices',
        tags: ['Billing'],
        parameters: [tenantHeader],
        responseExample: { invoices: [{ id: 'inv_123', tenantId: 'ten_123', amountCents: 2000, currency: 'usd', status: 'open' }] },
      }),
    },

    '/api/billing/checkout': {
      post: op({
        summary: 'Create checkout session',
        tags: ['Billing'],
        parameters: [tenantHeader],
        requestExample: { planId: 'pro', purchasedSeats: 5, successUrl: 'https://app.example.com/success', cancelUrl: 'https://app.example.com/cancel' },
        requestSchema: { type: 'object', properties: { planId: { type: 'string' }, purchasedSeats: { type: 'number' }, successUrl: { type: 'string' }, cancelUrl: { type: 'string' } } },
        responseExample: { checkoutSession: { id: 'cs_mock_123', provider: 'mock', checkoutUrl: 'https://billing.local/checkout/ten_123', cancelUrl: 'https://billing.local/cancel/ten_123' }, currentPlanId: 'pro', note: 'Mock checkout session created locally.' },
      }),
    },

    '/api/billing/subscription/change': {
      post: op({
        summary: 'Change subscription plan',
        tags: ['Billing'],
        parameters: [tenantHeader],
        requestExample: { planId: 'team' },
        requestSchema: { type: 'object', properties: { planId: { type: 'string' } }, required: ['planId'] },
        responseExample: { message: 'Subscription changed to team.', eventId: 'evt_mock_123' },
      }),
    },

    '/api/billing/seats': {
      patch: op({
        summary: 'Update purchased seat count',
        tags: ['Billing'],
        parameters: [tenantHeader],
        requestExample: { purchasedSeats: 15 },
        requestSchema: { type: 'object', properties: { purchasedSeats: { type: 'number' } }, required: ['purchasedSeats'] },
        responseExample: { message: 'Seats updated.', purchasedSeats: 15, assignedSeats: 3 },
      }),
    },

    '/api/billing/webhooks/jobs': {
      get: op({
        summary: 'List webhook jobs',
        tags: ['Billing'],
        parameters: [tenantHeader],
        responseExample: { jobs: [{ id: 'job_1', eventId: 'evt_1', provider: 'mock', type: 'invoice.paid', status: 'queued' }] },
      }),
    },

    '/api/billing/webhooks/provider': {
      post: op({
        summary: 'Receive billing provider webhook',
        tags: ['Billing'],
        security: bearerSecurity,
        requestExample: { id: 'evt_123', type: 'invoice.paid', data: { tenantId: 'ten_123', amountCents: 2000 } },
        requestSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            data: { type: 'object' },
          },
          required: ['id', 'type'],
        },
        responseExample: { received: true, eventId: 'evt_123', skipped: false },
        responseStatus: 202,
        responseDescription: 'Accepted',
      }),
    },

    '/api/docs': {
      get: op({
        summary: 'List documents',
        description: 'Lists every document in the current tenant, most recently updated first. Content is not included; `preview` holds the first 100 characters of plain text. Build the chapter tree from `parentId` and order siblings by `sortOrder` (ascending).',
        tags: ['Documents'],
        parameters: [tenantHeader],
        responseExample: { docs: [documentSummaryExample] },
        extraResponses: { 401: commonErrors[401], 403: commonErrors[403] },
      }),
      post: op({
        summary: 'Create document',
        description: 'Creates a document at the top of its sibling list, optionally as a child of `parentId`. Fails with 402 when the plan\'s document count or storage limit would be exceeded.',
        tags: ['Documents'],
        parameters: [tenantHeader],
        requestExample: { title: 'Project Plan', content: '<p>Initial draft</p>', workspaceId: 'ws_123', parentId: null },
        requestSchema: documentCreateSchema,
        responseExample: { doc: documentExample },
        responseStatus: 201,
        responseDescription: 'Created',
        extraResponses: {
          400: jsonResponse({ error: 'Invalid parentId.' }, 'Invalid body, workspace or parent', 400),
          401: commonErrors[401],
          402: jsonResponse({ error: 'Document limit reached (25/25) for Free plan.', code: 'document_limit_exceeded' }, 'Plan limit reached (document_limit_exceeded, storage_quota_exceeded) or subscription inactive', 402),
          403: commonErrors[403],
        },
      }),
    },

    '/api/docs/{id}': {
      get: op({
        summary: 'Get one document',
        tags: ['Documents'],
        parameters: [documentIdParam, tenantHeader],
        responseExample: { doc: documentExample },
        extraResponses: { 401: commonErrors[401], 403: commonErrors[403], 404: jsonResponse({ error: 'Document not found.' }, 'Not Found', 404) },
      }),
      put: op({
        summary: 'Update document',
        description: 'Updates any of title, content and workspaceId. Only title/content changes count toward the monthly document update limit; a request that changes nothing returns the document unchanged.',
        tags: ['Documents'],
        parameters: [documentIdParam, tenantHeader],
        requestExample: { title: 'Project Plan v2', content: '<p>Updated draft</p>', workspaceId: 'ws_123' },
        requestSchema: documentSchema,
        responseExample: { doc: { ...documentExample, title: 'Project Plan v2', content: '<p>Updated draft</p>', preview: 'Updated draft' } },
        extraResponses: {
          400: jsonResponse({ error: 'title cannot be empty.' }, 'Invalid body or workspace', 400),
          401: commonErrors[401],
          402: jsonResponse({ error: 'Document update limit reached (100/100) for Free plan.', code: 'document_update_limit_exceeded' }, 'Plan limit reached (document_update_limit_exceeded, storage_quota_exceeded) or subscription inactive', 402),
          403: commonErrors[403],
          404: jsonResponse({ error: 'Document not found.' }, 'Not Found', 404),
        },
      }),
      delete: op({
        summary: 'Delete document',
        description: 'Deletes the document and its whole subtree (all descendants), together with their comments and saved versions. `deletedCount` is the number of documents removed.',
        tags: ['Documents'],
        parameters: [documentIdParam, tenantHeader],
        responseExample: { message: 'Document deleted.', deletedCount: 3 },
        extraResponses: { 401: commonErrors[401], 402: commonErrors[402], 403: commonErrors[403], 404: jsonResponse({ error: 'Document not found.' }, 'Not Found', 404) },
      }),
    },

    '/api/docs/{id}/move': {
      post: op({
        summary: 'Move document in the chapter tree',
        description: 'Moves the document, with its subtree, under `parentId` (or to the top level) at position `index` among its new siblings, optionally into another workspace. Both sibling lists are renumbered. Does not count toward the monthly document update limit and does not change `updatedAt`.',
        tags: ['Documents'],
        parameters: [documentIdParam, tenantHeader],
        requestExample: { parentId: 'doc_2', index: 0 },
        requestSchema: documentMoveSchema,
        responseExample: { doc: { ...documentExample, parentId: 'doc_2', sortOrder: 1 } },
        extraResponses: {
          400: jsonResponse({ error: 'Cannot move a document inside itself.' }, 'Invalid body, workspace or parent (including moves into the document\'s own subtree)', 400),
          401: commonErrors[401],
          402: commonErrors[402],
          403: commonErrors[403],
          404: jsonResponse({ error: 'Document not found.' }, 'Not Found', 404),
        },
      }),
    },

    '/api/editor/{docId}/bootstrap': {
      get: op({
        summary: 'Bootstrap editor data for a document',
        tags: ['Editor'],
        parameters: [{ name: 'docId', in: 'path', required: true, schema: { type: 'string' } }, tenantHeader],
        responseExample: {
          doc: { id: 'doc_1', title: 'Project Plan', content: 'Initial draft', preview: 'Initial draft' },
          versions: [{ id: 'ver_1', preview: 'Initial draft', savedAt: '2026-10-19T11:00:00.000Z' }],
          docs: [{ id: 'doc_1', title: 'Project Plan' }],
          workspaces: [{ id: 'ws_123', name: 'Workspace', ownerId: 'usr_123' }],
        },
      }),
    },

    '/api/workspaces': {
      get: op({
        summary: 'List workspaces',
        tags: ['Workspaces'],
        parameters: [tenantHeader],
        responseExample: { workspaces: [{ id: 'ws_123', name: 'Workspace', ownerId: 'usr_123', tenantId: 'ten_123' }] },
      }),
      post: op({
        summary: 'Create workspace',
        tags: ['Workspaces'],
        parameters: [tenantHeader],
        requestExample: { name: 'Design Team' },
        requestSchema: workspaceSchema,
        responseExample: { workspace: { id: 'ws_123', name: 'Design Team', ownerId: 'usr_123', tenantId: 'ten_123' } },
        responseStatus: 201,
        responseDescription: 'Created',
        extraResponses: { 402: commonErrors[402] },
      }),
    },

    '/api/workspaces/{workspaceId}': {
      delete: op({
        summary: 'Delete workspace',
        tags: ['Workspaces'],
        parameters: [{ name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } }, tenantHeader],
        responseExample: { message: 'Workspace deleted.' },
      }),
    },

    '/api/templates': {
      get: op({
        summary: 'List templates',
        tags: ['Templates'],
        parameters: [tenantHeader],
        responseExample: { templates: [{ id: 'tpl_1', title: 'Case Study', description: 'Example template', icon: 'template', content: '<h1>Case Study</h1>' }] },
      }),
    },

    '/api/docs/{docId}/comments': {
      get: op({
        summary: 'List document comments',
        tags: ['Comments'],
        parameters: [{ name: 'docId', in: 'path', required: true, schema: { type: 'string' } }, tenantHeader],
        responseExample: { comments: [{ id: 'com_1', text: 'Looks good', userId: 'usr_123', userName: 'Ava', createdAt: '2026-10-19T11:00:00.000Z' }] },
      }),
      post: op({
        summary: 'Create a comment',
        tags: ['Comments'],
        parameters: [{ name: 'docId', in: 'path', required: true, schema: { type: 'string' } }, tenantHeader],
        requestExample: { text: 'Looks good' },
        requestSchema: commentSchema,
        responseExample: { comment: { id: 'com_1', text: 'Looks good', userId: 'usr_123', userName: 'Ava', createdAt: '2026-10-19T11:00:00.000Z' } },
        responseStatus: 201,
        responseDescription: 'Created',
      }),
    },

    '/api/docs/{docId}/comments/{commentId}': {
      delete: op({
        summary: 'Delete comment',
        tags: ['Comments'],
        parameters: [
          { name: 'docId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'commentId', in: 'path', required: true, schema: { type: 'string' } },
          tenantHeader,
        ],
        responseExample: { message: 'Comment deleted.' },
      }),
    },

    '/api/docs/{docId}/versions': {
      get: op({
        summary: 'List retained versions',
        tags: ['Versions'],
        parameters: [{ name: 'docId', in: 'path', required: true, schema: { type: 'string' } }, tenantHeader],
        responseExample: { versions: [{ id: 'ver_1', preview: 'Initial draft', savedAt: '2026-10-19T11:00:00.000Z' }] },
      }),
      post: op({
        summary: 'Save a new document version',
        tags: ['Versions'],
        parameters: [{ name: 'docId', in: 'path', required: true, schema: { type: 'string' } }, tenantHeader],
        requestExample: { preview: 'Initial draft', content: 'Initial draft' },
        requestSchema: versionSchema,
        responseExample: { version: { id: 'ver_1', preview: 'Initial draft', savedAt: '2026-10-19T11:00:00.000Z' } },
        responseStatus: 201,
        responseDescription: 'Created',
      }),
    },

    '/api/versions/all': {
      get: op({
        summary: 'List all retained versions in tenant with filters',
        tags: ['Versions'],
        parameters: [
          tenantHeader,
          { name: 'workspaceId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'docId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'userId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'q', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 500, default: 200 } },
        ],
        responseExample: {
          versions: [
            {
              id: 'ver_1',
              docId: 'doc_1',
              workspaceId: 'ws_1',
              userId: 'usr_123',
              docTitle: 'Project Plan',
              preview: 'Initial draft',
              savedAt: '2026-10-19T11:00:00.000Z',
            },
          ],
        },
      }),
    },

    '/api/docs/{docId}/versions/{versionId}/restore': {
      post: op({
        summary: 'Restore a document version',
        tags: ['Versions'],
        parameters: [
          { name: 'docId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'versionId', in: 'path', required: true, schema: { type: 'string' } },
          tenantHeader,
        ],
        responseExample: { doc: { id: 'doc_1', title: 'Project Plan', content: 'Restored content' } },
      }),
    },

    '/api/docs/{docId}/versions/{versionId}': {
      delete: op({
        summary: 'Delete a version',
        tags: ['Versions'],
        parameters: [
          { name: 'docId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'versionId', in: 'path', required: true, schema: { type: 'string' } },
          tenantHeader,
        ],
        responseExample: { message: 'Version deleted.' },
      }),
    },

    '/api/docs/{docId}/todos': {
      get: op({
        summary: 'List document todos',
        tags: ['Todos'],
        parameters: [{ name: 'docId', in: 'path', required: true, schema: { type: 'string' } }, tenantHeader],
        responseExample: { todos: [{ id: 'todo_1', text: 'Review intro', done: false }] },
      }),
      post: op({
        summary: 'Create a todo',
        tags: ['Todos'],
        parameters: [{ name: 'docId', in: 'path', required: true, schema: { type: 'string' } }, tenantHeader],
        requestExample: { text: 'Review intro' },
        requestSchema: todoSchema,
        responseExample: { todo: { id: 'todo_1', text: 'Review intro', done: false } },
        responseStatus: 201,
        responseDescription: 'Created',
      }),
    },

    '/api/docs/{docId}/todos/{todoId}': {
      put: op({
        summary: 'Update a todo',
        tags: ['Todos'],
        parameters: [
          { name: 'docId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'todoId', in: 'path', required: true, schema: { type: 'string' } },
          tenantHeader,
        ],
        requestExample: { done: true, text: 'Review intro' },
        requestSchema: todoSchema,
        responseExample: { todo: { id: 'todo_1', text: 'Review intro', done: true } },
      }),
      delete: op({
        summary: 'Delete a todo',
        tags: ['Todos'],
        parameters: [
          { name: 'docId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'todoId', in: 'path', required: true, schema: { type: 'string' } },
          tenantHeader,
        ],
        responseExample: { message: 'Todo deleted.' },
      }),
    },

    '/api/ai/chat': {
      post: op({
        summary: 'Chat with AI placeholder',
        tags: ['AI'],
        parameters: [tenantHeader],
        requestExample: { message: 'Summarize this document', docId: 'doc_1', context: 'Document content' },
        requestSchema: aiChatSchema,
        responseExample: { response: '[AI placeholder] You asked: "Summarize this document" (with document context). Connect an LLM API key to enable real responses.' },
      }),
    },

    '/api/grammar/check': {
      post: op({
        summary: 'Check grammar and spelling',
        tags: ['Grammar'],
        parameters: [tenantHeader],
        requestExample: { text: 'Teh quick brown fox.' },
        requestSchema: grammarSchema,
        responseExample: { issues: [{ id: 1, type: 'spelling', text: 'Teh', suggestion: 'The' }] },
      }),
    },

    '/api/users/me': {
      delete: op({
        summary: 'Delete own account',
        tags: ['Users'],
        description: 'Allows authenticated users to delete their own account. Requires password confirmation for security. All related data is deleted except documents, comments, and versions which are preserved.',
        requestExample: { confirmPassword: 'user_password_here' },
        requestSchema: {
          type: 'object',
          properties: {
            confirmPassword: { type: 'string', description: 'Current password for confirmation' },
          },
          required: ['confirmPassword'],
        },
        responseExample: {
          message: 'User account successfully deleted.',
          deletionDetails: {
            userDeleted: true,
            relationsDeleted: {
              authSessions: 5,
              userBilling: 1,
              userUsage: 12,
              tenantMemberships: 1,
              tenantsInvite: 0,
              auditLogs: 25,
            },
          },
        },
        responseStatus: 200,
        responseDescription: 'Account deleted successfully',
        extraResponses: {
          400: commonErrors[400],
          401: commonErrors[401],
          404: commonErrors[404],
          500: jsonResponse({ error: 'Failed to delete user account. Please try again.' }, 'Server Error', 500),
        },
      }),
    },

    '/api/users/{userId}': {
      delete: op({
        summary: 'Delete user account (admin)',
        tags: ['Users'],
        description: 'Allows admins to delete any user account. Non-admin users can only delete their own account (userId must match authenticated user). All related data is deleted except documents, comments, and versions which are preserved.',
        parameters: [
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' }, description: 'The ID of the user to delete' },
        ],
        responseExample: {
          message: 'User account successfully deleted.',
          deletionDetails: {
            userDeleted: true,
            relationsDeleted: {
              authSessions: 3,
              userBilling: 1,
              userUsage: 8,
              tenantMemberships: 1,
              tenantsInvite: 2,
              auditLogs: 18,
            },
          },
        },
        responseStatus: 200,
        responseDescription: 'Account deleted successfully',
        extraResponses: {
          403: commonErrors[403],
          404: commonErrors[404],
          500: jsonResponse({ error: 'Failed to delete user account. Please try again.' }, 'Server Error', 500),
        },
      }),
    },
  },
};

module.exports = openapi;
