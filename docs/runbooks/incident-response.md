# Security Incident Response Runbook

Last updated: 2026-04-16
Severity model: Sev0, Sev1, Sev2, Sev3

## 1. Purpose

Provide a clear operating procedure for detecting, triaging, containing, eradicating, and recovering from security incidents.

## 2. Incident Intake Sources

- Monitoring alerts and anomaly detectors
- Customer reports
- Internal bug bounty or pen-test findings
- Access-control and auth audit signal reviews

## 3. Response Roles

- Incident Commander (IC)
- Security Lead
- Platform Lead
- Communications Lead
- Scribe (timeline and evidence)

## 4. Severity Guide

- Sev0: Active breach, cross-tenant data risk, or critical auth bypass
- Sev1: Confirmed compromise with contained blast radius
- Sev2: High-risk vulnerability without confirmed exploit
- Sev3: Low-risk issue or policy gap

## 5. Workflow

1. Detect and declare incident with severity and owner.
2. Open incident channel and timeline document.
3. Contain impact (disable affected flows, revoke sessions, rotate secrets as needed).
4. Preserve evidence (logs, request traces, configuration snapshots).
5. Eradicate root cause (patch, config fix, access revocation).
6. Recover and monitor with heightened alerting window.
7. Customer/legal notification per contract and policy.
8. Run post-incident review within 5 business days.

## 6. Containment Playbooks

- Suspected auth token abuse: force session revoke-all and key rotation plan
- Broken access control: disable affected endpoint or permission path
- Tenant boundary risk: isolate suspect tenant operations and block high-risk routes

## 7. Communication

- Internal updates every 30 minutes for Sev0/Sev1
- External customer updates on agreed cadence in contract
- Maintain factual, timestamped updates only

## 8. Exit Criteria

- No active indicators of compromise
- Fix validated in production
- Monitoring remains stable for observation window
- Incident report and action items approved

## 9. Post-Incident Artifacts

- Timeline
- Root cause analysis
- Corrective actions with owners and due dates
- Detection gap analysis
