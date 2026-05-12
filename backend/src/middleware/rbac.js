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

function getUserOrganizations(userId) {
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

function resolveOrganizationContext(req, res, next) {
  const user = users.get(req.user.id);
  if (!user) return res.status(401).json({ error: 'User not found.' });

  const requestedOrganizationId = resolveRequestedOrganizationId(req) || user.currentOrganizationId || null;
  const activeMemberships = [...organizationMemberships.values()]
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

  const organization = organizations.get(resolvedMembership.organizationId);
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
