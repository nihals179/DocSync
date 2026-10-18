const { prisma } = require('../../db/client');

const MEMBER_PERMISSIONS = new Set([
  'tenant.read',
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

async function getUserTenants(userId) {
  const memberships = await prisma.tenantMembership.findMany({
    where: { userId, status: 'active' },
    orderBy: { createdAt: 'asc' },
    select: { tenantId: true },
  });

  const tenantIds = [...new Set(memberships.map((membership) => membership.tenantId))];
  if (!tenantIds.length) return [];

  const rows = await prisma.Tenant.findMany({
    where: { id: { in: tenantIds } },
    orderBy: { createdAt: 'asc' },
  });

  return rows.map((dbTenant) => ({
    ...dbTenant,
    createdAt: dbTenant.createdAt instanceof Date ? dbTenant.createdAt.toISOString() : dbTenant.createdAt,
    updatedAt: dbTenant.updatedAt instanceof Date ? dbTenant.updatedAt.toISOString() : dbTenant.updatedAt,
  }));
}

function resolveRequestedTenantId(req) {
  const fromHeader = typeof req.get === 'function'
    ? req.get('x-tenant-id')
    : req?.headers?.['x-tenant-id'];
  if (fromHeader && String(fromHeader).trim()) return String(fromHeader).trim();
  if (req.query?.tenantId && String(req.query.tenantId).trim()) return String(req.query.tenantId).trim();
  if (req.body?.tenantId && String(req.body.tenantId).trim()) return String(req.body.tenantId).trim();
  return null;
}

async function resolveTenantContext(req, res, next) {
  const requestedTenantId = resolveRequestedTenantId(req) || req.user.currentTenantId || null;
  const activeMemberships = (await prisma.tenantMembership.findMany({
    where: { userId: req.user.id, status: 'active' },
    orderBy: { createdAt: 'asc' },
  })).map((membership) => ({
    ...membership,
    createdAt: membership.createdAt instanceof Date ? membership.createdAt.toISOString() : membership.createdAt,
    updatedAt: membership.updatedAt instanceof Date ? membership.updatedAt.toISOString() : membership.updatedAt,
  }));

  if (activeMemberships.length === 0) {
    return res.status(403).json({ error: 'No active membership.' });
  }

  const resolvedMembership = requestedTenantId
    ? activeMemberships.find((membership) => membership.tenantId === requestedTenantId) || null
    : activeMemberships[0];

  if (!resolvedMembership) {
    return res.status(403).json({ error: 'Tenant membership required.' });
  }

  const dbTenant = await prisma.Tenant.findUnique({ where: { id: resolvedMembership.tenantId } });
  const tenant = dbTenant ? {
    ...dbTenant,
    createdAt: dbTenant.createdAt instanceof Date ? dbTenant.createdAt.toISOString() : dbTenant.createdAt,
    updatedAt: dbTenant.updatedAt instanceof Date ? dbTenant.updatedAt.toISOString() : dbTenant.updatedAt,
  } : null;
  if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });

  if (req.user.currentTenantId !== tenant.id) {
    await prisma.user.updateMany({
      where: { id: req.user.id },
      data: { currentTenantId: tenant.id },
    });
    req.user.currentTenantId = tenant.id;
  }

  req.tenant = tenant;
  req.membership = resolvedMembership;
  next();
}

function hasPermission(membership, permission) {
  if (!membership) return false;
  if (membership.status !== 'active') return false;
  return MEMBER_PERMISSIONS.has(permission);
}

function isTenantOwner(req) {
  return req.tenant?.ownerUserId === req.user?.id;
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (permission === 'tenant.member.invite' || permission === 'tenant.member.manage' || permission === 'tenant.invite.read') {
      if (!isTenantOwner(req)) {
        return res.status(403).json({ error: 'Permission denied.' });
      }
      return next();
    }

    const billingAction = permission === 'tenant.billing.manage';
    if (billingAction) {
      const isOwner = isTenantOwner(req);
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
  getUserTenants,
  resolveTenantContext,
  requirePermission,
};
