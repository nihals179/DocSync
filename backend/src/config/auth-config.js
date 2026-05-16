const { prisma } = require('../db/client');
const { getRedisClient } = require('../lib/redis-client');

const CACHE_TTL_MS = 30 * 1000;
let cachedConfig = null;
let cachedAt = 0;
const AUTH_CONFIG_SCOPE = 'auth';
const REDIS_CACHE_KEY = `app-config:${AUTH_CONFIG_SCOPE}`;
const REDIS_AUTH_CONFIG_TTL_SECONDS = Math.max(0, Number(process.env.REDIS_AUTH_CONFIG_TTL_SECONDS || 0));
const MIN_TOKEN_TTL_MS = 60 * 1000;
const MIN_LOCKOUT_THRESHOLD = 1;

const REQUIRED_AUTH_KEYS = [
  'appName',
  'devMode',
  'emailVerificationBypass',
  'emailTokenTtlMs',
  'resetTokenTtlMs',
  'lockoutThreshold',
  'lockoutMs',
];

function shouldUseDatabase() {
  const envKey = String(process.env.DOCSYNC_ENV || '').trim();
  if (envKey && process.env[`${envKey}.DATABASE_URL`]) return true;
  return Boolean(process.env.DATABASE_URL);
}

function hasValue(value) {
  return value !== undefined && value !== null;
}

function toNumberAtLeast(value, min) {
  return Math.max(min, Number(value));
}

function normalizeAuthConfig(raw = {}) {
  const normalized = {};
  if (hasValue(raw.appName)) {
    normalized.appName = String(raw.appName);
  }
  if (hasValue(raw.devMode)) {
    normalized.devMode = Boolean(raw.devMode);
  }
  if (hasValue(raw.emailVerificationBypass)) {
    normalized.emailVerificationBypass = Boolean(raw.emailVerificationBypass);
  }
  if (hasValue(raw.emailTokenTtlMs)) {
    normalized.emailTokenTtlMs = toNumberAtLeast(raw.emailTokenTtlMs, MIN_TOKEN_TTL_MS);
  }
  if (hasValue(raw.resetTokenTtlMs)) {
    normalized.resetTokenTtlMs = toNumberAtLeast(raw.resetTokenTtlMs, MIN_TOKEN_TTL_MS);
  }
  if (hasValue(raw.lockoutThreshold)) {
    normalized.lockoutThreshold = toNumberAtLeast(raw.lockoutThreshold, MIN_LOCKOUT_THRESHOLD);
  }
  if (hasValue(raw.lockoutMs)) {
    normalized.lockoutMs = toNumberAtLeast(raw.lockoutMs, MIN_TOKEN_TTL_MS);
  }
  return normalized;
}

function hasRequiredAuthKeys(config) {
  if (!config || typeof config !== 'object') return false;
  return REQUIRED_AUTH_KEYS.every((key) => config[key] !== undefined && config[key] !== null);
}



function buildConfigFromRows(rows = []) {
  const configByKey = {};
  for (const row of rows) {
    if (!row || typeof row.key !== 'string') continue;
    configByKey[row.key] = row.value;
  }
  return normalizeAuthConfig(configByKey);
}

function rememberConfig(config) {
  cachedConfig = config;
  cachedAt = Date.now();
  return config;
}


async function getAuthConfigFromRedis() {
  const redisClient = await getRedisClient();
  if (!redisClient) return null;

  const payload = await redisClient.get(REDIS_CACHE_KEY);
  if (!payload) return null;

  try {
    const normalized = normalizeAuthConfig(JSON.parse(payload));
    return hasRequiredAuthKeys(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

async function setAuthConfigInRedis(config) {
  const redisClient = await getRedisClient();
  if (!redisClient) return;

  if (REDIS_AUTH_CONFIG_TTL_SECONDS > 0) {
    await redisClient.set(REDIS_CACHE_KEY, JSON.stringify(config), {
      EX: REDIS_AUTH_CONFIG_TTL_SECONDS,
    });
    return;
  }

  // Persist key without expiry so cache survives backend restarts.
  await redisClient.set(REDIS_CACHE_KEY, JSON.stringify(config));
}

async function getAuthConfig() {
  if (cachedConfig && (Date.now() - cachedAt) < CACHE_TTL_MS) {
    return cachedConfig;
  }

  try {
    const redisConfig = await getAuthConfigFromRedis();
    if (redisConfig) {
      return rememberConfig(redisConfig);
    }
  } catch {
    // Ignore Redis errors and continue with database fallback.
  }

  if (!shouldUseDatabase()) {
    throw new Error('Auth config unavailable: missing database and redis config source.');
  }

  try {
    const rows = await prisma.appConfig.findMany({
      where: {
        scope: AUTH_CONFIG_SCOPE,
      },
    });
    const dbConfig = buildConfigFromRows(rows);
    if (!hasRequiredAuthKeys(dbConfig)) {
      throw new Error('Auth config missing required keys in DB/Redis.');
    }
    await setAuthConfigInRedis(dbConfig);
    return rememberConfig(dbConfig);
  } catch {
    throw new Error('Auth config unavailable from Redis/DB.');
  }
}

module.exports = {
  getAuthConfig,
};
