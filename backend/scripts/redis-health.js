require('dotenv').config();

const { getRedisClient, closeRedisClient } = require('../src/lib/redis-client');

async function run() {
  const client = await getRedisClient();
  if (!client) {
    console.error('Redis is not configured or unreachable.');
    process.exitCode = 1;
    return;
  }

  const pong = await client.ping();
  console.log(`Redis ping: ${pong}`);
}

run()
  .catch((error) => {
    console.error('Redis health check failed:', error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedisClient();
  });
