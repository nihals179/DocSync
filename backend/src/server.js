const app = require('./app');
const { ensureAdminUser } = require('./seed');

const PORT = process.env.PORT || 4000;

ensureAdminUser();

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
