# Backups and Restore Drill Runbook

Last updated: 2026-04-16
Owner: Platform

## 1. Objective

Ensure backups are recoverable and recovery objectives are measurable.

## 2. Production Targets

- RPO target: <= 24 hours
- RTO target: <= 4 hours for core service

## 3. Backup Policy (Production Requirement)

- Daily full backups plus intra-day incremental backups for primary datastore
- Backup encryption at rest
- Multi-region copy for disaster scenarios
- Retention windows aligned to data retention policy

## 4. Restore Drill Cadence

- Monthly restore drill in staging
- Quarterly game-day with simulated service disruption

## 5. Drill Procedure

1. Select backup snapshot and define scope.
2. Restore into isolated staging environment.
3. Run data integrity checks (tenant counts, key records, auth references).
4. Run smoke test and authz/tenant isolation test suite.
5. Capture recovery duration and issues.
6. Record corrective actions.

## 6. Evidence to Capture

- Snapshot identifier
- Start and completion timestamps
- Validation results
- Any data mismatch with remediation notes

## 7. Fail Criteria

- Missing critical tables/collections
- Cross-tenant data mixups
- Restore time exceeds objective without approved exception
