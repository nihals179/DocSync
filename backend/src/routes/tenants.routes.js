const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');

const {
  canAssignCollaborators,
  canAssignSeats,
  ensureWorkspaceForUserProvisioned,
  getTenantBillingState,
  getTenantEntitlements,
  getProfileTable,
} = require('../store');
const { requireAuth, generateOpaqueToken } = require('../middleware/auth/core');
const {
  resolveTenantContext,
  requirePermission,
  getUserTenants,
} = require('../middleware/rbac');
const {
  mapInviteResponse,
  parseBooleanInput,
} = require('../middleware/tenants');
const { writeAuditLog } = require('../lib/audit');
const { serializeBigInt } = require('../utils/serialization');

const router = express.Router();

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toIso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function mapMembershipRecord(membership, user) {
  return {
    id: membership.id,
    userId: membership.userId,
    email: user?.email || membership.email || 'unknown',
    name: user?.name || 'Unknown',
    billingAdmin: Boolean(membership.billingAdmin),
    status: membership.status,
    createdAt: toIso(membership.createdAt),
    updatedAt: toIso(membership.updatedAt),
  };
}

function mapInviteRecord(invite) {
  return {
    ...invite,
    createdAt: toIso(invite.createdAt),
    updatedAt: toIso(invite.updatedAt),
    expiresAt: toIso(invite.expiresAt),
    acceptedAt: toIso(invite.acceptedAt),
  };
}

router.get('/mine', requireAuth, async (req, res) => {
  const tenants = await getUserTenants(req.user.id);
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { currentTenantId: true } });
  res.json({
    tenants: tenants,
    currentTenantId: user?.currentTenantId || null,
  });
});

router.get('/profiles', requireAuth, resolveTenantContext, requirePermission('tenant.read'), async (req, res) => {
  res.json({ profiles: await getProfileTable() });
});

router.post('/switch', requireAuth, async (req, res) => {
  const tenantId = String(req.body?.tenants || '');
  if (!tenantId) return res.status(400).json({ error: 'Tenant id is required.' });

  const membership = await prisma.tenantMembership.findFirst({
    where: {
      tenantId,
      userId: req.user.id,
      status: 'active',
    },
  });
  if (!membership) return res.status(403).json({ error: 'Tenant membership required.' });

  const updated = await prisma.user.updateMany({
    where: { id: req.user.id },
    data: { currentTenantId: tenantId },
  });
  if (!updated.count) return res.status(404).json({ error: 'User not found.' });

  res.json({ message: 'Tenant context updated.', tenantId });
});

router.get('/current', requireAuth, resolveTenantContext, requirePermission('tenant.read'), (req, res) => {
  res.json({ tenant: req.tenant, membership: req.membership });
});

router.get('/current/members', requireAuth, resolveTenantContext, requirePermission('tenant.read'), async (req, res) => {
  const memberships = await prisma.tenantMembership.findMany({
    where: {
      tenantId: req.tenant.id,
      status: 'active',
    },
  });
  const userIds = [...new Set(memberships.map((membership) => membership.userId))];
  const users = userIds.length
    ? await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, name: true },
    })
    : [];
  const userById = new Map(users.map((user) => [user.id, user]));
  const members = memberships
    .map((membership) => mapMembershipRecord(membership, userById.get(membership.userId)))
    .sort((a, b) => a.email.localeCompare(b.email));
  res.json({ members });
});

router.get('/current/invites', requireAuth, resolveTenantContext, requirePermission('tenant.invite.read'), async (req, res) => {
  const invites = (await prisma.TenantInvite.findMany({
    where: {
      tenantId: req.tenant.id,
      status: 'pending',
    },
  }))
    .map(mapInviteRecord)
    .map(mapInviteResponse)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ invites });
});

router.post('/current/invites', requireAuth, resolveTenantContext, requirePermission('tenant.member.invite'), async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  const billingAdminInput = parseBooleanInput(req.body?.billingAdmin, 'billingAdmin');
  if (!billingAdminInput.ok) return res.status(400).json({ error: billingAdminInput.error });
  const billingAdmin = billingAdminInput.value ?? false;
  const legacyRole = req.body?.role !== undefined ? String(req.body.role).trim() : null;

  if (!email) return res.status(400).json({ error: 'email is required.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email address.' });

  const seatCheck = await canAssignSeats(req.tenant.id, 1);
  if (!seatCheck.allowed) {
    return res.status(402).json({ error: seatCheck.reason, code: 'seat_limit_exceeded' });
  }
  const collaboratorCheck = await canAssignCollaborators(req.tenant.id, 1);
  if (!collaboratorCheck.allowed) {
    return res.status(402).json({ error: collaboratorCheck.reason, code: 'collaborator_limit_exceeded' });
  }

  const existingMembership = await prisma.tenantMembership.findFirst({
    where: {
      tenantId: req.tenant.id,
      status: 'active',
      email,
    },
  });
  if (existingMembership) {
    return res.status(409).json({ error: 'User is already a member of this tenant.' });
  }

  const duplicateInvite = await prisma.TenantInvite.findFirst({
    where: {
      tenantId: req.tenant.id,
      email,
      status: 'pending',
    },
  });
  if (duplicateInvite) {
    return res.status(409).json({ error: 'Pending invite already exists for this email.' });
  }

  const invite = await prisma.TenantInvite.create({
    data: {
      id: uuidv4(),
      token: generateOpaqueToken(),
      tenantId: req.tenant.id,
      email,
      billingAdmin,
      status: 'pending',
      invitedByUserId: req.user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      acceptedAt: null,
    },
  });

  const inviteRecord = mapInviteRecord(invite);

  writeAuditLog({
    userId: req.user.id,
    tenantId: req.tenant.id,
    action: 'tenant.invite.create',
    metadata: {
      email: inviteRecord.email,
      billingAdmin: inviteRecord.billingAdmin,
      legacyRoleProvided: Boolean(legacyRole),
    },
  });

  res.status(201).json({
    invite: mapInviteResponse(inviteRecord),
  });
});

router.post('/invites/accept', requireAuth, async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Invite token is required.' });

  const invite = await prisma.TenantInvite.findUnique({
    where: { token },
  });
  if (!invite || invite.status !== 'pending') {
    return res.status(404).json({ error: 'Invite not found or already consumed.' });
  }
  if (new Date(invite.expiresAt).getTime() <= Date.now()) {
    await prisma.TenantInvite.update({
      where: { id: invite.id },
      data: {
        status: 'expired',
        updatedAt: new Date(),
      },
    });
    return res.status(400).json({ error: 'Invite has expired.' });
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if ((user.email || '').toLowerCase() !== invite.email.toLowerCase()) {
    return res.status(403).json({ error: 'Invite email does not match signed-in account.' });
  }

  const existingMembership = await prisma.tenantMembership.findFirst({
    where: {
      tenantId: invite.tenantId,
      userId: user.id,
    },
  });

  const needsSeat = !existingMembership || existingMembership.status !== 'active';
  if (needsSeat) {
    const seatCheck = await canAssignSeats(invite.tenantId, 1);
    if (!seatCheck.allowed) {
      return res.status(402).json({ error: seatCheck.reason, code: 'seat_limit_exceeded' });
    }
  }

  if (!existingMembership || existingMembership.status !== 'active') {
    const collaboratorCheck = await canAssignCollaborators(invite.tenantId, 1);
    if (!collaboratorCheck.allowed) {
      return res.status(402).json({ error: collaboratorCheck.reason, code: 'collaborator_limit_exceeded' });
    }
  }

  if (existingMembership) {
    await prisma.tenantMembership.update({
      where: { id: existingMembership.id },
      data: {
        status: 'active',
        billingAdmin: invite.billingAdmin,
        email: user.email,
        updatedAt: new Date(),
      },
    });
  } else {
    await prisma.tenantMembership.create({
      data: {
        id: uuidv4(),
        tenantId: invite.tenantId,
        userId: user.id,
        email: user.email,
        billingAdmin: invite.billingAdmin,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  await prisma.TenantInvite.update({
    where: { id: invite.id },
    data: {
      status: 'accepted',
      acceptedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  const userUpdateData = {
    currentTenantId: invite.tenantId,
  };
  const tenantBilling = await getTenantBillingState(invite.tenantId);
  if (tenantBilling?.planId === 'enterprise') {
    userUpdateData.accountType = 'Enterprise';
  }
  await prisma.user.update({
    where: { id: user.id },
    data: userUpdateData,
  });

  try {
    await ensureWorkspaceForUserProvisioned(user);
  } catch {
    return res.status(500).json({ error: 'Invite accepted, but workspace provisioning failed.' });
  }

  writeAuditLog({
    userId: req.user.id,
    tenantId: invite.tenantId,
    action: 'tenant.invite.accept',
    metadata: { inviteId: invite.id },
  });

  res.json({ message: 'Tenant invite accepted.', tenantId: invite.tenantId });
});

router.patch('/current/members/:membershipId', requireAuth, resolveTenantContext, requirePermission('tenant.member.manage'), async (req, res) => {
  const targetMembership = await prisma.tenantMembership.findUnique({
    where: { id: req.params.membershipId },
  });
  if (!targetMembership || targetMembership.tenantId !== req.tenant.id || targetMembership.status !== 'active') {
    return res.status(404).json({ error: 'Member not found.' });
  }

  const billingAdminInput = parseBooleanInput(req.body?.billingAdmin, 'billingAdmin');
  if (!billingAdminInput.ok) return res.status(400).json({ error: billingAdminInput.error });
  const nextBillingAdmin = billingAdminInput.value !== undefined
    ? billingAdminInput.value
    : Boolean(targetMembership.billingAdmin);

  if (targetMembership.userId === req.tenant.ownerUserId && req.user.id !== req.tenant.ownerUserId) {
    return res.status(403).json({ error: 'Only tenant owner can manage owner membership.' });
  }

  const updatedMembership = await prisma.tenantMembership.update({
    where: { id: targetMembership.id },
    data: {
      billingAdmin: nextBillingAdmin,
      updatedAt: new Date(),
    },
  });

  writeAuditLog({
    userId: req.user.id,
    tenantId: req.tenant.id,
    action: 'tenant.member.update',
    metadata: {
      membershipId: updatedMembership.id,
      targetUserId: updatedMembership.userId,
      billingAdmin: nextBillingAdmin,
    },
  });

  const targetUser = await prisma.user.findUnique({
    where: { id: updatedMembership.userId },
    select: { id: true, email: true, name: true },
  });
  res.json({ member: mapMembershipRecord(updatedMembership, targetUser) });
});

router.delete('/current/members/:membershipId', requireAuth, resolveTenantContext, requirePermission('tenant.member.manage'), async (req, res) => {
  const targetMembership = await prisma.tenantMembership.findUnique({
    where: { id: req.params.membershipId },
  });
  if (!targetMembership || targetMembership.tenantId !== req.tenant.id || targetMembership.status !== 'active') {
    return res.status(404).json({ error: 'Member not found.' });
  }

  if (targetMembership.userId === req.tenant.ownerUserId) {
    return res.status(403).json({ error: 'Owner cannot be removed.' });
  }

  await prisma.tenantMembership.update({
    where: { id: targetMembership.id },
    data: {
      status: 'removed',
      updatedAt: new Date(),
    },
  });

  writeAuditLog({
    userId: req.user.id,
    tenantId: req.tenant.id,
    action: 'tenant.member.remove',
    metadata: { membershipId: targetMembership.id, targetUserId: targetMembership.userId },
  });

  const removedUser = await prisma.user.findUnique({ where: { id: targetMembership.userId } });
  if (removedUser && removedUser.currentTenantId === req.tenant.id) {
    const fallback = await prisma.tenantMembership.findFirst({
      where: {
        userId: removedUser.id,
        status: 'active',
        tenantId: { not: req.tenant.id },
      },
      orderBy: { createdAt: 'asc' },
      select: { tenantId: true },
    });
    await prisma.user.update({
      where: { id: removedUser.id },
      data: { currentTenantId: fallback ? fallback.tenantId : null },
    });
  }

  res.json({ message: 'Member removed.' });
});

router.get('/current/entitlements', requireAuth, resolveTenantContext, requirePermission('tenant.read'), async (req, res) => {
  const entitlements = await getTenantEntitlements(req.tenant.id);
  if (!entitlements) return res.status(404).json({ error: 'Entitlements unavailable.' });
  res.json({ entitlements: serializeBigInt(entitlements) });
});

module.exports = router;
