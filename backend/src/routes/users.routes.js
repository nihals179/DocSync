const express = require('express');
const { prisma } = require('../db/client');
const { requireAuth } = require('../middleware/auth/core');
const { writeAuditLog } = require('../lib/audit');
const { getRequestIp, getUserAgent } = require('../middleware/auth');

const router = express.Router();

async function deleteUserAndRelations(userId, deletedByUserId = userId) {
  const deletionResult = {
    userDeleted: false,
    relationsDeleted: {},
  };

  try {
    await prisma.$transaction(async (tx) => {
      // Delete all auth sessions
      const sessionsDeleted = await tx.authSession.deleteMany({
        where: { userId },
      });
      deletionResult.relationsDeleted.authSessions = sessionsDeleted.count;

      // Delete user billing info
      const billingDeleted = await tx.userBilling.deleteMany({
        where: { userId },
      });
      deletionResult.relationsDeleted.userBilling = billingDeleted.count;

      // Delete user usage records
      const usageDeleted = await tx.userUsage.deleteMany({
        where: { userId },
      });
      deletionResult.relationsDeleted.userUsage = usageDeleted.count;

      // Delete tenant membership
      const membershipDeleted = await tx.tenantMembership.deleteMany({
        where: { userId },
      });
      deletionResult.relationsDeleted.tenantMembership = membershipDeleted.count;

      // Delete invites sent by this user
      const invitesDeleted = await tx.tenantsInvite.deleteMany({
        where: { invitedByUserId: userId },
      });
      deletionResult.relationsDeleted.tenantsInvite = invitesDeleted.count;

      // Delete audit logs where user is the subject
      const auditLogsDeleted = await tx.auditLog.deleteMany({
        where: { userId },
      });
      deletionResult.relationsDeleted.auditLogs = auditLogsDeleted.count;

      // Delete the user
      await tx.user.delete({
        where: { id: userId },
      });
      deletionResult.userDeleted = true;
    });

    return { success: true, ...deletionResult };
  } catch (error) {
    throw new Error(`Failed to delete user: ${error.message}`);
  }
}

router.delete('/me', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const confirmPassword = req.body?.confirmPassword;

  if (!confirmPassword) {
    return res.status(400).json({ error: 'Password confirmation is required.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const bcrypt = require('bcryptjs');
    const validPassword = await bcrypt.compare(confirmPassword, user.passwordHash);
    if (!validPassword) {
      writeAuditLog({
        userId,
        tenantId: null,
        action: 'user-deletion-attempt',
        status: 'failure',
        metadata: { reason: 'invalid-password' },
      });
      return res.status(401).json({ error: 'Invalid password.' });
    }

    const result = await deleteUserAndRelations(userId);

    writeAuditLog({
      userId: req.user.id || 'system',
      tenantId: null,
      action: 'user-deletion',
      status: 'success',
      metadata: { deletedUserId: userId, ...result.relationsDeleted },
    });

    res.json({
      message: 'User account successfully deleted.',
      deletionDetails: result,
    });
  } catch (error) {
    console.error('Error deleting user account:', error);
    writeAuditLog({
      userId,
      tenantId: null,
      action: 'user-deletion',
      status: 'failure',
      metadata: { error: error.message },
    });
    res.status(500).json({ error: 'Failed to delete user account. Please try again.' });
  }
});

router.delete('/:userId', requireAuth, async (req, res) => {
  const { userId } = req.params;
  const requestingUserId = req.user.id;

  // Only allow users to delete their own account or admins
  if (requestingUserId !== userId && req.user.role !== 'admin') {
    writeAuditLog({
      userId: requestingUserId,
      tenantId: null,
      action: 'user-deletion-unauthorized',
      status: 'failure',
      metadata: { targetUserId: userId, reason: 'insufficient-permissions' },
    });
    return res.status(403).json({ error: 'You do not have permission to delete this user.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const result = await deleteUserAndRelations(userId, requestingUserId);

    writeAuditLog({
      userId: requestingUserId,
      tenantId: null,
      action: 'user-deletion',
      status: 'success',
      metadata: { deletedUserId: userId, ...result.relationsDeleted },
    });

    res.json({
      message: 'User account successfully deleted.',
      deletionDetails: result,
    });
  } catch (error) {
    console.error('Error deleting user account:', error);
    writeAuditLog({
      userId: requestingUserId,
      tenantId: null,
      action: 'user-deletion',
      status: 'failure',
      metadata: { targetUserId: userId, error: error.message },
    });
    res.status(500).json({ error: 'Failed to delete user account. Please try again.' });
  }
});

module.exports = router;
