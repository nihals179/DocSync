const app = require('./app');

const PORT = process.env.PORT || 4000;
let serverHandle = null;

async function startServer() {
  serverHandle = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  return serverHandle;
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
