const { organizations, organizationMemberships, users } = require('../store');

const ROLE_OWNER = 'owner';
const ROLE_ADMIN = 'admin';
const ROLE_EDITOR = 'editor';
const ROLE_VIEWER = 'viewer';

const VALID_ROLES = new Set([ROLE_OWNER, ROLE_ADMIN, ROLE_EDITOR, ROLE_VIEWER]);

const PERMISSIONS_BY_ROLE = {
  [ROLE_OWNER]: new Set([
    'organization.read',
    'organization.member.invite',
    'organization.member.manage',
    'organization.invite.read',
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
  ]),
  [ROLE_ADMIN]: new Set([
    'organization.read',
    'organization.member.invite',
    'organization.member.manage',
    'organization.invite.read',
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
  ]),
  [ROLE_EDITOR]: new Set([
    'organization.read',
    'workspace.read',
    'workspace.create',
    'workspace.update',
    'document.read',
    'document.create',
    'document.update',
    'document.comment.read',
    'document.comment.write',
    'document.version.read',
    'document.version.write',
    'document.version.restore',
    'document.todo.read',
    'document.todo.write',
    'ai.use',
    'grammar.use',
  ]),
  [ROLE_VIEWER]: new Set([
    'organization.read',
    'workspace.read',
    'document.read',
    'document.comment.read',
    'document.version.read',
    'document.todo.read',
    'ai.use',
    'grammar.use',
  ]),
};

function normalizeRole(role) {
  const value = String(role || '').toLowerCase();
  return VALID_ROLES.has(value) ? value : null;
}

function getActiveMembership(userId, organizationId) {
  return [...organizationMemberships.values()].find(
    (membership) => membership.userId === userId && membership.organizationId === organizationId && membership.status === 'active',
  ) || null;
}

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
  const role = normalizeRole(membership.role);
  if (!role) return false;
  const allowed = PERMISSIONS_BY_ROLE[role];
  return Boolean(allowed && allowed.has(permission));
}

function requirePermission(permission) {
  return (req, res, next) => {
    const billingAction = permission === 'organization.billing.manage';
    if (billingAction) {
      const role = normalizeRole(req.membership?.role);
      const isOwner = role === ROLE_OWNER;
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
  ROLE_OWNER,
  ROLE_ADMIN,
  ROLE_EDITOR,
  ROLE_VIEWER,
  VALID_ROLES,
  normalizeRole,
  getActiveMembership,
  getUserOrganizations,
  resolveOrganizationContext,
  hasPermission,
  requirePermission,
};
