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
