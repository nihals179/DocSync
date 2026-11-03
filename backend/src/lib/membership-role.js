const { prisma } = require('../db/client');

async function getMembershipRole(userId, tenantId) {
  if (!userId || !tenantId) return null;
  const membership = await prisma.tenantMembership.findFirst({
    where: { userId, tenantId, status: 'active' },
    select: { role: true },
  });
  return membership?.role || null;
}

module.exports = { getMembershipRole };
