const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('./client');
const {
  initializePersistentMaps,
  users,
  userBilling,
  userUsage,
  organizations,
  organizationMemberships,
} = require('../store');

const TEST_PASSWORD = process.env.SEED_TEST_PASSWORD || 'Password123!';

function nowIso() {
  return new Date().toISOString();
}

function daysFromNow(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function monthKeyFromDate(input = new Date()) {
  return `${input.getUTCFullYear()}-${String(input.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function upsertUserWithBilling({
  name,
  email,
  emailVerified,
  failedLoginAttempts,
  lockoutUntil,
  twoFactorEnabled,
  planId,
  billingStatus,
  aiRequests,
  documentUpdates,
}) {
  const normalizedEmail = String(email || '').toLowerCase();
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  const userId = existing?.id || uuidv4();

  const persistedUser = await prisma.user.upsert({
    where: { email: normalizedEmail },
    update: {
      name,
      passwordHash,
      accountType: 'individual',
      emailVerified: Boolean(emailVerified),
      failedLoginAttempts: Number(failedLoginAttempts || 0),
      lockoutUntil: lockoutUntil || null,
      role: 'user',
      twoFactorEnabled: Boolean(twoFactorEnabled),
      twoFactorSecret: null,
      twoFactorTempSecret: null,
      currentOrganizationId: null,
    },
    create: {
      id: userId,
      name,
      email: normalizedEmail,
      passwordHash,
      accountType: 'individual',
      emailVerified: Boolean(emailVerified),
      failedLoginAttempts: Number(failedLoginAttempts || 0),
      lockoutUntil: lockoutUntil || null,
      role: 'user',
      twoFactorEnabled: Boolean(twoFactorEnabled),
      twoFactorSecret: null,
      twoFactorTempSecret: null,
      currentOrganizationId: null,
      createdAt: nowIso(),
    },
  });

  const persistedBilling = await prisma.userBilling.upsert({
    where: { userId },
    update: {
      planId,
      status: billingStatus,
      trialEndsAt: null,
      trialUsed: false,
      subscriptionId: billingStatus === 'active' && planId === 'pro' ? `sub_test_${userId.slice(0, 8)}` : null,
      customerId: `cus_test_${userId.slice(0, 8)}`,
      currentPeriodEndAt: billingStatus === 'canceled' ? daysFromNow(-1) : daysFromNow(30),
      graceEndsAt: billingStatus === 'suspended' ? daysFromNow(-1) : null,
    },
    create: {
      userId,
      planId,
      status: billingStatus,
      trialEndsAt: null,
      trialUsed: false,
      subscriptionId: billingStatus === 'active' && planId === 'pro' ? `sub_test_${userId.slice(0, 8)}` : null,
      customerId: `cus_test_${userId.slice(0, 8)}`,
      currentPeriodEndAt: billingStatus === 'canceled' ? daysFromNow(-1) : daysFromNow(30),
      graceEndsAt: billingStatus === 'suspended' ? daysFromNow(-1) : null,
    },
  });

  const currentMonthKey = monthKeyFromDate(new Date());
  const persistedUsage = await prisma.userUsage.upsert({
    where: { userId_monthKey: { userId, monthKey: monthKeyFromDate(new Date()) } },
    update: {
      aiRequests: Number(aiRequests || 0),
      documentUpdates: Number(documentUpdates || 0),
    },
    create: {
      userId,
      monthKey: currentMonthKey,
      aiRequests: Number(aiRequests || 0),
      documentUpdates: Number(documentUpdates || 0),
    },
  });

  users.set(userId, {
    id: persistedUser.id,
    name: persistedUser.name,
    email: persistedUser.email,
    passwordHash: persistedUser.passwordHash,
    createdAt: new Date(persistedUser.createdAt).toISOString(),
    accountType: persistedUser.accountType,
    emailVerified: persistedUser.emailVerified,
    failedLoginAttempts: persistedUser.failedLoginAttempts,
    lockoutUntil: persistedUser.lockoutUntil ? new Date(persistedUser.lockoutUntil).toISOString() : null,
    role: persistedUser.role,
    twoFactorEnabled: persistedUser.twoFactorEnabled,
    twoFactorSecret: persistedUser.twoFactorSecret,
    twoFactorTempSecret: persistedUser.twoFactorTempSecret,
    currentOrganizationId: persistedUser.currentOrganizationId || null,
  });

  userBilling.set(userId, {
    userId: persistedBilling.userId,
    planId: persistedBilling.planId,
    status: persistedBilling.status,
    trialEndsAt: persistedBilling.trialEndsAt ? new Date(persistedBilling.trialEndsAt).toISOString() : null,
    trialUsed: persistedBilling.trialUsed,
    subscriptionId: persistedBilling.subscriptionId,
    customerId: persistedBilling.customerId,
    currentPeriodEndAt: persistedBilling.currentPeriodEndAt
      ? new Date(persistedBilling.currentPeriodEndAt).toISOString()
      : null,
    graceEndsAt: persistedBilling.graceEndsAt ? new Date(persistedBilling.graceEndsAt).toISOString() : null,
    updatedAt: nowIso(),
  });

  userUsage.set(userId, {
    userId: persistedUsage.userId,
    monthKey: persistedUsage.monthKey,
    aiRequests: persistedUsage.aiRequests,
    documentUpdates: persistedUsage.documentUpdates,
  });

  return { userId, email: normalizedEmail, planId, billingStatus };
}

async function upsertEnterpriseMembers() {
  const members = [
    {
      name: 'Enterprise Owner User',
      email: 'test.enterprise.owner@docsync.local',
      billingAdmin: true,
    },
    {
      name: 'Enterprise Admin User',
      email: 'test.enterprise.admin@docsync.local',
      billingAdmin: true,
    },
    {
      name: 'Enterprise Editor User',
      email: 'test.enterprise.editor@docsync.local',
      billingAdmin: false,
    },
  ];

  const seededUsers = [];
  for (const member of members) {
    const seeded = await upsertUserWithBilling({
      name: member.name,
      email: member.email,
      emailVerified: true,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      twoFactorEnabled: false,
      planId: 'pro',
      billingStatus: 'active',
      aiRequests: 100,
      documentUpdates: 300,
    });
    seededUsers.push({ ...seeded, billingAdmin: member.billingAdmin });
  }

  const owner = seededUsers[0];
  const organizationId = 'org_test_enterprise_shared';
  const now = nowIso();

  const persistedOrganization = await prisma.organization.upsert({
    where: { id: organizationId },
    update: {
      name: 'Test Enterprise Shared Org',
      ownerUserId: owner.userId,
      billing: {
        planId: 'enterprise',
        status: 'active',
        purchasedSeats: 50,
        trialEndsAt: null,
        trialUsed: true,
        subscriptionId: 'sub_test_enterprise_shared',
        customerId: 'cus_test_enterprise_shared',
        currentPeriodEndAt: daysFromNow(30),
        graceEndsAt: null,
        updatedAt: now,
      },
      security: {
        requireMfa: false,
        sessionDurationHours: 8,
        ipAllowlistEnabled: false,
        ipAllowlist: [],
        domainMappings: ['enterprise.docsync.local'],
        ssoProviders: [],
        updatedAt: now,
      },
    },
    create: {
      id: organizationId,
      name: 'Test Enterprise Shared Org',
      ownerUserId: owner.userId,
      createdAt: now,
      billing: {
        planId: 'enterprise',
        status: 'active',
        purchasedSeats: 50,
        trialEndsAt: null,
        trialUsed: true,
        subscriptionId: 'sub_test_enterprise_shared',
        customerId: 'cus_test_enterprise_shared',
        currentPeriodEndAt: daysFromNow(30),
        graceEndsAt: null,
        updatedAt: now,
      },
      security: {
        requireMfa: false,
        sessionDurationHours: 8,
        ipAllowlistEnabled: false,
        ipAllowlist: [],
        domainMappings: ['enterprise.docsync.local'],
        ssoProviders: [],
        updatedAt: now,
      },
    },
  });

  organizations.set(organizationId, {
    id: persistedOrganization.id,
    name: persistedOrganization.name,
    ownerUserId: persistedOrganization.ownerUserId,
    billing: persistedOrganization.billing,
    security: persistedOrganization.security,
    createdAt: new Date(persistedOrganization.createdAt).toISOString(),
    updatedAt: new Date(persistedOrganization.updatedAt).toISOString(),
  });

  for (const member of seededUsers) {
    const persistedMembership = await prisma.organizationMembership.upsert({
      where: {
        organizationId_userId: {
          organizationId,
          userId: member.userId,
        },
      },
      update: {
        billingAdmin: member.billingAdmin,
        status: 'active',
      },
      create: {
        id: uuidv4(),
        organizationId,
        userId: member.userId,
        billingAdmin: member.billingAdmin,
        status: 'active',
      },
    });

    organizationMemberships.set(persistedMembership.id, {
      id: persistedMembership.id,
      organizationId: persistedMembership.organizationId,
      userId: persistedMembership.userId,
      billingAdmin: persistedMembership.billingAdmin,
      status: persistedMembership.status,
      createdAt: new Date(persistedMembership.createdAt).toISOString(),
      updatedAt: new Date(persistedMembership.updatedAt).toISOString(),
    });

    const updatedUser = await prisma.user.update({
      where: { id: member.userId },
      data: { currentOrganizationId: organizationId },
    });

    const existingMapUser = users.get(member.userId);
    if (existingMapUser) {
      existingMapUser.currentOrganizationId = organizationId;
      users.set(member.userId, existingMapUser);
    } else {
      users.set(member.userId, {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        passwordHash: updatedUser.passwordHash,
        createdAt: new Date(updatedUser.createdAt).toISOString(),
        accountType: updatedUser.accountType,
        emailVerified: updatedUser.emailVerified,
        failedLoginAttempts: updatedUser.failedLoginAttempts,
        lockoutUntil: updatedUser.lockoutUntil ? new Date(updatedUser.lockoutUntil).toISOString() : null,
        role: updatedUser.role,
        twoFactorEnabled: updatedUser.twoFactorEnabled,
        twoFactorSecret: updatedUser.twoFactorSecret,
        twoFactorTempSecret: updatedUser.twoFactorTempSecret,
        currentOrganizationId: organizationId,
      });
    }
  }

  return {
    organizationId,
    members: seededUsers,
  };
}

async function seedTestUsers() {
  await initializePersistentMaps();

  const users = [
    {
      name: 'Free Verified User',
      email: 'test.free@docsync.local',
      emailVerified: true,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      twoFactorEnabled: false,
      planId: 'free',
      billingStatus: 'active',
      aiRequests: 25,
      documentUpdates: 140,
    },
    {
      name: 'Pro Verified User',
      email: 'test.pro@docsync.local',
      emailVerified: true,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      twoFactorEnabled: true,
      planId: 'pro',
      billingStatus: 'active',
      aiRequests: 950,
      documentUpdates: 1200,
    },
    {
      name: 'Unverified Free User',
      email: 'test.unverified@docsync.local',
      emailVerified: false,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      twoFactorEnabled: false,
      planId: 'free',
      billingStatus: 'active',
      aiRequests: 0,
      documentUpdates: 0,
    },
    {
      name: 'Locked User',
      email: 'test.locked@docsync.local',
      emailVerified: true,
      failedLoginAttempts: 5,
      lockoutUntil: daysFromNow(1),
      twoFactorEnabled: false,
      planId: 'free',
      billingStatus: 'active',
      aiRequests: 5,
      documentUpdates: 60,
    },
    {
      name: 'Suspended Billing User',
      email: 'test.suspended@docsync.local',
      emailVerified: true,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      twoFactorEnabled: false,
      planId: 'pro',
      billingStatus: 'suspended',
      aiRequests: 300,
      documentUpdates: 700,
    },
  ];

  const results = [];
  for (const user of users) {
    results.push(await upsertUserWithBilling(user));
  }

  const enterpriseSetup = await upsertEnterpriseMembers();

  console.log(`Seeded test users: ${results.length}`);
  for (const row of results) {
    console.log(`- ${row.email} | plan=${row.planId} | billing=${row.billingStatus}`);
  }
  console.log(`Seeded enterprise organization: ${enterpriseSetup.organizationId}`);
  for (const member of enterpriseSetup.members) {
    console.log(`- ${member.email}`);
  }
  console.log(`Password for all test users: ${TEST_PASSWORD}`);
}

seedTestUsers()
  .catch((error) => {
    console.error('Failed to seed test users:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
