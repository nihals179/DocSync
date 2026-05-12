const { createClient } = require('redis');

let redisClientPromise = null;

function resolveRedisUrl() {
  const envKey = String(process.env.DOCSYNC_ENV || '').trim();
  if (envKey && process.env[`${envKey}.REDIS_URL`]) {
    return process.env[`${envKey}.REDIS_URL`];
  }
  return process.env.REDIS_URL || '';
}

async function getRedisClient() {
  const redisUrl = resolveRedisUrl();
  if (!redisUrl) return null;

  if (!redisClientPromise) {
    const client = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 1000,
      },
    });

    // Avoid crashing the process on transient Redis errors.
    client.on('error', () => {});

    redisClientPromise = client.connect()
      .then(() => client)
      .catch(() => {
        redisClientPromise = null;
        return null;
      });
  }

  return redisClientPromise;
}

module.exports = {
  getRedisClient,
};
