# DocSync Enterprise SSO Setup

This guide helps customer IT teams configure SSO for DocSync organizations.

## Supported Protocols

- OIDC
- SAML 2.0

## Prerequisites

- Organization owner or admin access in DocSync
- Enterprise security page access
- Identity provider administrator access

## Step 1: Configure Domain Mapping

1. Open Enterprise Security in DocSync.
2. Add one or more company email domains (for example `company.com`).
3. Save domain mappings.

Users who sign up with mapped domains can be associated with the organization.

## Step 2: Add an SSO Provider

1. In Enterprise Security, go to SSO Providers.
2. Choose protocol type:
   - OIDC: add Provider Name, Issuer URL, Client ID, Client Secret.
   - SAML: add Provider Name, SSO URL, and Certificate.
3. Save the provider.
4. Enable the provider.

## Step 3: Validate Routing

1. Use Domain Routing Simulation.
2. Enter a user email from your mapped domain.
3. Confirm the organization and SSO provider are detected.

## Step 4: Enforce Security Policies

Recommended enterprise baseline:

- Require MFA: enabled
- Session duration: 8 hours or less
- IP allowlist: enabled for corporate ranges

## Audit and Export

- Open Admin Audit Console for security and access events.
- Use Export CSV for external compliance workflows.

## Troubleshooting

- "No domain mapping found": verify domain list is saved and normalized.
- "No active SSO provider": make sure at least one provider is enabled.
- MFA lockout on login: user must configure two-factor in personal security settings.
