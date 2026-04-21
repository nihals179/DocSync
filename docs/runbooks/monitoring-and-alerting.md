# Monitoring and Alerting Runbook

Last updated: 2026-04-16
Owner: Platform + Security

## 1. Monitoring Domains

- Availability: request success rate and latency
- Reliability: error rate, queue lag, webhook retries
- Security: auth failures, lockouts, policy violations, suspicious tenant access patterns
- Capacity: CPU, memory, storage, dependency saturation

## 2. Minimum Alert Set

- API 5xx error rate above threshold
- Auth failure spike and lockout anomaly
- Cross-tenant access denial spike (potential probing)
- Webhook job failure/retry backlog growth
- Backup job failure or missed schedule

## 3. Alert Routing

- Sev0/Sev1 pages on-call immediately
- Sev2 creates incident ticket + on-call acknowledgment
- Sev3 creates backlog task

## 4. Triage Checklist

1. Confirm alert validity and blast radius.
2. Identify impacted endpoint/tenant scope.
3. Correlate with deploy changes and audit events.
4. Escalate severity if customer impact or security risk increases.

## 5. Dashboard Requirements

- Auth and session health
- RBAC and tenant isolation denial rates
- Billing webhook processing status
- API latency and saturation

## 6. Logging Requirements

- Request ID and tenant context for backend events
- Structured audit event fields for security actions
- Retention per data retention policy
