# Phase 4: Enterprise Access Controls (Week 12-14)

Last updated: 2026-04-28

This document maps each Phase 4 requirement to the current implementation in backend and frontend.

## 1) SSO (OIDC/SAML/LDAP)

Backend APIs:
- GET /api/organizations/current/security
- POST /api/organizations/current/security/sso/providers
- PATCH /api/organizations/current/security/sso/providers/:providerId
- DELETE /api/organizations/current/security/sso/providers/:providerId
- POST /api/organizations/sso/simulate-login

Behavior:
- Stores multiple provider records per organization.
- Supports provider types: oidc, saml, and ldap.
- Provider records include name, endpoint metadata, and enabled flag.
- Domain routing simulation resolves organization by email domain and returns active provider.

Primary backend code:
- backend/src/routes/enterprise-security.routes.js
- backend/src/store/index.js

Frontend UI:
- /enterprise-security page includes provider creation, enable/disable, and deletion.
- Domain routing simulation UI and result preview.

Primary frontend code:
- frontend/src/components/pages/EnterpriseSecuritySettingsPage.tsx
- frontend/src/lib/api.ts

## 2) Domain-Based Organization Mapping

Implementation:
- Organization security state stores domainMappings.
- Domain normalization removes @ prefix and lowercases values.
- Registration flow auto-associates users to mapped organization when email domain matches.

Primary backend code:
- backend/src/routes/enterprise-security.routes.js
- backend/src/store/index.js
- backend/src/routes/auth.routes.js

## 3) Advanced Controls

### MFA enforcement policies
- Configurable org policy requireMfa.
- Login is denied when organization requires MFA but user has not enabled personal 2FA.
- For orgs with an active SSO provider, MFA is expected to be enforced by the IdP (local MFA gate is skipped).

### Session duration policies
- Configurable org policy sessionDurationHours (1-24).
- Session expiration uses org-defined duration for login and refresh rotation.

### Optional IP allowlist
- Configurable org policy ipAllowlistEnabled + ipAllowlist list.
- Enforcement points:
  - Login
  - Login 2FA completion
  - Refresh session
  - Authenticated API requests (Bearer token)

Primary backend code:
- backend/src/routes/enterprise-security.routes.js
- backend/src/routes/auth.routes.js
- backend/src/middleware/auth.js

## 4) Full Audit Logging

### Login events
Captured events include:
- login success/failure
- login-2fa success/failure
- login-mfa-policy failure
- login-ip-policy failure
- session-refresh and refresh ip policy failure
- logout and session revoke actions

### Role/permission changes
Captured events include:
- organization.member.role.update
- organization.member.remove
- organization.invite.create
- organization.invite.accept

### Sharing/access actions
Captured events include:
- document.list
- document.read
- document.create
- document.update
- document.delete

Primary backend code:
- backend/src/routes/auth.routes.js
- backend/src/routes/organizations.routes.js
- backend/src/routes/docs.routes.js
- backend/src/lib/audit.js

### Export audit logs (CSV)
- GET /api/organizations/current/audit-logs/export.csv
- CSV includes id, createdAt, organizationId, userId, action, status, metadata

Primary backend code:
- backend/src/routes/enterprise-security.routes.js
- backend/src/lib/audit.js

## Deliverables Status

1. Enterprise security settings page
- Implemented at /enterprise-security

2. SSO setup docs for customers
- Implemented in backend/docs/SSO_SETUP.md

3. Admin audit console
- Implemented at /organization-audit
- Includes filterable timeline and CSV export

Primary frontend code:
- frontend/src/components/pages/OrganizationAuditConsolePage.tsx
- frontend/src/App.tsx
- frontend/src/lib/api.ts

## Test Coverage

Enterprise security and policy tests:
- backend/test/enterprise-security.test.js

Covers:
- SSO provider and domain mapping flows
- CSV export endpoint behavior
- IP allowlist enforcement for authenticated routes
- IP allowlist enforcement for new login sessions

## Plan-Based Document Feature Limits

Membership tiers:
- free
- pro
- enterprise
- onprem

Applied limits:
- Create documents:
  - free: 10 documents
  - pro/enterprise/onprem: unlimited
- Update documents:
  - free: 1000 updates per month
  - pro/enterprise/onprem: unlimited
- Version history retention:
  - free: 7 days
  - pro/enterprise/onprem: unlimited
- Grammar checker access:
  - free: first 10 days
  - pro/enterprise/onprem: unlimited
- AI assistant for document help:
  - free: first 10 days and up to 200 requests per month
  - pro/enterprise/onprem: up to 5000 requests per month

Enforcement points:
- backend/src/routes/docs.routes.js
- backend/src/routes/versions.routes.js
- backend/src/routes/grammar.routes.js
- backend/src/routes/ai.routes.js
- backend/src/middleware/entitlements.js
- backend/src/store/catalog.js
- backend/src/store/index.js
