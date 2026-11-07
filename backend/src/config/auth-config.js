const { prisma } = require('../db/client');

// Auth config is read from the app_config table (scope 'auth') on every call; each row's key and JSON value are used as stored.
async function getAuthConfig() {
  let rows;
  try {
    rows = await prisma.appConfig.findMany({ where: { scope: 'auth' } });
  } catch (error) {
    throw new Error(`Auth config unavailable: could not read app_config (${error.message}).`);
  }

  if (rows.length === 0) {
    throw new Error("Auth config unavailable: app_config has no rows for scope 'auth'.");
  }

  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

module.exports = {
  getAuthConfig,
};
