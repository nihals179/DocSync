const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');

const {
  canAssignCollaborators,
  canAssignSeats,
  ensureWorkspaceForUserProvisioned,
  getOrganizationBillingState,
  getOrganizationEntitlements,
  getProfileTable,
  organizationInvites,
  organizationMemberships,
  organizations,
  users,
} = require('../store');
const { requireAuth, generateOpaqueToken } = require('../middleware/auth');
const {
  resolveOrganizationContext,
  requirePermission,
  getUserOrganizations,
} = require('../middleware/rbac');
const { writeAuditLog } = require('../lib/audit');

const router = express.Router();

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LEGACY_INVITE_ROLE = 'organization_member';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function nowIso() {
  return new Date().toISOString();
}

function mapMembership(membership) {
  const user = users.get(membership.userId);
  return {
    id: membership.id,
    userId: membership.userId,
    email: user?.email || 'unknown',
    name: user?.name || 'Unknown',
    billingAdmin: Boolean(membership.billingAdmin),
    status: membership.status,
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt,
  };
}

function mapInviteResponse(invite) {
  return {
    id: invite.id,
    email: invite.email,
    role: LEGACY_INVITE_ROLE,
    billingAdmin: invite.billingAdmin,
    status: invite.status,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    inviteToken: process.env.NODE_ENV === 'production' ? undefined : invite.token,
  };
}

function parseBooleanInput(value, fieldName) {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value === 'boolean') return { ok: true, value };
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return { ok: true, value: true };
    if (normalized === 'false') return { ok: true, value: false };
  }
  return { ok: false, error: `${fieldName} must be a boolean.` };
}

router.get('/mine', requireAuth, (req, res) => {
  const orgs = getUserOrganizations(req.user.id);
  const user = users.get(req.user.id);
  res.json({
    organizations: orgs,
    currentOrganizationId: user?.currentOrganizationId || null,
  });
});

router.get('/profiles', requireAuth, resolveOrganizationContext, requirePermission('organization.read'), (req, res) => {
  res.json({ profiles: getProfileTable() });
});

router.post('/switch', requireAuth, (req, res) => {
  const organizationId = String(req.body?.organizationId || '');
  if (!organizationId) return res.status(400).json({ error: 'organizationId is required.' });

  const membership = [...organizationMemberships.values()].find(
    (item) => item.organizationId === organizationId && item.userId === req.user.id && item.status === 'active',
  );
  if (!membership) return res.status(403).json({ error: 'Organization membership required.' });

  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  user.currentOrganizationId = organizationId;
  users.set(user.id, user);

  res.json({ message: 'Organization context updated.', organizationId });
});

router.get('/current', requireAuth, resolveOrganizationContext, requirePermission('organization.read'), (req, res) => {
  res.json({ organization: req.organization, membership: req.membership });
});

router.get('/current/members', requireAuth, resolveOrganizationContext, requirePermission('organization.read'), (req, res) => {
  const members = [...organizationMemberships.values()]
    .filter((membership) => membership.organizationId === req.organization.id && membership.status === 'active')
    .map(mapMembership)
    .sort((a, b) => a.email.localeCompare(b.email));
  res.json({ members });
});

router.get('/current/invites', requireAuth, resolveOrganizationContext, requirePermission('organization.invite.read'), (req, res) => {
  const invites = [...organizationInvites.values()]
    .filter((invite) => invite.organizationId === req.organization.id && invite.status === 'pending')
    .map(mapInviteResponse)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ invites });
});

router.post('/current/invites', requireAuth, resolveOrganizationContext, requirePermission('organization.member.invite'), async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  const billingAdminInput = parseBooleanInput(req.body?.billingAdmin, 'billingAdmin');
  if (!billingAdminInput.ok) return res.status(400).json({ error: billingAdminInput.error });
  const billingAdmin = billingAdminInput.value ?? false;
  const legacyRole = req.body?.role !== undefined ? String(req.body.role).trim() : null;

  if (!email) return res.status(400).json({ error: 'email is required.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email address.' });

  const seatCheck = await canAssignSeats(req.organization.id, 1);
  if (!seatCheck.allowed) {
    return res.status(402).json({ error: seatCheck.reason, code: 'seat_limit_exceeded' });
  }
  const collaboratorCheck = await canAssignCollaborators(req.organization.id, 1);
  if (!collaboratorCheck.allowed) {
    return res.status(402).json({ error: collaboratorCheck.reason, code: 'collaborator_limit_exceeded' });
  }

  const existingMembership = [...organizationMemberships.values()].find(
    (membership) => membership.organizationId === req.organization.id && membership.status === 'active' && users.get(membership.userId)?.email === email,
  );
  if (existingMembership) {
    return res.status(409).json({ error: 'User is already a member of this organization.' });
  }

  const duplicateInvite = [...organizationInvites.values()].find(
    (invite) => invite.organizationId === req.organization.id && invite.email === email && invite.status === 'pending',
  );
  if (duplicateInvite) {
    return res.status(409).json({ error: 'Pending invite already exists for this email.' });
  }

  const invite = {
    id: uuidv4(),
    token: generateOpaqueToken(),
    organizationId: req.organization.id,
    email,
    billingAdmin,
    status: 'pending',
    invitedByUserId: req.user.id,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    acceptedAt: null,
  };
  organizationInvites.set(invite.id, invite);

  writeAuditLog({
    userId: req.user.id,
    organizationId: req.organization.id,
    action: 'organization.invite.create',
    metadata: {
      email: invite.email,
      billingAdmin: invite.billingAdmin,
      legacyRoleProvided: Boolean(legacyRole),
    },
  });

  res.status(201).json({
    invite: mapInviteResponse(invite),
  });
});

router.post('/invites/accept', requireAuth, async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Invite token is required.' });

  const invite = [...organizationInvites.values()].find((item) => item.token === token);
  if (!invite || invite.status !== 'pending') {
    return res.status(404).json({ error: 'Invite not found or already consumed.' });
  }
  if (new Date(invite.expiresAt).getTime() <= Date.now()) {
    invite.status = 'expired';
    invite.updatedAt = nowIso();
    organizationInvites.set(invite.id, invite);
    return res.status(400).json({ error: 'Invite has expired.' });
  }

  const user = users.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if ((user.email || '').toLowerCase() !== invite.email.toLowerCase()) {
    return res.status(403).json({ error: 'Invite email does not match signed-in account.' });
  }

  const existingMembership = [...organizationMemberships.values()].find(
    (membership) => membership.organizationId === invite.organizationId && membership.userId === user.id,
  );

  const needsSeat = !existingMembership || existingMembership.status !== 'active';
  if (needsSeat) {
    const seatCheck = await canAssignSeats(invite.organizationId, 1);
    if (!seatCheck.allowed) {
      return res.status(402).json({ error: seatCheck.reason, code: 'seat_limit_exceeded' });
    }
  }

  if (!existingMembership || existingMembership.status !== 'active') {
    const collaboratorCheck = await canAssignCollaborators(invite.organizationId, 1);
    if (!collaboratorCheck.allowed) {
      return res.status(402).json({ error: collaboratorCheck.reason, code: 'collaborator_limit_exceeded' });
    }
  }

  if (existingMembership) {
    existingMembership.status = 'active';
    existingMembership.billingAdmin = invite.billingAdmin;
    existingMembership.updatedAt = nowIso();
    organizationMemberships.set(existingMembership.id, existingMembership);
  } else {
    const membership = {
      id: uuidv4(),
      organizationId: invite.organizationId,
      userId: user.id,
      billingAdmin: invite.billingAdmin,
      status: 'active',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    organizationMemberships.set(membership.id, membership);
  }

  invite.status = 'accepted';
  invite.acceptedAt = nowIso();
  invite.updatedAt = nowIso();
  organizationInvites.set(invite.id, invite);

  user.currentOrganizationId = invite.organizationId;
  const orgBilling = await getOrganizationBillingState(invite.organizationId);
  if (orgBilling?.planId === 'enterprise') {
    user.accountType = 'Enterprise';
    if (process.env.DATABASE_URL) {
      await prisma.user.update({
        where: { id: user.id },
        data: { accountType: 'Enterprise' },
      });
    }
  }
  users.set(user.id, user);

  try {
    await ensureWorkspaceForUserProvisioned(user, invite.organizationId);
  } catch {
    return res.status(500).json({ error: 'Invite accepted, but workspace provisioning failed.' });
  }

  writeAuditLog({
    userId: req.user.id,
    organizationId: invite.organizationId,
    action: 'organization.invite.accept',
    metadata: { inviteId: invite.id },
  });

  res.json({ message: 'Organization invite accepted.', organizationId: invite.organizationId });
});

router.patch('/current/members/:membershipId', requireAuth, resolveOrganizationContext, requirePermission('organization.member.manage'), (req, res) => {
  const targetMembership = organizationMemberships.get(req.params.membershipId);
  if (!targetMembership || targetMembership.organizationId !== req.organization.id || targetMembership.status !== 'active') {
    return res.status(404).json({ error: 'Member not found.' });
  }

  const billingAdminInput = parseBooleanInput(req.body?.billingAdmin, 'billingAdmin');
  if (!billingAdminInput.ok) return res.status(400).json({ error: billingAdminInput.error });
  const nextBillingAdmin = billingAdminInput.value !== undefined
    ? billingAdminInput.value
    : Boolean(targetMembership.billingAdmin);

  if (targetMembership.userId === req.organization.ownerUserId && req.user.id !== req.organization.ownerUserId) {
    return res.status(403).json({ error: 'Only organization owner can manage owner membership.' });
  }

  targetMembership.billingAdmin = nextBillingAdmin;
  targetMembership.updatedAt = nowIso();
  organizationMemberships.set(targetMembership.id, targetMembership);

  writeAuditLog({
    userId: req.user.id,
    organizationId: req.organization.id,
    action: 'organization.member.update',
    metadata: {
      membershipId: targetMembership.id,
      targetUserId: targetMembership.userId,
      billingAdmin: nextBillingAdmin,
    },
  });

  res.json({ member: mapMembership(targetMembership) });
});

router.delete('/current/members/:membershipId', requireAuth, resolveOrganizationContext, requirePermission('organization.member.manage'), (req, res) => {
  const targetMembership = organizationMemberships.get(req.params.membershipId);
  if (!targetMembership || targetMembership.organizationId !== req.organization.id || targetMembership.status !== 'active') {
    return res.status(404).json({ error: 'Member not found.' });
  }

  if (targetMembership.userId === req.organization.ownerUserId) {
    return res.status(403).json({ error: 'Owner cannot be removed.' });
  }

  targetMembership.status = 'removed';
  targetMembership.updatedAt = nowIso();
  organizationMemberships.set(targetMembership.id, targetMembership);

  writeAuditLog({
    userId: req.user.id,
    organizationId: req.organization.id,
    action: 'organization.member.remove',
    metadata: { membershipId: targetMembership.id, targetUserId: targetMembership.userId },
  });

  const removedUser = users.get(targetMembership.userId);
  if (removedUser && removedUser.currentOrganizationId === req.organization.id) {
    const fallback = [...organizationMemberships.values()].find(
      (membership) => membership.userId === removedUser.id && membership.status === 'active' && membership.organizationId !== req.organization.id,
    );
    removedUser.currentOrganizationId = fallback ? fallback.organizationId : null;
    users.set(removedUser.id, removedUser);
  }

  res.json({ message: 'Member removed.' });
});

router.get('/current/entitlements', requireAuth, resolveOrganizationContext, requirePermission('organization.read'), async (req, res) => {
  const entitlements = await getOrganizationEntitlements(req.organization.id);
  if (!entitlements) return res.status(404).json({ error: 'Entitlements unavailable.' });
  res.json({ entitlements });
});

module.exports = router;
