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
    include: { tenant: true },
  });

  const tenantMap = new Map();
  for (const membership of memberships) {
    if (membership.tenant && !tenantMap.has(membership.tenant.id)) {
      tenantMap.set(membership.tenant.id, membership.tenant);
    }
  }

  return Array.from(tenantMap.values()).map((dbTenant) => ({
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
  const requestedTenantId =  req.user.currentTenantId ? req.user.currentTenantId : resolveRequestedTenantId(req) ;
  const membershipWhere = requestedTenantId
    ? { userId: req.user.id, status: 'active', tenantId: requestedTenantId }
    : { userId: req.user.id, status: 'active' };
  const preloadedMembership = Array.isArray(req.user.tenantMembership)
    ? req.user.tenantMembership[0]
    : null;
  const canReusePreloadedMembership = Boolean(
    preloadedMembership
      && preloadedMembership.tenant
      && (!requestedTenantId || preloadedMembership.tenantId === requestedTenantId),
  );

  const dbMembership = canReusePreloadedMembership
    ? preloadedMembership
    : await prisma.tenantMembership.findFirst({
        where: membershipWhere,
        orderBy: { createdAt: 'asc' },
        include: { tenant: true },
      });

  if (!dbMembership) {
    return res.status(403).json({
      error: requestedTenantId ? 'Tenant membership required.' : 'No active membership.',
    });
  }

  const resolvedMembership = {
    ...dbMembership,
    createdAt: dbMembership.createdAt instanceof Date ? dbMembership.createdAt.toISOString() : dbMembership.createdAt,
    updatedAt: dbMembership.updatedAt instanceof Date ? dbMembership.updatedAt.toISOString() : dbMembership.updatedAt,
  };

  const tenant = dbMembership.tenant ? {
    ...dbMembership.tenant,
    createdAt: dbMembership.tenant.createdAt instanceof Date ? dbMembership.tenant.createdAt.toISOString() : dbMembership.tenant.createdAt,
    updatedAt: dbMembership.tenant.updatedAt instanceof Date ? dbMembership.tenant.updatedAt.toISOString() : dbMembership.tenant.updatedAt,
  } : null;
  
  if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });
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
