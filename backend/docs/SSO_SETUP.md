# DocSync Enterprise SSO Setup

This guide helps customer IT teams configure enterprise access controls in DocSync.

## Supported Protocols

- OIDC
- SAML 2.0
- LDAP

## Prerequisites

- Organization owner or admin access in DocSync
- Access to Enterprise Security page in DocSync
- Identity provider administrator access

## Step 1: Configure Domain Mapping

1. Open Enterprise Security in DocSync.
2. Go to Domain mapping.
3. Add one or more company domains (example: company.com).
4. Save domain mappings.

DocSync uses these domains to map user identities to the right organization context.

## Step 2: Add an SSO Provider

1. In Enterprise Security, open SSO providers.
2. Choose provider type:
   - OIDC: Provider Name, Issuer URL, Client ID, Client Secret
   - SAML: Provider Name, SSO URL, Certificate
   - LDAP: Provider Name, Directory/Connection URL, Bind or Service Account details
3. Save the provider.
4. Enable the provider when ready.

Note: Multiple providers can be stored. Only enabled providers are considered active for routing simulation.

## Step 3: Validate Domain Routing

1. Use Domain routing simulation.
2. Enter an email from a mapped domain.
3. Verify organization and active SSO provider are detected.
4. If a user record exists, verify membership status is returned.

## Step 4: Enforce Organization Security Policies

Recommended baseline:

- Require MFA: optional (for non-SSO users)
- Session duration: 8 hours or less
- IP allowlist: enabled for corporate ranges

Policy behavior:

- For active SSO providers, MFA should be enforced at the identity provider level.
- App-level MFA policy applies to non-SSO login when enabled.
- Session duration defines refresh-session max lifetime per organization.
- IP allowlist is enforced for login, 2FA completion, refresh, and authenticated API access.

## Audit, Compliance, and Export

Use Admin Audit Console to review:

- Login and auth events
- Role and permission changes
- Access and sharing actions (document access/update and membership/invite flows)
- Security configuration changes

Use Export CSV to extract filtered organization audit logs for compliance workflows.

## Troubleshooting

- "No organization domain mapping found": verify domain list is saved and normalized.
- "No active SSO provider configured": ensure at least one provider is enabled.
- MFA login blocked (non-SSO): user must complete two-factor setup in personal security settings.
- Login blocked by IP policy: add client egress IP/CIDR source to organization allowlist.
