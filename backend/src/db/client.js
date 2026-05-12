require('dotenv').config();

function resolveDatabaseUrlFromEnvSwitch() {
  const switchValue = String(
    process.env.DOCSYNC_ENV || process.env.APP_ENV || process.env.ENV || '',
  ).toLowerCase();

  const dbByEnv = {
    dev: 'postgresql://docsync@localhost:5432/docsync_dev?schema=public',
    itt: 'postgresql://docsync@localhost:5432/docsync_itt?schema=public',
    uat: 'postgresql://docsync@localhost:5432/docsync_uat?schema=public',
    prod: 'postgresql://docsync@localhost:5432/docsync_prod?schema=public',
  };

  const envKey = dbByEnv[switchValue] ? switchValue : 'prod';
  process.env.DOCSYNC_ENV = envKey;
  return dbByEnv[envKey];
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
