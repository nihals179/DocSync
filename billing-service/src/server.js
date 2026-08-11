require('dotenv').config();

const app = require('./app');

const PORT = Number(process.env.PORT || 4010);
let serverHandle = null;

async function startServer() {
  serverHandle = app.listen(PORT, () => {
    console.log(`Billing service running on http://localhost:${PORT}`);
  });

  return serverHandle;
}

startServer().catch((error) => {
  console.error('Failed to start billing service:', error);
  process.exit(1);
});

module.exports = {
  startServer,
  getServerHandle() {
    return serverHandle;
  },
};
