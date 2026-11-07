# Dedicated tenant databases

DocSync now supports opt-in tenant database routing without changing the authentication/control plane.

## Shared versus dedicated data

- `shared`: existing shared Prisma database (default for all tenants).
- `dedicated` + `active`: tenant data routes use a tenant-specific PostgreSQL connection.
- Users, memberships, tenant metadata, billing, and authentication remain in the shared control database.

The initial tenant-data routes using the request-scoped client are documents, workspaces, versions, editor bootstrap, todos, and comments. User-name lookups for comments remain in the shared control database.

## Provision a tenant database

1. Configure the shared database URL using `DATABASE_URL`, or use the existing environment switch (`DOCSYNC_ENV`, `APP_ENV`, or `ENV`) with a matching `<switch>.DATABASE_URL` variable. This URL is used only as the source for copying tenant data.
2. Use the resolved `DATABASE_URL` as the provisioning administrator URL when that account has `CREATEDB`, `CREATEROLE`, and schema-grant privileges. Alternatively, set `TENANT_DATABASE_ADMIN_URL` to a separate administrator URL. `TENANT_DATABASE_ADMIN_URL` takes precedence when configured.
3. Ensure the backend identity has `Key Vault Secrets Officer` access for the generated tenant connection secret.
4. Call `PATCH /api/tenants/current/database` as the tenant owner:

   `{ "mode": "dedicated" }`

The API returns `202` and provisions asynchronously. The backend creates a dedicated PostgreSQL login for the tenant, creates the tenant database, grants the login schema creation privileges, deploys the complete Prisma migration history, copies tenant-scoped data, writes the generated login connection URL to Key Vault, and only then sets `databaseStatus` to `active`. The database remains owned by the configured administrative role because Azure PostgreSQL does not allow that role to assign a newly created role as database owner.

To return a tenant to shared mode:

`{ "mode": "shared" }`

## Safety

- Never send a database URL through the API; send only its Key Vault secret name.
- Do not switch to `active` before the dedicated database has the required schema and data.
- Dedicated clients are cached with a bounded process-local limit controlled by `TENANT_DB_MAX_CLIENTS` (default `100`). Use connection pooling for production deployments.
- Cross-database transactions are not atomic. Keep control-plane updates separate from tenant-data migrations and use a job/outbox for migration retries.
