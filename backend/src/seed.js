/**
 * Startup seed — runs once when the server boots.
 * Creates the default admin account if it doesn't already exist.
 *
 * In production, replace the hard-coded credentials with
 * SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD env vars and never
 * commit real passwords to source control.
 */

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { users, nowIso, ensureTenantBootstrapForUser } = require('./store');

function ensureAdminUser() {
  // Re-shape any existing admin record in case fields were added later.
  const existingAdmin = [...users.values()].find((u) => u.username === 'admin');
  if (existingAdmin) {
    if (!existingAdmin.role) existingAdmin.role = 'admin';
    if (typeof existingAdmin.emailVerified !== 'boolean') existingAdmin.emailVerified = true;
    if (typeof existingAdmin.failedLoginAttempts !== 'number') existingAdmin.failedLoginAttempts = 0;
    if (existingAdmin.lockoutUntil === undefined) existingAdmin.lockoutUntil = null;
    if (typeof existingAdmin.twoFactorEnabled !== 'boolean') existingAdmin.twoFactorEnabled = false;
    if (existingAdmin.twoFactorSecret === undefined) existingAdmin.twoFactorSecret = null;
    if (existingAdmin.twoFactorTempSecret === undefined) existingAdmin.twoFactorTempSecret = null;
    users.set(existingAdmin.id, existingAdmin);
    return;
  }

  const email = process.env.SEED_ADMIN_EMAIL || 'admin@docsync.local';
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin';
  const passwordHash = bcrypt.hashSync(password, 12);

  const admin = {
    id: uuidv4(),
    name: 'Admin',
    username: 'admin',
    email,
    passwordHash,
    createdAt: nowIso(),
    emailVerified: true,
    failedLoginAttempts: 0,
    lockoutUntil: null,
    role: 'admin',
    twoFactorEnabled: false,
    twoFactorSecret: null,
    twoFactorTempSecret: null,
  };

  users.set(admin.id, admin);
  ensureTenantBootstrapForUser(admin);

  console.log(`[seed] Admin user created → email: ${email}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[seed] Admin password: ${password}`);
  }
}

module.exports = { ensureAdminUser };
