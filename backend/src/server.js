const app = require('./app');
const { initializePersistentMaps } = require('./store');

const PORT = process.env.PORT || 4000;

async function startServer() {
  await initializePersistentMaps();

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
