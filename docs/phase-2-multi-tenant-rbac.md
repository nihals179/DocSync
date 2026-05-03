# Phase 2: Multi-tenant + RBAC (Week 6-8)

This document defines Phase 2 scope, implementation checklist, and deliverables for tenant isolation and role-based access control in DocSync.

## 1) Scope and Deliverables

Requested scope:
1. Implement tenant boundaries.
2. Link every resource to organization ID.
3. Enforce organization membership checks on all APIs.
4. Implement role-based access.
5. Owner/Admin/Editor/Viewer roles.
6. BillingAdmin as a separate capability.
7. Permission middleware at API layer.
8. Deny-by-default authorization behavior.
9. Resource-level checks (document/workspace/share).
10. Add role/invite lifecycle.
11. Invite user.
12. Accept invite.
13. Change role.
14. Remove user.

Required deliverables:
1. Organization admin UI.
2. Enforced RBAC across backend.
3. Access test suite (positive + negative permission tests).

## 2) Target Outcomes

By the end of Phase 2:
1. Users can only access resources in organizations where they are active members.
2. API authorization is centralized and consistently enforced.
3. Role changes take effect immediately for protected actions.
4. Invite lifecycle is auditable and constrained by policy (seat/collaborator limits, role permissions).

## 3) RBAC Model

Roles:
1. owner: Full organization control, owner-only sensitive actions.
2. admin: Member/invite management and org-level operations (except owner-only actions).
3. editor: Content operations allowed within policy.
4. viewer: Read-only access within policy.

Separate capability:
1. billingAdmin: Grants billing management permission independent of content role.

Principles:
1. Deny-by-default.
2. Explicit permission mapping per action.
3. Resource and tenant checks required before action-level permission checks pass.

## 4) Tenant Boundary Requirements

All tenant-scoped entities must include organizationId:
1. documents
2. workspaces
3. organization memberships
4. invites
5. billing records
6. audit records (when organization-scoped)

Backend requirements:
1. Resolve current organization context from authenticated user + active membership.
2. Reject cross-tenant resource access with 403/404 as applicable.
3. Ensure list endpoints only return records for current tenant.
4. Validate write operations against current tenant context.

## 5) Permission Middleware Requirements

Middleware layer responsibilities:
1. Authenticate user session.
2. Resolve organization and membership context.
3. Validate required permission for route/action.
4. Enforce deny-by-default for missing mapping.
5. Apply resource-level checks for target entity ownership/tenant.

Expected behavior:
1. 401 for unauthenticated requests.
2. 403 for authenticated-but-forbidden operations.
3. 404 for hidden non-tenant resources where appropriate.

## 6) Invite and Role Lifecycle

Invite user:
1. Authorized role creates invite with target role and billingAdmin flag.
2. Duplicate pending invites blocked.
3. Existing active membership conflict blocked.

Accept invite:
1. Token validity and expiry checks.
2. Invite email must match authenticated user email.
3. Seat and collaborator entitlement checks.
4. Membership created or reactivated with invited role.

Change role:
1. Owner-only constraints enforced for owner role transitions.
2. Collaborator limits enforced when promoting viewer to collaborator roles.
3. Audit log written with actor, target, old/new role.

Remove user:
1. Owner protections enforced.
2. Membership status updated to removed.
3. Current organization fallback handled for removed user.
4. Audit log written.

## 7) Organization Admin UI Deliverables

UI capabilities:
1. List active members and roles.
2. List pending invites.
3. Invite new member with role and billing admin option.
4. Accept invite flow handling in user context.
5. Change member role.
6. Remove member.

UX requirements:
1. Clear forbidden/action-unavailable states.
2. Confirmation for destructive changes.
3. Immediate refresh of membership state after mutations.

## 8) Backend Enforcement Deliverables

Must-have backend enforcement:
1. Route-level permission checks for org actions.
2. Resource-level tenant checks for document/workspace operations.
3. Role + billing admin logic consistently applied.
4. Organization context resolution required for tenant endpoints.

## 9) Access Test Suite Deliverables

Test coverage requirements:
1. Positive tests: allowed actions per role.
2. Negative tests: forbidden actions per role.
3. Cross-tenant denial tests for read/write operations.
4. Invite lifecycle tests: create, accept, duplicate, expired, mismatch email.
5. Role transition tests including owner constraints.
6. Membership removal tests including edge cases.

Minimum matrix:
1. owner/admin/editor/viewer action matrix.
2. billingAdmin capability checks separate from content role.
3. tenant isolation matrix (same tenant vs other tenant).

## 10) Acceptance Criteria

Phase 2 is complete when:
1. Tenant isolation is enforced across all tenant-scoped APIs.
2. RBAC checks are deny-by-default and route/resource aware.
3. Invite and role lifecycle works end-to-end with policy constraints.
4. Organization admin UI supports member and invite management workflows.
5. Automated access tests pass for positive and negative authorization scenarios.

## 11) Suggested File Map

Backend:
1. backend/src/middleware/rbac.js
2. backend/src/middleware/auth.js
3. backend/src/routes/organizations.routes.js
4. backend/src/routes/docs.routes.js
5. backend/src/routes/workspaces.routes.js
6. backend/test/access-control.test.js
7. backend/test/tenant-isolation-hardening.test.js

Frontend:
1. frontend/src/components/pages/OrganizationAdminPage.tsx
2. frontend/src/lib/api.ts

## 12) Current Implementation (How It Is Implemented)

This section maps Phase 2 requirements to the current implementation.

### 12.1 Tenant boundaries

Current status: Implemented for organization, document, workspace, and invite flows.

How it is implemented:
1. Organization context is resolved by middleware using current user membership and optional organization selector.
2. Routes use resolveOrganizationContext before protected handlers.
3. Tenant-scoped resources include organizationId and are filtered by organization in list/read/write flows.

Key files:
1. backend/src/middleware/rbac.js
2. backend/src/routes/docs.routes.js
3. backend/src/routes/workspaces.routes.js
4. backend/src/routes/organizations.routes.js

### 12.2 RBAC and deny-by-default checks

Current status: Implemented at API layer with permission middleware.

How it is implemented:
1. Permissions are defined per role in PERMISSIONS_BY_ROLE.
2. Route handlers declare required permissions via requirePermission.
3. Billing management permission is handled as a separate capability using role owner OR billingAdmin flag.
4. Requests without required permission return 403.

Key file:
1. backend/src/middleware/rbac.js

### 12.3 Role model

Current status: Implemented.

Roles implemented:
1. owner
2. admin
3. editor
4. viewer

Separate capability implemented:
1. billingAdmin (membership flag checked in permission middleware for billing management)

### 12.4 Invite and membership lifecycle

Current status: Implemented.

Invite user:
1. POST current invites endpoint validates role and membership constraints.
2. Duplicate active member and duplicate pending invite checks are enforced.
3. Seat and collaborator entitlement checks are enforced before invite creation.

Accept invite:
1. Invite token, status, and expiry are validated.
2. Invite email must match authenticated user email.
3. Seat and collaborator checks are re-applied.
4. Membership is created or reactivated, then invite status becomes accepted.

Change role and billing admin:
1. Member patch endpoint supports role and billingAdmin updates.
2. Owner-only constraints are enforced for owner-role transitions.
3. Collaborator limits are enforced on viewer to collaborator upgrades.

Remove user:
1. Member delete endpoint sets membership to removed.
2. Owner removal is blocked.
3. Admin removal requires owner privileges.
4. Removed user current organization fallback is handled.

Key file:
1. backend/src/routes/organizations.routes.js

### 12.5 Resource-level authorization

Current status: Implemented for document and workspace APIs.

How it is implemented:
1. Docs routes use tenant lookup helper that returns document only when organizationId matches.
2. Workspace list/create routes are scoped to current resolved organization.
3. Permission checks are applied per action: read/create/update/delete.

Key files:
1. backend/src/routes/docs.routes.js
2. backend/src/routes/workspaces.routes.js

### 12.6 Organization admin UI

Current status: Implemented.

Capabilities currently present:
1. Organization/member/invite views.
2. Invite creation and invite list.
3. Role and billing admin updates for members.
4. Member removal.
5. Enterprise security and audit-oriented admin surfaces.

Key files:
1. frontend/src/components/pages/OrganizationAdminPage.tsx
2. frontend/src/lib/api.ts

### 12.7 Access control test suite

Current status: Implemented with positive and negative authorization scenarios.

Coverage highlights:
1. Role-based allow/deny checks for invite, docs, and workspaces.
2. Cross-tenant document access denial.
3. Owner-only membership safeguards.
4. Cross-tenant organization security and audit access denial.

Key files:
1. backend/test/access-control.test.js
2. backend/test/tenant-isolation-hardening.test.js

### 12.8 Notable operational limitation

1. Core state remains in-memory for development.
2. Restart clears state, which impacts active session continuity.
3. Production deployment should persist users, memberships, invites, sessions, and audit events in a database.

## 13) Operational Notes

1. In-memory stores are acceptable for development but not production.
2. For production readiness, persist memberships/invites/sessions in a database.
3. Add audit monitoring for role and membership changes.
