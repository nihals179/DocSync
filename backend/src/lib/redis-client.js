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
        reconnectStrategy: () => false,
      },
    });

    client.on('error', () => {});

    const connectPromise = client.connect().then(() => client);
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve(null), 1200);
    });

    redisClientPromise = Promise.race([connectPromise, timeoutPromise])
      .then((connectedClient) => {
        if (!connectedClient) {
          try {
            client.destroy();
          } catch {
            // noop
          }
          redisClientPromise = null;
          return null;
        }
        return connectedClient;
      })
      .catch(() => {
        try {
          client.destroy();
        } catch {
          // noop
        }
        redisClientPromise = null;
        return null;
      });
  }

  return redisClientPromise;
}

module.exports = {
  getRedisClient,
};
