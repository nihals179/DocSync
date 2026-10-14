const app = require('./app');

const PORT = process.env.PORT || 4000;
let serverHandle = null;
let isShuttingDown = false;

function logAndExit(code, reason, error = null) {
  const timestamp = new Date().toISOString();
  console.error(`[server-exit] ${timestamp} reason=${reason} code=${code}`);
  if (error) {
    console.error(error);
  }
  process.exit(code);
}

function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.warn(`[server-shutdown] Received ${signal}. Closing HTTP server...`);

  if (!serverHandle) {
    process.exit(0);
    return;
  }

  serverHandle.close((error) => {
    if (error) {
      logAndExit(1, `${signal}:close-error`, error);
      return;
    }
    console.warn('[server-shutdown] HTTP server closed. Exiting.');
    process.exit(0);
  });
}

async function startServer() {
  serverHandle = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  serverHandle.on('error', (error) => {
    const code = error && typeof error === 'object' ? error.code : undefined;
    if (code === 'EADDRINUSE') {
      logAndExit(1, `listen:EADDRINUSE:${PORT}`, error);
      return;
    }
    logAndExit(1, 'listen:error', error);
  });

  return serverHandle;
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  logAndExit(1, 'uncaughtException', error);
});
process.on('unhandledRejection', (reason) => {
  logAndExit(1, 'unhandledRejection', reason);
});

startServer().catch((error) => {
  logAndExit(1, 'startServer:catch', error);
});
