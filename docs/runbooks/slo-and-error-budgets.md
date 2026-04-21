# SLO and Error Budget Policy

Last updated: 2026-04-16
Owner: Engineering Leadership

## 1. Core SLOs

- Availability SLO: 99.9% monthly for authenticated API requests
- Latency SLO: 95th percentile < 500 ms for core read/write APIs
- Security SLO: zero known critical broken-access-control findings in production

## 2. Error Budget Model

- Monthly availability budget: 0.1%
- If 50% of budget is consumed, freeze non-critical changes and prioritize reliability work.
- If 100% is consumed, only reliability/security remediations may ship until recovery.

## 3. Policy Gates

- New feature launches require SLO impact assessment.
- Any authz regression blocks release.
- Release approvals require passing access-control and tenant-isolation tests.

## 4. Reporting Cadence

- Weekly engineering reliability review
- Monthly leadership review with trend analysis

## 5. Required Metrics

- Success/error rate by route
- Latency percentiles
- Security denial events by category
- Incident count and MTTR
