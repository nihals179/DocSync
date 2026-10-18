# Backend Architecture and Request Flow

Last updated: 2026-05-03

## Overview

The backend is an Express.js API organized around:

- Authentication and session security
- Organization-scoped RBAC authorization
- Entitlements and billing gates
- Document collaboration resources
- Enterprise security controls and audit logging

Current storage is in-memory (`Map` collections), which is useful for development and tests but not durable for production.

## Runtime Entry Points

- `backend/index.js`: starts the backend process.
- `backend/src/server.js`: boots app, ensures seed admin user, starts listener.
- `backend/src/app.js`: wires middleware, routes, and billing webhook worker.

## Global Middleware

`backend/src/app.js` applies:

- `cors` with frontend origin and credentials enabled
- `cookie-parser` for refresh and CSRF cookies
- `express.json()` for request bodies

## Data Layer (In-Memory Store)

`backend/src/store/index.js` holds all state in `Map`s, including:

- Identity and auth: users, sessions, auth tokens
- Tenancy: organizations, memberships, invites
- Product data: workspaces, documents, comments, versions, todos
- Billing and usage: plans, invoices, usage, webhook jobs
- Security and compliance: audit logs, organization security policies

Key helper capabilities in store:

- Tenant bootstrap (`ensureTenantBootstrapForUser`)
- Organization security policy get/update
- Plan entitlement calculation
- Quota and seat/collaborator checks

## Authentication Model

Primary auth routes are in `backend/src/routes/auth.routes.js`.

Flow:

1. Register user, then verify email.
2. Login with password (and optional 2FA challenge).
3. Create server-side session with refresh token hash and CSRF token.
4. Issue short-lived access JWT.
5. Refresh endpoint rotates refresh + CSRF tokens.

Security controls:

- Lockout after repeated failed login attempts
- 2FA setup/enable/disable and 2FA login completion
- Session listing and revocation (single/all)
- Password reset with one-time tokens
- IP allowlist checks at login, 2FA completion, refresh, and protected endpoints

Auth middleware in `backend/src/middleware/auth.js`:

- Validates bearer access JWT
- Resolves active session
- Applies inactivity timeout
- Enforces organization IP allowlist if enabled
- Attaches user/session context to request

## Authorization and Tenant Isolation

RBAC middleware (`backend/src/middleware/rbac.js`) does two things:

1. Resolves organization context (`x-organization-id`, query/body, or user default)
2. Enforces permission checks based on active membership role

Roles:

- owner
- admin
- editor
- viewer

Permission examples:

- `document.read`, `document.update`
- `organization.member.manage`
- `organization.billing.manage` (owner or billing admin)

Most protected routes follow this chain:

1. `requireAuth`
2. `resolveOrganizationContext`
3. `requirePermission(...)`
4. optional entitlements guard

## Entitlements and Billing Guards

Entitlement middleware (`backend/src/middleware/entitlements.js`):

- Attaches organization entitlement snapshot
- Blocks writes if subscription is suspended
- Enforces AI usage quota

Billing routes (`backend/src/routes/billing.routes.js`) support:

- Plan catalog and current billing snapshot
- Checkout/session simulation
- Subscription change queueing
- Seat updates
- Invoice list
- Webhook job inspection

Billing service (`backend/src/billing/service.js`) simulates provider events and processes queued webhook jobs with retry/backoff.

## Collaboration Domain Routes

Core document and collaboration resources:

- Documents: `backend/src/routes/docs.routes.js`
- Workspaces: `backend/src/routes/workspaces.routes.js`
- Comments: `backend/src/routes/comments.routes.js`
- Versions: `backend/src/routes/versions.routes.js`
- Todos: `backend/src/routes/todos.routes.js`

Behavior highlights:

- Organization-scoped access checks on every read/write
- Storage quota checks on document create/update
- Version history with restore

## Enterprise Security and Audit

Enterprise routes (`backend/src/routes/enterprise-security.routes.js`) provide:

- Security policy updates (MFA requirement, session duration, IP allowlist)
- Domain mapping management
- SSO provider CRUD (OIDC, SAML, LDAP)
- SSO simulation endpoint
- Organization audit listing and CSV export

Audit utility (`backend/src/lib/audit.js`):

- `writeAuditLog(...)`
- `listAuditLogs(...)`
- `toAuditCsv(...)`

Audit events are emitted across auth, org membership/invites, enterprise security changes, and document actions.

## AI and Grammar APIs

- AI: `backend/src/routes/ai.routes.js`
- Grammar: `backend/src/routes/grammar.routes.js`

Both are permissioned and entitlement-aware. They currently return placeholder/rule-based results and are ready to be swapped with real provider integrations.

## Request Lifecycle (Typical Protected Endpoint)

1. Client sends bearer access token.
2. Auth middleware validates token + active session.
3. RBAC resolves organization and membership.
4. Permission middleware authorizes action.
5. Entitlement checks apply (if route uses them).
6. Route handler performs org-scoped operation.
7. Optional audit event is written.
8. Response returns JSON payload.

## Production Notes

To productionize this backend, prioritize:

- Replace in-memory store with durable DB (Postgres recommended)
- Move secrets to environment/vault and rotate regularly
- Use secure admin seed strategy (no default password)
- Add distributed session/cache and queue infra
- Add stronger observability (metrics, tracing, alerting)
- Expand integration and authorization regression test coverage
