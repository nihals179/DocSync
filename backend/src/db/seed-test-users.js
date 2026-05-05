const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('./client');

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

  await prisma.user.upsert({
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

  await prisma.userBilling.upsert({
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

  await prisma.userUsage.upsert({
    where: { userId_monthKey: { userId, monthKey: monthKeyFromDate(new Date()) } },
    update: {
      aiRequests: Number(aiRequests || 0),
      documentUpdates: Number(documentUpdates || 0),
    },
    create: {
      userId,
      monthKey: monthKeyFromDate(new Date()),
      aiRequests: Number(aiRequests || 0),
      documentUpdates: Number(documentUpdates || 0),
    },
  });

  return { userId, email: normalizedEmail, planId, billingStatus };
}

async function upsertEnterpriseMembers() {
  const members = [
    {
      name: 'Enterprise Owner User',
      email: 'test.enterprise.owner@docsync.local',
      role: 'owner',
      billingAdmin: true,
    },
    {
      name: 'Enterprise Admin User',
      email: 'test.enterprise.admin@docsync.local',
      role: 'admin',
      billingAdmin: true,
    },
    {
      name: 'Enterprise Editor User',
      email: 'test.enterprise.editor@docsync.local',
      role: 'editor',
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
    seededUsers.push({ ...seeded, role: member.role, billingAdmin: member.billingAdmin });
  }

  const owner = seededUsers.find((member) => member.role === 'owner');
  const organizationId = 'org_test_enterprise_shared';
  const now = nowIso();

  await prisma.organization.upsert({
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

  for (const member of seededUsers) {
    await prisma.organizationMembership.upsert({
      where: {
        organizationId_userId: {
          organizationId,
          userId: member.userId,
        },
      },
      update: {
        role: member.role,
        billingAdmin: member.billingAdmin,
        status: 'active',
      },
      create: {
        id: uuidv4(),
        organizationId,
        userId: member.userId,
        role: member.role,
        billingAdmin: member.billingAdmin,
        status: 'active',
      },
    });

    await prisma.user.update({
      where: { id: member.userId },
      data: { currentOrganizationId: organizationId },
    });
  }

  return {
    organizationId,
    members: seededUsers,
  };
}

async function seedTestUsers() {
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
    console.log(`- ${member.email} | orgRole=${member.role}`);
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
