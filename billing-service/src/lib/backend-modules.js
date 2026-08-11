const path = require('path');

function hasValidPostgresUrl() {
  const value = String(process.env.DATABASE_URL || '').trim().toLowerCase();
  return value.startsWith('postgres://') || value.startsWith('postgresql://');
}

if (process.env.DATABASE_URL && !hasValidPostgresUrl()) {
  delete process.env.DATABASE_URL;
  delete process.env.DOCSYNC_ENV;
  delete process.env.APP_ENV;
  delete process.env.ENV;
}

const backendRoot = process.env.BILLING_BACKEND_PATH
  ? path.resolve(process.cwd(), process.env.BILLING_BACKEND_PATH)
  : path.resolve(__dirname, '../../../backend');

function fromBackend(relativePath) {
  return require(path.join(backendRoot, relativePath));
}

module.exports = {
  backendRoot,
  fromBackend,
};
