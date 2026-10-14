const { v4: uuidv4 } = require('uuid');
const { prisma } = require('./client');

function workspaceNameForUser(user) {
  const base = String(user?.name || '').trim();
  return base ? `${base}'s Workspace` : 'Personal Workspace';
}

function tenantNameForUser(user) {
  const base = String(user?.name || '').trim();
  return base ? `${base}'s Tenant` : 'Personal Tenant';
}

async function ensureDefaultTenantForUser(user) {
  const now = new Date();
  const tenantId = uuidv4();

  await prisma.tenant.create({
    data: {
      id: tenantId,
      name: tenantNameForUser(user),
      ownerUserId: user.id,
      createdAt: now,
      updatedAt: now,
    },
  });

  await prisma.tenantMembership.create({
    data: {
      id: uuidv4(),
      tenantId,
      userId: user.id,
      email: String(user.email || '').toLowerCase(),
      billingAdmin: true,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { currentTenantId: tenantId },
  });

  return tenantId;
}

async function collectTargetTenantsForUser(user) {
  const memberships = await prisma.tenantMembership.findMany({
    where: {
      userId: user.id,
      status: 'active',
    },
    select: {
      tenantId: true,
    },
  });

  const tenantIds = new Set(memberships.map((membership) => membership.tenantId));

  if (user.currentTenantId) {
    const currentOrg = await prisma.tenant.findUnique({
      where: { id: user.currentTenantId },
      select: { id: true },
    });
    if (currentOrg) tenantIds.add(currentOrg.id);
  }

  if (tenantIds.size === 0) {
    const fallbackOrgId = await ensureDefaultTenantForUser(user);
    tenantIds.add(fallbackOrgId);
  }

  return [...tenantIds];
}

async function ensurePersonalWorkspaceForUser(user) {
  const personalScopeId = user.id;

  const existing = await prisma.workspace.findFirst({
    where: {
      ownerId: user.id,
      tenantId: personalScopeId,
    },
    select: { id: true },
  });

  if (existing) return false;

  const now = new Date();
  await prisma.workspace.create({
    data: {
      id: uuidv4(),
      name: workspaceNameForUser(user),
      ownerId: user.id,
      tenantId: personalScopeId,
      memberIds: [user.id],
      createdAt: now,
    },
  });

  return true;
}

async function migrateLegacyPersonalWorkspacesForUser(user) {
  const personalRows = await prisma.workspace.findMany({
    where: {
      ownerId: user.id,
      memberIds: {
        equals: [user.id],
      },
      NOT: {
        tenantId: user.id,
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
    select: {
      id: true,
      tenantId: true,
    },
  });

  if (personalRows.length === 0) return 0;

  let migrated = 0;
  const keeper = personalRows[0];
  await prisma.workspace.update({
    where: { id: keeper.id },
    data: { tenantId: user.id },
  });
  migrated += 1;

  for (const row of personalRows.slice(1)) {
    await prisma.workspace.delete({ where: { id: row.id } });
    migrated += 1;
  }

  return migrated;
}

async function backfillWorkspacesForExistingUsers() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to backfill workspace records.');
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      currentTenantId: true,
    },
  });

  let createdTenants = 0;
  let createdWorkspaces = 0;
  let migratedPersonalRows = 0;

  for (const user of users) {
    const beforeMembershipCount = await prisma.tenantMembership.count({
      where: {
        userId: user.id,
        status: 'active',
      },
    });

    await collectTargetTenantsForUser(user);
    if (beforeMembershipCount === 0) {
      createdTenants += 1;
    }

    migratedPersonalRows += await migrateLegacyPersonalWorkspacesForUser(user);

    const personalCreated = await ensurePersonalWorkspaceForUser(user);
    if (personalCreated) createdWorkspaces += 1;
  }

  console.log(
    `Workspace backfill completed. users=${users.length} tenantsCreated=${createdTenants} personalRowsMigrated=${migratedPersonalRows} workspacesCreated=${createdWorkspaces}`,
  );
}

backfillWorkspacesForExistingUsers()
  .catch((error) => {
    console.error('Workspace backfill failed:', error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
