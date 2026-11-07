# DocSync Enterprise SSO Setup

This guide helps customer IT teams configure enterprise access controls in DocSync.

## Login Modes

DocSync has two separate SSO flows. Configure them independently.

### Individual-user login

Individual users sign in with DocSync's platform Google or Microsoft application:

```text
GET /api/auth/sso/login/google
GET /api/auth/sso/login/microsoft
```

This flow creates or finds a personal DocSync account. It does not select a tenant
from the user's email domain and does not create a tenant membership.

### Tenant SSO login

Tenant members sign in through the tenant's organization address:

```text
GET /api/auth/sso/org/{tenantSlug}/login
```

For example:

```text
https://acme.example.com/api/auth/sso/org/acme/login
```

This flow uses the provider configured by that tenant's administrator. The user must
already have an active tenant membership; SSO login does not invite or add users.

The browser callback for both OIDC flows is completed by:

```text
POST /api/auth/sso/exchange-code
```

## Platform Google and Microsoft Configuration

These settings are for individual-user login. Add them to the backend environment,
never to frontend source code or a committed frontend `.env` file:

```env
FRONTEND_URL=https://app.example.com
API_PUBLIC_URL=https://api.example.com

GOOGLE_CLIENT_ID=replace-with-google-client-id
GOOGLE_CLIENT_SECRET=replace-with-google-client-secret

MICROSOFT_TENANT_ID=common
MICROSOFT_CLIENT_ID=replace-with-microsoft-client-id
MICROSOFT_CLIENT_SECRET=replace-with-microsoft-client-secret
```

`MICROSOFT_TENANT_ID=common` supports personal Microsoft accounts and work or
school accounts. Use `organizations` for work or school accounts only, or a specific
Entra tenant ID to restrict sign-in to one directory.

Restart the backend after changing environment variables.

### Google Cloud Console

1. Create or select a project in Google Cloud Console.
2. Open **APIs & Services → OAuth consent screen**.
3. Configure the consent screen and request `openid`, `profile`, and `email` scopes.
4. If the application is in testing mode, add each test user.
5. Open **APIs & Services → Credentials → Create credentials → OAuth client ID**.
6. Select **Web application**.
7. Register the frontend origin, for example:

   ```text
   https://app.example.com
   ```

8. Register this exact redirect URI:

   ```text
   https://app.example.com/auth/callback
   ```

9. Also register the admin portal callback:

   ```text
   https://app.example.com/admin/auth/callback
   ```

10. Copy the client ID and secret to `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### Microsoft Entra admin center

1. Open **App registrations → New registration**.
2. Select **Accounts in any organizational directory and personal Microsoft accounts**
   when using `MICROSOFT_TENANT_ID=common`.
3. Add a **Web** redirect URI:

   ```text
   https://app.example.com/auth/callback
   ```

4. Add this additional **Web** redirect URI for Admin SSO:

   ```text
   https://app.example.com/admin/auth/callback
   ```

5. Copy the **Application (client) ID** to `MICROSOFT_CLIENT_ID`.
6. Create a client secret under **Certificates & secrets** and copy its value to
   `MICROSOFT_CLIENT_SECRET`.
7. Add delegated permissions for `openid`, `profile`, `email`, and `User.Read` as
   required by the provider configuration.

## Tenant OIDC Configuration

Tenant administrators configure providers from the tenant Enterprise Security page.
For an OIDC provider, enter:

- Provider name
- Issuer URL
- Client ID
- Client secret
- Enabled status
- Whether the provider is used by the tenant sign-in address

Example Microsoft Entra provider:

```json
{
  "type": "oidc",
  "name": "Microsoft Entra ID",
  "issuerUrl": "https://login.microsoftonline.com/<tenant-id>/v2.0",
  "clientId": "tenant-client-id",
  "clientSecret": "tenant-client-secret",
  "enabled": true,
  "signInAddress": true
}
```

Example Google Workspace provider:

```json
{
  "type": "oidc",
  "name": "Google Workspace",
  "issuerUrl": "https://accounts.google.com",
  "clientId": "tenant-client-id",
  "clientSecret": "tenant-client-secret",
  "enabled": true,
  "signInAddress": true
}
```

Register the tenant callback URL in that tenant's identity-provider application:

```text
https://{tenant-slug}.example.com/auth/callback
```

For example:

```text
https://acme.example.com/auth/callback
```

The redirect URI must match exactly. Do not use an unresolved placeholder such as
`https://{slug}.localhost:5173/auth/callback` in a provider console.

## Tenant URL Environment

For local development with tenant subdomains:

```env
FRONTEND_URL=https://localhost:5173
TENANT_URL_TEMPLATE=https://{slug}.localhost:5173
API_PUBLIC_URL=http://localhost:4000
```

For production:

```env
FRONTEND_URL=https://app.example.com
TENANT_URL_TEMPLATE=https://{slug}.example.com
API_PUBLIC_URL=https://api.example.com
```

The frontend must have a valid certificate for local HTTPS, and DNS or proxy routing
must resolve tenant subdomains to the frontend in production.

## Supported Protocols

- OIDC
- SAML 2.0
- LDAP

## Prerequisites

- Organization owner or admin access in DocSync
- Access to Enterprise Security page in DocSync
- Identity provider administrator access

For individual-user login, also create the platform Google and Microsoft applications
before testing the login buttons.

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
