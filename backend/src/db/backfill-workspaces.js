const { v4: uuidv4 } = require('uuid');
const { prisma } = require('./client');

function workspaceNameForUser(user) {
  const base = String(user?.name || '').trim();
  return base ? `${base}'s Workspace` : 'Personal Workspace';
}

function organizationNameForUser(user) {
  const base = String(user?.name || '').trim();
  return base ? `${base}'s Organization` : 'Personal Organization';
}

async function ensureDefaultOrganizationForUser(user) {
  const now = new Date();
  const organizationId = uuidv4();

  await prisma.organization.create({
    data: {
      id: organizationId,
      name: organizationNameForUser(user),
      ownerUserId: user.id,
      createdAt: now,
      updatedAt: now,
    },
  });

  await prisma.organizationMembership.create({
    data: {
      id: uuidv4(),
      organizationId,
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
    data: { currentOrganizationId: organizationId },
  });

  return organizationId;
}

async function collectTargetOrganizationsForUser(user) {
  const memberships = await prisma.organizationMembership.findMany({
    where: {
      userId: user.id,
      status: 'active',
    },
    select: {
      organizationId: true,
    },
  });

  const organizationIds = new Set(memberships.map((membership) => membership.organizationId));

  if (user.currentOrganizationId) {
    const currentOrg = await prisma.organization.findUnique({
      where: { id: user.currentOrganizationId },
      select: { id: true },
    });
    if (currentOrg) organizationIds.add(currentOrg.id);
  }

  if (organizationIds.size === 0) {
    const fallbackOrgId = await ensureDefaultOrganizationForUser(user);
    organizationIds.add(fallbackOrgId);
  }

  return [...organizationIds];
}

async function ensurePersonalWorkspaceForUser(user) {
  const personalScopeId = user.id;

  const existing = await prisma.workspace.findFirst({
    where: {
      ownerId: user.id,
      organizationId: personalScopeId,
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
      organizationId: personalScopeId,
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
        organizationId: user.id,
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
    select: {
      id: true,
      organizationId: true,
    },
  });

  if (personalRows.length === 0) return 0;

  let migrated = 0;
  const keeper = personalRows[0];
  await prisma.workspace.update({
    where: { id: keeper.id },
    data: { organizationId: user.id },
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
      currentOrganizationId: true,
    },
  });

  let createdOrganizations = 0;
  let createdWorkspaces = 0;
  let migratedPersonalRows = 0;

  for (const user of users) {
    const beforeMembershipCount = await prisma.organizationMembership.count({
      where: {
        userId: user.id,
        status: 'active',
      },
    });

    await collectTargetOrganizationsForUser(user);
    if (beforeMembershipCount === 0) {
      createdOrganizations += 1;
    }

    migratedPersonalRows += await migrateLegacyPersonalWorkspacesForUser(user);

    const personalCreated = await ensurePersonalWorkspaceForUser(user);
    if (personalCreated) createdWorkspaces += 1;
  }

  console.log(
    `Workspace backfill completed. users=${users.length} organizationsCreated=${createdOrganizations} personalRowsMigrated=${migratedPersonalRows} workspacesCreated=${createdWorkspaces}`,
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
