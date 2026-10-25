const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');

const {
  canAssignResources,
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
const { sendInviteEmail } = require('../utils/email');

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
  res.json({
    tenants: tenants,
    currentTenantId: req.user?.currentTenantId || null,
  });
});

router.get('/profiles', requireAuth, resolveTenantContext, requirePermission('tenant.read'), async (req, res) => {
  res.json({ profiles: await getProfileTable() });
});

router.post('/profiles', requireAuth, resolveTenantContext, requirePermission('tenant.write'), async (req, res) => {
  const { role, permissions } = req.body;
  if (!role) return res.status(400).json({ error: 'Role is required.' });

  try {
    const profile = await prisma.profile.create({
      data: {
        id: role,
        role,
        canAccessAdminBoard: permissions?.canAccessAdminBoard || false,
        canReviewSecurityAudit: permissions?.canReviewSecurityAudit || false,
        canManageGlobalSettings: permissions?.canManageGlobalSettings || false,
        canManageMembers: permissions?.canManageMembers || false,
        canManageMemberBillingAdmin: permissions?.canManageMemberBillingAdmin || false,
        canManageTenantBilling: permissions?.canManageTenantBilling || false,
        canManageWorkspacesDocuments: permissions?.canManageWorkspacesDocuments || false,
        canReadTenantResources: permissions?.canReadTenantResources || false,
        canUseAiGrammarByPlan: permissions?.canUseAiGrammarByPlan || false,
        canManageBillingSettings: permissions?.canManageBillingSettings || false,
        canViewInvoicesSubscription: permissions?.canViewInvoicesSubscription || false,
      },
    });
    res.status(201).json({ message: 'Profile created.', profile });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Role already exists.' });
    }
    res.status(500).json({ error: 'Failed to create profile.' });
  }
});

router.delete('/profiles/:role', requireAuth, resolveTenantContext, requirePermission('tenant.write'), async (req, res) => {
  const { role } = req.params;
  if (!role) return res.status(400).json({ error: 'Role is required.' });

  try {
    const deleted = await prisma.profile.delete({
      where: { id: role },
    });
    if (!deleted) return res.status(404).json({ error: 'Profile not found.' });
    res.json({ message: 'Profile deleted.', role });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Profile not found.' });
    }
    res.status(500).json({ error: 'Failed to delete profile.' });
  }
});

router.post('/switch', requireAuth, async (req, res) => {
  const tenantId = String(req.body?.tenantId || '');
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
  const invites = (await prisma.tenantsInvite.findMany({
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

router.post('/current/sendinvites', requireAuth, resolveTenantContext, requirePermission('tenant.member.invite'), async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  const billingAdminInput = parseBooleanInput(req.body?.billingAdmin, 'billingAdmin');
  if (!billingAdminInput.ok) return res.status(400).json({ error: billingAdminInput.error });
  const billingAdmin = billingAdminInput.value ?? false;
  const legacyRole = req.body?.role !== undefined ? String(req.body.role).trim() : null;

  if (!email) return res.status(400).json({ error: 'email is required.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email address.' });

  const resourceCheck = await canAssignResources(req.tenant.id, 1, 1);
  if (!resourceCheck.allowed) {
    const code = !resourceCheck.seats.allowed ? 'seat_limit_exceeded' : 'collaborator_limit_exceeded';
    return res.status(402).json({ error: resourceCheck.reason, code });
  }

  const existingMembership = await prisma.tenantMembership.findFirst({
    where: {
      tenantId: req.user.currentTenantId,
      status: 'active',
      email,
    },
  });
  if (existingMembership) {
    return res.status(409).json({ error: 'User is already a member of this tenant.' });
  }

  const duplicateInvite = await prisma.tenantsInvite.findFirst({
    where: {
      tenantId: req.tenant.id,
      email,
      status: 'pending',
    },
  });
  if (duplicateInvite) {
    return res.status(409).json({ error: 'Pending invite already exists for this email.' });
  }

  const inviteToken = generateOpaqueToken();
  const appUrl = process.env.FRONTEND_URL;
  const acceptLink = `${appUrl}/invites/${inviteToken}`;

  const invite = await prisma.tenantsInvite.create({
    data: {
      id: uuidv4(),
      token: inviteToken,
      tenantId: req.tenant.id,
      email,
      billingAdmin,
      status: 'pending',
      invitedByUserId: req.user.id,
      inviteLink: acceptLink,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      acceptedAt: null,
    },
  });

  const inviteRecord = mapInviteRecord(invite);

  const expirationDate = new Date(inviteRecord.expiresAt).toLocaleDateString();

  sendInviteEmail(
    inviteRecord.email,
    req.user.name,
    req.tenant.name,
    acceptLink,
    expirationDate,
  ).catch((err) => {
    console.error('Failed to send invite email:', err);
  });

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

router.post('/invites/accept', async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Invite token is required.' });

  const invite = await prisma.tenantsInvite.findUnique({
    where: { token },
    include: {
      invitedByUser: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      acceptedByUser: {
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          createdAt: true,
        },
      },
    },
  });
  if (!invite || invite.status !== 'pending') {
    return res.status(404).json({ error: 'Invite not found or already consumed.' });
  }
  if (new Date(invite.expiresAt).getTime() <= Date.now()) {
    await prisma.tenantsInvite.update({
      where: { id: invite.id },
      data: {
        status: 'expired',
        updatedAt: new Date(),
      },
    });
    return res.status(400).json({ error: 'Invite has expired.' });
  }

  await prisma.tenantsInvite.update({
    where: { id: invite.id },
    data: {
      status: 'accepted',
      acceptedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Find user by invited email
  const invitedUser = await prisma.user.findUnique({
    where: { email: invite.email },
  });

  // Check if membership already exists by email
  const existingMembership = await prisma.tenantMembership.findFirst({
    where: {
      tenantId: invite.tenantId,
      email: invite.email,
    },
  });

  if (existingMembership) {
    // Update existing membership
    await prisma.tenantMembership.update({
      where: { id: existingMembership.id },
      data: {
        status: 'active',
        billingAdmin: invite.billingAdmin,
        userId: invitedUser?.id || null,
        updatedAt: new Date(),
      },
    });
  } else {
    // Create new membership with email (userId optional, will be filled when user registers)
    await prisma.tenantMembership.create({
      data: {
        id: uuidv4(),
        tenantId: invite.tenantId,
        userId: invitedUser?.id || null,
        email: invite.email,
        billingAdmin: invite.billingAdmin,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  if (invite.invitedByUserId) {
    writeAuditLog({
      userId: invite.invitedByUserId,
      tenantId: invite.tenantId,
      action: 'tenant.invite.accept',
      metadata: { inviteId: invite.id, inviteEmail: invite.email },
    });
  }



  res.json({
    message: 'Invite accepted successfully.',
    tenantId: invite.tenantId,
    invitedEmail: invite.email,
    invitedBy: invite.invitedByUser ? {
      id: invite.invitedByUser.id,
      name: invite.invitedByUser.name,
      email: invite.invitedByUser.email,
    } : null,
    invitedUser: invite.acceptedByUser ? {
      id: invite.acceptedByUser.id,
      name: invite.acceptedByUser.name,
      email: invite.acceptedByUser.email,
      emailVerified: invite.acceptedByUser.emailVerified,
      createdAt: invite.acceptedByUser.createdAt,
    } : null,
  });
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
