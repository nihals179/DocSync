const app = require('./app');
const { initializePersistentMaps } = require('./store');

const PORT = process.env.PORT || 4000;
let serverHandle = null;

async function startServer() {
  await initializePersistentMaps();

  serverHandle = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  return serverHandle;
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
