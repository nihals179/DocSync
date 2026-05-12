const fs = require('fs');
const path = require('path');
const { prisma } = require('./client');

const AUDIT_LOG_FILE_PATH = process.env.AUDIT_LOG_FILE_PATH
  ? path.resolve(process.env.AUDIT_LOG_FILE_PATH)
  : path.resolve(process.cwd(), 'audit-logs.ndjson');
const BATCH_SIZE = 500;

function normalizeLine(rawLine) {
  const line = String(rawLine || '').trim();
  if (!line) return null;

  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  if (!parsed.id || !parsed.action) return null;

  const metadata = parsed.metadata && typeof parsed.metadata === 'object' ? { ...parsed.metadata } : {};
  if (parsed.source && !metadata.__source) {
    metadata.__source = parsed.source;
  }

  const createdAtRaw = parsed.createdAt || parsed.loggedAt || new Date().toISOString();
  const createdAt = new Date(createdAtRaw);
  if (Number.isNaN(createdAt.getTime())) return null;

  return {
    id: String(parsed.id),
    userId: parsed.userId ? String(parsed.userId) : null,
    organizationId: parsed.organizationId ? String(parsed.organizationId) : null,
    action: String(parsed.action),
    status: String(parsed.status || 'success'),
    ipAddress: parsed.ipAddress ? String(parsed.ipAddress) : null,
    userAgent: parsed.userAgent ? String(parsed.userAgent) : null,
    metadata,
    createdAt,
  };
}

async function importAuditLogs() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to import audit logs into DB.');
  }

  if (!fs.existsSync(AUDIT_LOG_FILE_PATH)) {
    throw new Error(`Audit log file not found: ${AUDIT_LOG_FILE_PATH}`);
  }

  const raw = fs.readFileSync(AUDIT_LOG_FILE_PATH, 'utf8');
  const rows = raw
    .split('\n')
    .map(normalizeLine)
    .filter(Boolean);

  if (rows.length === 0) {
    console.log('No valid audit log entries found to import.');
    return;
  }

  let imported = 0;
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const chunk = rows.slice(index, index + BATCH_SIZE);
    const result = await prisma.auditLog.createMany({
      data: chunk,
      skipDuplicates: true,
    });
    imported += Number(result.count || 0);
  }

  console.log(`Audit log import completed. processed=${rows.length} inserted=${imported}`);
}

importAuditLogs()
  .catch((error) => {
    console.error('Audit log import failed:', error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
