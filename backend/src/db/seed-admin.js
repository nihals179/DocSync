const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const {
  initializePersistentMaps,
  users,
  nowIso,
  ensureTenantBootstrapForUser,
  ensureUserBillingState,
} = require('../store');

async function seedAdmin() {
  await initializePersistentMaps();

  const email = String(process.env.SEED_ADMIN_EMAIL || 'admin@docsync.local').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin';
  const passwordHash = await bcrypt.hash(password, 12);

  let admin = [...users.values()].find((user) => String(user.email || '').toLowerCase() === email);
  if (!admin) {
    admin = {
      id: uuidv4(),
      name: 'Admin',
      username: 'admin',
      email,
      passwordHash,
      createdAt: nowIso(),
      accountType: 'individual',
      emailVerified: true,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      role: 'admin',
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorTempSecret: null,
    };
  } else {
    admin.name = admin.name || 'Admin';
    admin.username = admin.username || 'admin';
    admin.passwordHash = passwordHash;
    admin.accountType = admin.accountType || 'individual';
    admin.emailVerified = true;
    admin.failedLoginAttempts = 0;
    admin.lockoutUntil = null;
    admin.role = 'admin';
    admin.twoFactorEnabled = false;
    admin.twoFactorSecret = null;
    admin.twoFactorTempSecret = null;
  }

  users.set(admin.id, admin);
  ensureTenantBootstrapForUser(admin);
  ensureUserBillingState(admin);

  console.log(`[db-seed] Admin user upserted: ${email}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[db-seed] Admin password: ${password}`);
  }
}

seedAdmin()
  .catch((error) => {
    console.error('Failed to seed admin user:', error);
    process.exitCode = 1;
  });
