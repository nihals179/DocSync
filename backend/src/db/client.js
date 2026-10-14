require('dotenv').config();

function sanitizeDatabaseUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('postgresql://') || text.startsWith('postgres://')) return text;

  // Some environments prepend log banners to captured output. Extract the first valid URL token.
  const match = text.match(/(postgres(?:ql)?:\/\/[^\s"']+)/i);
  return match ? match[1] : '';
}

function resolveDatabaseUrlFromEnvSwitch() {
  const switchValue = String(
    process.env.DOCSYNC_ENV || process.env.APP_ENV || process.env.ENV || '',
  );

  return sanitizeDatabaseUrl(process.env[switchValue + '.DATABASE_URL']);
}

const explicitDatabaseUrl = sanitizeDatabaseUrl(process.env.DATABASE_URL);
if (explicitDatabaseUrl) {
  process.env.DATABASE_URL = explicitDatabaseUrl;
} else if (process.env.NODE_ENV !== 'test') {
  process.env.DATABASE_URL = resolveDatabaseUrlFromEnvSwitch();
}

const { PrismaClient } = require('@prisma/client');

const globalRef = global;

const prisma = globalRef.__docsyncPrisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalRef.__docsyncPrisma = prisma;
}

module.exports = {
  prisma,
};
