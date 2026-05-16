const { createClient } = require('redis');

let redisClientPromise = null;
let redisClient = null;
const CONNECT_TIMEOUT_MS = 1000;
const CONNECT_GUARD_TIMEOUT_MS = 1200;

function resolveRedisUrl() {
  const envKey = String(process.env.DOCSYNC_ENV || '').trim();
  if (envKey && process.env[`${envKey}.REDIS_URL`]) {
    return process.env[`${envKey}.REDIS_URL`];
  }
  return process.env.REDIS_URL || '';
}

function resetRedisClientState() {
  redisClient = null;
  redisClientPromise = null;
}

function safeDestroy(client) {
  try {
    client.destroy();
  } catch {
    // noop
  }
}

function connectWithGuardTimeout(client) {
  const connectPromise = client.connect().then(() => client);
  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => resolve(null), CONNECT_GUARD_TIMEOUT_MS);
  });
  return Promise.race([connectPromise, timeoutPromise]);
}

async function getRedisClient() {
  const redisUrl = resolveRedisUrl();
  if (!redisUrl) return null;

  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  if (!redisClientPromise) {
    const client = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: CONNECT_TIMEOUT_MS,
        reconnectStrategy: () => false,
      },
    });

    client.on('error', () => {});

    redisClientPromise = connectWithGuardTimeout(client)
      .then((connectedClient) => {
        if (!connectedClient) {
          safeDestroy(client);
          resetRedisClientState();
          return null;
        }
        redisClient = connectedClient;
        redisClientPromise = null;
        return connectedClient;
      })
      .catch(() => {
        safeDestroy(client);
        resetRedisClientState();
        return null;
      });
  }

  return redisClientPromise;
}

async function closeRedisClient() {
  if (!redisClient) return;
  try {
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  } catch {
    safeDestroy(redisClient);
  } finally {
    resetRedisClientState();
  }
}

module.exports = {
  getRedisClient,
  closeRedisClient,
};
