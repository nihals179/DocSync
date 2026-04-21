# Pen Test and Authorization Review

Last updated: 2026-04-16
Owner: Security Engineering

## 1. Scope

- Broken access control checks
- Tenant isolation validation
- Session and authentication abuse paths
- Organization admin and enterprise security endpoint authorization

## 2. Broken Access Control Checklist

- Verify viewer/editor/admin/owner permission boundaries
- Verify owner-only operations (owner role mutation, owner removal safeguards)
- Verify billing admin and organization billing management gates
- Verify policy update endpoints require organization management permissions
- Verify document/workspace write operations enforce permission checks

Evidence in test suite:

- backend/test/access-control.test.js
- backend/test/enterprise-security.test.js
- backend/test/tenant-isolation-hardening.test.js

## 3. Tenant Isolation Checklist

- Cross-tenant document fetch blocked
- Cross-tenant comments/todos/versions write blocked
- Cross-tenant organization security read blocked
- Cross-tenant organization audit export blocked
- Cross-tenant context switching without membership blocked

## 4. Dynamic Testing Workflow

1. Run backend automated test suite.
2. Execute manual abuse probes against organization-scoped routes with foreign tenant IDs.
3. Validate logs for denied access and absence of data leakage.
4. Validate no broken object-level authorization for direct resource IDs.

## 5. Findings Register

- No open critical broken-access-control findings at time of this update.
- Residual risk: in-memory store is development-grade and must be replaced with hardened production datastore controls.

## 6. Recommended Next Steps

- Add continuous DAST for authz abuse patterns.
- Add structured tenant context tracing to all route logs.
- Perform external penetration test before production GA.
