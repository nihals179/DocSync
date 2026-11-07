const { Client } = require('pg');
const { execFile } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { promisify } = require('node:util');
const { basePrisma, databaseUrl: sharedDatabaseUrl } = require('./client');
const { getSecret, setSecret } = require('../config/key-vault');

const execFileAsync = promisify(execFile);

async function provisioningAdminUrl() {
  const value = String(process.env.TENANT_DATABASE_ADMIN_URL || '').trim();
  if (value) return value;
  return (await getSecret('docsync-tenant-database-admin-url', { required: false })) || sharedDatabaseUrl;
}
function databaseNameForTenant(tenantId) {
  const suffix = String(tenantId).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return `docsync_tenant_${suffix}`.slice(0, 63);
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function tenantRoleName(tenantId) {
  const suffix = String(tenantId).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return `docsync_user_${suffix}`.slice(0, 63);
}

function databaseUrlForName(adminUrl, databaseName) {
  const url = new URL(adminUrl);
  url.pathname = `/${encodeURIComponent(databaseName)}`;
  return url.toString();
}

async function createDatabase(adminUrl, databaseName, roleName) {
  const url = new URL(adminUrl);
  url.pathname = '/postgres';
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const ownerResult = await client.query('SELECT current_user AS name');
    const ownerRole = ownerResult.rows[0]?.name;
    if (!ownerRole) throw new Error('Unable to determine the PostgreSQL provisioning role.');

    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
    if (!existing.rowCount) {
      await client.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    }
    // The tenant login owns the database, which makes it the owner of public on
    // PostgreSQL 15+. Changing the owner requires membership in the tenant role.
    await client.query(`GRANT ${quoteIdentifier(roleName)} TO ${quoteIdentifier(ownerRole)}`);
    await client.query(`ALTER DATABASE ${quoteIdentifier(databaseName)} OWNER TO ${quoteIdentifier(roleName)}`);
  } finally {
    await client.end();
  }
}

async function createTenantUser(adminUrl, tenantId) {
  const roleName = tenantRoleName(tenantId);
  const password = randomBytes(32).toString('base64url');
  const url = new URL(adminUrl);
  url.pathname = '/postgres';
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const existing = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [roleName]);
    if (!existing.rowCount) {
      await client.query(`CREATE ROLE ${quoteIdentifier(roleName)} LOGIN PASSWORD ${quoteLiteral(password)}`);
    } else {
      await client.query(`ALTER ROLE ${quoteIdentifier(roleName)} WITH LOGIN PASSWORD ${quoteLiteral(password)}`);
    }
  } finally {
    await client.end();
  }
  return { roleName, password };
}

async function prepareDatabaseSchema(adminUrl, databaseName, roleName, tenantUrl) {
  const databaseUrl = databaseUrlForName(adminUrl, databaseName);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${quoteIdentifier(roleName)}`);
    // Azure owns the public schema (not the database owner), and the admin
    // login can't change its owner ("must be owner of schema public"). Granting
    // USAGE/CREATE is enough for Prisma to create its migration objects.
    await client.query(`GRANT USAGE, CREATE ON SCHEMA "public" TO ${quoteIdentifier(roleName)}`);
  } finally {
    await client.end();
  }

  // Verify with the same login Prisma will use. Checking from the admin
  // connection can hide role/database privilege mismatches on managed
  // PostgreSQL services.
  const tenantClient = new Client({ connectionString: tenantUrl });
  await tenantClient.connect();
  try {
    const privilegeResult = await tenantClient.query(
      "SELECT has_schema_privilege(current_user, 'public', 'USAGE,CREATE') AS allowed",
    );
    if (!privilegeResult.rows[0]?.allowed) {
      throw new Error(`PostgreSQL role "${roleName}" still lacks USAGE/CREATE on schema public.`);
    }
  } finally {
    await tenantClient.end();

}
}

async function migrateDatabase(databaseUrl) {
  await execFileAsync('./node_modules/.bin/prisma', ['migrate', 'deploy'], {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    maxBuffer: 10 * 1024 * 1024,
  });
}

// pg turns JavaScript arrays into Postgres array literals, which JSON/JSONB
// columns such as workspaces.memberIds reject. Serialize objects and arrays.
function queryValue(value) {
  if (value !== null && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    return JSON.stringify(value);
  }
  return value;
}

async function copyRows(source, target, table, columns, whereColumn = 'tenantId', tenantId) {
  const result = await source.query(`SELECT ${columns.map(quoteIdentifier).join(', ')} FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(whereColumn)} = $1`, [tenantId]);
  if (!result.rows.length) return 0;
  const quotedColumns = columns.map(quoteIdentifier).join(', ');
  for (const row of result.rows) {
    const values = columns.map((column) => queryValue(row[column]));
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    await target.query(
      `INSERT INTO ${quoteIdentifier(table)} (${quotedColumns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      values,
    );
  }
  return result.rows.length;
}

async function copyDocuments(source, target, tenantId) {
  const result = await source.query('SELECT * FROM "documents" WHERE "tenantId" = $1 ORDER BY "parentId" NULLS FIRST, "createdAt" ASC', [tenantId]);
  const pending = [...result.rows];
  const inserted = new Set();
  while (pending.length) {
    const index = pending.findIndex((row) => !row.parentId || inserted.has(row.parentId));
    if (index < 0) throw new Error('Document hierarchy contains an invalid parent reference.');
    const [row] = pending.splice(index, 1);
    const columns = Object.keys(row);
    const values = columns.map((column) => queryValue(row[column]));
    const placeholders = values.map((_, valueIndex) => `$${valueIndex + 1}`).join(', ');
    await target.query(
      `INSERT INTO "documents" (${columns.map(quoteIdentifier).join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      values,
    );
    inserted.add(row.id);
  }
  return result.rows.length;
}

async function copyTenantData(sourceUrl, targetUrl, tenantId) {
  const source = new Client({ connectionString: sourceUrl });
  const target = new Client({ connectionString: targetUrl });
  await source.connect();
  await target.connect();
  try {
    await target.query('BEGIN');
    await copyRows(source, target, 'workspaces', ['id', 'name', 'ownerId', 'memberIds', 'tenantId', 'createdAt', 'updatedAt'], 'tenantId', tenantId);
    await copyDocuments(source, target, tenantId);
    await copyRows(source, target, 'versions', ['id', 'docId', 'userId', 'title', 'content', 'savedAt', 'createdAt', 'tenantId', 'isPublished', 'docTitle'], 'tenantId', tenantId);
    await copyRows(source, target, 'comments', ['id', 'docId', 'userId', 'text', 'createdAt', 'updatedAt', 'tenantid', 'versionId'], 'tenantid', tenantId);
    await copyRows(source, target, 'todos', ['id', 'workspaceId', 'tenantId', 'userId', 'title', 'completed', 'dueAt', 'createdAt', 'updatedAt'], 'tenantId', tenantId);
    await target.query('COMMIT');
  } catch (error) {
    await target.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await source.end();
    await target.end();
  }
}

async function provisionDedicatedTenantDatabase(tenantId) {
  const sourceUrl = sharedDatabaseUrl;
  const adminUrl = await provisioningAdminUrl();
  if (!sourceUrl) {
    throw new Error('No resolved DATABASE_URL is available for tenant data copying.');
  }
  if (!adminUrl) {
    throw new Error('No administrative PostgreSQL URL is available for tenant database provisioning. Set TENANT_DATABASE_ADMIN_URL.');
  }
  const databaseName = databaseNameForTenant(tenantId);
  const tenantUser = await createTenantUser(adminUrl, tenantId);
  const tenantUrl = new URL(databaseUrlForName(adminUrl, databaseName));
  tenantUrl.username = tenantUser.roleName;
  tenantUrl.password = tenantUser.password;
  const tenantDatabaseUrl = tenantUrl.toString();
  const secretName = `docsync-tenant-${String(tenantId).replace(/[^A-Za-z0-9-]/g, '-').toLowerCase()}-database-url`;

  await createDatabase(adminUrl, databaseName, tenantUser.roleName);
  await prepareDatabaseSchema(adminUrl, databaseName, tenantUser.roleName, tenantDatabaseUrl);
  await migrateDatabase(tenantDatabaseUrl);
  await copyTenantData(sourceUrl, tenantDatabaseUrl, tenantId);
  await setSecret(secretName, tenantDatabaseUrl);
  await basePrisma.tenant.update({
    where: { id: tenantId },
    data: { databaseMode: 'dedicated', databaseStatus: 'active', databaseSecretName: secretName },
  });

  return { databaseName, secretName };
}

module.exports = { provisionDedicatedTenantDatabase };
