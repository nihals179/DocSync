const { prisma } = require('../db/client');
const { getRedisClient } = require('../lib/redis-client');

const DEFAULT_AUTH_CONFIG = Object.freeze({
  appName: 'DocSync',
  devMode: process.env.NODE_ENV !== 'production',
  emailVerificationBypass: process.env.AUTH_BYPASS_EMAIL_VERIFICATION === 'true',
  emailTokenTtlMs: 24 * 60 * 60 * 1000,
  resetTokenTtlMs: 60 * 60 * 1000,
  lockoutThreshold: 5,
  lockoutMs: 30 * 60 * 1000,
});

const CACHE_TTL_MS = 30 * 1000;
let cachedConfig = null;
let cachedAt = 0;
const AUTH_CONFIG_SCOPE = 'auth';
const REDIS_CACHE_KEY = `app-config:${AUTH_CONFIG_SCOPE}`;

const DEFAULT_AUTH_CONFIG_ENTRIES = Object.entries(DEFAULT_AUTH_CONFIG);

function shouldUseDatabase() {
  return Boolean(process.env[`${process.env.DOCSYNC_ENV}.DATABASE_URL`]) || Boolean(process.env.DATABASE_URL);
}

function normalizeAuthConfig(raw = {}) {
  return {
    appName: String(raw.appName || DEFAULT_AUTH_CONFIG.appName),
    devMode: Boolean(raw.devMode),
    emailVerificationBypass: Boolean(raw.emailVerificationBypass),
    emailTokenTtlMs: Math.max(60 * 1000, Number(raw.emailTokenTtlMs || DEFAULT_AUTH_CONFIG.emailTokenTtlMs)),
    resetTokenTtlMs: Math.max(60 * 1000, Number(raw.resetTokenTtlMs || DEFAULT_AUTH_CONFIG.resetTokenTtlMs)),
    lockoutThreshold: Math.max(1, Number(raw.lockoutThreshold || DEFAULT_AUTH_CONFIG.lockoutThreshold)),
    lockoutMs: Math.max(60 * 1000, Number(raw.lockoutMs || DEFAULT_AUTH_CONFIG.lockoutMs)),
  };
}

function buildConfigFromRows(rows = []) {
  const merged = { ...DEFAULT_AUTH_CONFIG };
  for (const row of rows) {
    if (!row || typeof row.key !== 'string') continue;
    merged[row.key] = row.value;
  }
  return normalizeAuthConfig(merged);
}

async function seedMissingKeys() {
  await Promise.all(
    DEFAULT_AUTH_CONFIG_ENTRIES.map(([key, value]) =>
      prisma.appConfig.upsert({
        where: {
          scope_key: {
            scope: AUTH_CONFIG_SCOPE,
            key,
          },
        },
        update: {},
        create: {
          scope: AUTH_CONFIG_SCOPE,
          key,
          value,
        },
      })),
  );
}

async function getAuthConfigFromRedis() {
  const redisClient = await getRedisClient();
  if (!redisClient) return null;

  const payload = await redisClient.get(REDIS_CACHE_KEY);
  if (!payload) return null;

  try {
    return normalizeAuthConfig(JSON.parse(payload));
  } catch {
    return null;
  }
}

async function setAuthConfigInRedis(config) {
  const redisClient = await getRedisClient();
  if (!redisClient) return;

  const ttlSeconds = Math.max(1, Math.floor(CACHE_TTL_MS / 1000));
  await redisClient.set(REDIS_CACHE_KEY, JSON.stringify(config), {
    EX: ttlSeconds,
  });
}

async function getAuthConfig() {
  if (!shouldUseDatabase()) return DEFAULT_AUTH_CONFIG;

  if (cachedConfig && (Date.now() - cachedAt) < CACHE_TTL_MS) {
    return cachedConfig;
  }

  try {
    const redisConfig = await getAuthConfigFromRedis();
    if (redisConfig) {
      cachedConfig = redisConfig;
      cachedAt = Date.now();
      return redisConfig;
    }
  } catch {
    // Ignore Redis errors and continue with database fallback.
  }

  try {
    await seedMissingKeys();
    const rows = await prisma.appConfig.findMany({
      where: {
        scope: AUTH_CONFIG_SCOPE,
      },
    });
    cachedConfig = buildConfigFromRows(rows);
    cachedAt = Date.now();
    await setAuthConfigInRedis(cachedConfig);
    return cachedConfig;
  } catch {
    return DEFAULT_AUTH_CONFIG;
  }
}

module.exports = {
  DEFAULT_AUTH_CONFIG,
  getAuthConfig,
};
