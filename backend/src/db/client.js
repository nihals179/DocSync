require('dotenv').config();

function resolveDatabaseUrlFromEnvSwitch() {
  const switchValue = String(
    process.env.DOCSYNC_ENV || process.env.APP_ENV || process.env.ENV || '',
  );
  
  return process.env[switchValue + '.DATABASE_URL'];
}

if (!process.env.DATABASE_URL && process.env.NODE_ENV !== 'test') {
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
