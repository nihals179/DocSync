# DocSync Trust Center Basics

Last updated: 2026-04-16
Owner: Security and Platform Team

## Security Program Snapshot

- Multi-tenant architecture with organization-scoped access controls
- Role-based access control (owner, admin, editor, viewer)
- Authentication controls: email verification, password reset, optional MFA, session revocation
- Enterprise security controls: SSO provider config (OIDC/SAML), domain mapping, session policy, optional IP allowlist
- Audit logging for auth, organization admin events, and document access changes

## Data Protection Summary

- Data in transit: HTTPS/TLS required in production deployment
- Secrets: environment-variable based runtime secrets (for example JWT secret)
- Session protection: short-lived access token + refresh session with rotation and revocation
- CSRF protection on refresh flow

## Privacy and Legal

- Privacy policy: ./privacy-policy.md
- Terms of service: ./terms-of-service.md
- Data processing addendum (DPA): ./data-processing-addendum.md

## Retention and Deletion

- Operational policy: ../security/data-retention-and-deletion.md
- Data deletion request workflow: documented in retention policy and incident runbook coordination path

## Reliability and Operations

- Backups and restore drill runbook: ../runbooks/backups-and-restore-drill.md
- Monitoring and alerts runbook: ../runbooks/monitoring-and-alerting.md
- Error budgets and SLO policy: ../runbooks/slo-and-error-budgets.md

## Security Runbooks

- Incident response runbook: ../runbooks/incident-response.md
- Security review and pen-test checklist: ../security/pen-test-and-authz-review.md

## Third-Party and Infrastructure Notes

- Current state is in-memory persistence in this repository baseline; production deployment must provide managed persistent storage, backup schedule, and disaster recovery controls documented in runbooks.
- Security controls are effective only when deployed with TLS, hardened secret management, and production monitoring.

## Contact

- Security contact: security@docsync.local (replace with real contact before production)
- Incident reporting channel: see incident-response runbook
