const { prisma } = require('../db/client');
const { isDatabaseConfigured } = require('../lib/runtime-utils');
const { organizations, organizationMemberships, users } = require('../store');

const MEMBER_PERMISSIONS = new Set([
  'organization.read',
  'workspace.read',
  'workspace.create',
  'workspace.update',
  'workspace.delete',
  'document.read',
  'document.create',
  'document.update',
  'document.delete',
  'document.comment.read',
  'document.comment.write',
  'document.comment.delete',
  'document.version.read',
  'document.version.write',
  'document.version.restore',
  'document.version.delete',
  'document.todo.read',
  'document.todo.write',
  'document.todo.delete',
  'ai.use',
  'grammar.use',
]);

async function getUserOrganizations(userId) {
  if (isDatabaseConfigured()) {
    const memberships = await prisma.organizationMembership.findMany({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'asc' },
      select: { organizationId: true },
    });

    const organizationIds = [...new Set(memberships.map((membership) => membership.organizationId))];
    if (!organizationIds.length) return [];

    const rows = await prisma.organization.findMany({
      where: { id: { in: organizationIds } },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((dbOrg) => ({
      ...dbOrg,
      createdAt: dbOrg.createdAt instanceof Date ? dbOrg.createdAt.toISOString() : dbOrg.createdAt,
      updatedAt: dbOrg.updatedAt instanceof Date ? dbOrg.updatedAt.toISOString() : dbOrg.updatedAt,
    }));
  }

  return [...organizationMemberships.values()]
    .filter((membership) => membership.userId === userId && membership.status === 'active')
    .map((membership) => organizations.get(membership.organizationId))
    .filter(Boolean);
}

function resolveRequestedOrganizationId(req) {
  const fromHeader = req.get('x-organization-id');
  if (fromHeader && String(fromHeader).trim()) return String(fromHeader).trim();
  if (req.query?.organizationId && String(req.query.organizationId).trim()) return String(req.query.organizationId).trim();
  if (req.body?.organizationId && String(req.body.organizationId).trim()) return String(req.body.organizationId).trim();
  return null;
}

async function resolveOrganizationContext(req, res, next) {
  let user = users.get(req.user.id);
  if (!user && isDatabaseConfigured()) {
    const dbUser = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (dbUser) {
      user = {
        ...dbUser,
        createdAt: dbUser.createdAt instanceof Date ? dbUser.createdAt.toISOString() : dbUser.createdAt,
        updatedAt: dbUser.updatedAt instanceof Date ? dbUser.updatedAt.toISOString() : dbUser.updatedAt,
      };
      users.set(user.id, user);
    }
  }
  if (!user) return res.status(401).json({ error: 'User not found.' });

  const requestedOrganizationId = resolveRequestedOrganizationId(req) || user.currentOrganizationId || null;
  const activeMemberships = isDatabaseConfigured()
    ? (await prisma.organizationMembership.findMany({
      where: { userId: req.user.id, status: 'active' },
      orderBy: { createdAt: 'asc' },
    })).map((membership) => ({
      ...membership,
      createdAt: membership.createdAt instanceof Date ? membership.createdAt.toISOString() : membership.createdAt,
      updatedAt: membership.updatedAt instanceof Date ? membership.updatedAt.toISOString() : membership.updatedAt,
    }))
    : [...organizationMemberships.values()]
      .filter((membership) => membership.userId === req.user.id && membership.status === 'active');

  if (activeMemberships.length === 0) {
    return res.status(403).json({ error: 'No active organization membership.' });
  }

  const resolvedMembership = requestedOrganizationId
    ? activeMemberships.find((membership) => membership.organizationId === requestedOrganizationId) || null
    : activeMemberships[0];

  if (!resolvedMembership) {
    return res.status(403).json({ error: 'Organization membership required.' });
  }

  let organization = organizations.get(resolvedMembership.organizationId);
  if (!organization && isDatabaseConfigured()) {
    const dbOrg = await prisma.organization.findUnique({ where: { id: resolvedMembership.organizationId } });
    if (dbOrg) {
      organization = {
        ...dbOrg,
        createdAt: dbOrg.createdAt instanceof Date ? dbOrg.createdAt.toISOString() : dbOrg.createdAt,
        updatedAt: dbOrg.updatedAt instanceof Date ? dbOrg.updatedAt.toISOString() : dbOrg.updatedAt,
      };
      organizations.set(organization.id, organization);
    }
  }
  if (!organization) return res.status(404).json({ error: 'Organization not found.' });

  if (user.currentOrganizationId !== organization.id) {
    user.currentOrganizationId = organization.id;
    users.set(user.id, user);
  }

  req.organization = organization;
  req.membership = resolvedMembership;
  next();
}

function hasPermission(membership, permission) {
  if (!membership) return false;
  if (membership.status !== 'active') return false;
  return MEMBER_PERMISSIONS.has(permission);
}

function isOrganizationOwner(req) {
  return req.organization?.ownerUserId === req.user?.id;
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (permission === 'organization.member.invite' || permission === 'organization.member.manage' || permission === 'organization.invite.read') {
      if (!isOrganizationOwner(req)) {
        return res.status(403).json({ error: 'Permission denied.' });
      }
      return next();
    }

    const billingAction = permission === 'organization.billing.manage';
    if (billingAction) {
      const isOwner = isOrganizationOwner(req);
      if (!isOwner && !req.membership?.billingAdmin) {
        return res.status(403).json({ error: 'Permission denied.' });
      }
      return next();
    }

    if (!hasPermission(req.membership, permission)) {
      return res.status(403).json({ error: 'Permission denied.' });
    }
    return next();
  };
}

module.exports = {
  getUserOrganizations,
  resolveOrganizationContext,
  requirePermission,
};
