const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');

const { requireAuth } = require('../middleware/auth/core');
const { resolveTenantContext, requirePermission } = require('../middleware/rbac');
const {
  sanitizeProvider,
  ensureProviderShape,
  nowIso,
  sanitizeImportedUser,
} = require('../middleware/enterprise-security');
const {
	canAssignCollaborators,
	canAssignSeats,
  findtenantByDomain,
  gettenantBillingState,
  gettenantEntitlements,
  gettenantSecurityState,
  getPlan,
  upserttenantBillingState,
  updatetenantSecurityState,
} = require('../store');
const { listAuditLogs, toAuditCsv, writeAuditLog } = require('../lib/audit');

const router = express.Router();

router.use(requireAuth, resolveTenantContext);

router.get('/current/security', requirePermission('tenant.read'), async (req, res) => {
  const security = await gettenantSecurityState(req.tenant.id);
  res.json({
    security: {
      requireMfa: security.requireMfa,
      sessionDurationHours: security.sessionDurationHours,
      ipAllowlistEnabled: security.ipAllowlistEnabled,
      ipAllowlist: security.ipAllowlist,
      domainMappings: security.domainMappings,
      ssoProviders: security.ssoProviders.map(sanitizeProvider),
      updatedAt: security.updatedAt,
    },
  });
});

router.post('/current/enterprise/environment', requirePermission('tenant.member.manage'), async (req, res) => {
  const tenant = req.tenant;
  if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });

  const enterprisePlan = getPlan('enterprise');
  const existingBilling = await gettenantBillingState(tenant.id) || {};
  const requestedSeats = Number(req.body?.purchasedSeats);
  const purchasedSeats = Number.isFinite(requestedSeats) && requestedSeats > 0
    ? Math.floor(requestedSeats)
    : Math.max(Number(existingBilling.purchasedSeats || 0), enterprisePlan.limits.seats);

  const now = nowIso();
  const billing = await upserttenantBillingState(tenant.id, {
    planId: 'enterprise',
    status: 'active',
    purchasedSeats,
    trialUsed: true,
    trialEndsAt: null,
    updatedAt: now,
  });

  const activeMemberUserIds = (await prisma.tenantMembership.findMany({
    where: { tenantId: tenant.id, status: 'active' },
    select: { userId: true },
  })).map((membership) => membership.userId);
  if (activeMemberUserIds.length) {
    await prisma.user.updateMany({
      where: { id: { in: activeMemberUserIds } },
      data: { isSubscribed: true },
    });
  }

  const domains = Array.isArray(req.body?.domains)
    ? req.body.domains.map((value) => String(value || '').toLowerCase().trim().replace(/^@+/, '')).filter(Boolean)
    : [];

  const requestedProvider = req.body?.ssoProvider && typeof req.body.ssoProvider === 'object'
    ? req.body.ssoProvider
    : null;
  let createdProvider = null;

  const security = await updatetenantSecurityState(req.tenant.id, (current) => {
    const nextProviders = [...current.ssoProviders];
    if (requestedProvider && String(requestedProvider.name || '').trim()) {
      createdProvider = ensureProviderShape({
        id: uuidv4(),
        ...requestedProvider,
        createdAt: now,
        updatedAt: now,
      });
      nextProviders.push(createdProvider);
    }

    return {
      ...current,
      requireMfa: req.body?.requireMfa === undefined ? true : Boolean(req.body.requireMfa),
      sessionDurationHours: req.body?.sessionDurationHours == null
        ? 8
        : Math.min(24, Math.max(1, Number(req.body.sessionDurationHours) || 8)),
      ipAllowlistEnabled: typeof req.body?.ipAllowlistEnabled === 'boolean'
        ? req.body.ipAllowlistEnabled
        : current.ipAllowlistEnabled,
      ipAllowlist: Array.isArray(req.body?.ipAllowlist)
        ? req.body.ipAllowlist.map((ip) => String(ip || '').trim()).filter(Boolean)
        : current.ipAllowlist,
      domainMappings: domains.length
        ? [...new Set([...current.domainMappings, ...domains])]
        : current.domainMappings,
      ssoProviders: nextProviders,
    };
  });

  const entitlements = await gettenantEntitlements(req.tenant.id);

  writeAuditLog({
    userId: req.user.id,
    tenantId: req.tenant.id,
    action: 'tenant.enterprise.environment.create',
    metadata: {
      planId: billing.planId,
      seatsPurchased: billing.purchasedSeats,
      requireMfa: security.requireMfa,
      domainCount: security.domainMappings.length,
      createdSsoProviderId: createdProvider?.id || null,
    },
  });

  res.status(201).json({
    message: 'Enterprise environment initialized.',
    tenant: {
      id: tenant.id,
      name: tenant.name,
    },
    billing,
    security: {
      requireMfa: security.requireMfa,
      sessionDurationHours: security.sessionDurationHours,
      ipAllowlistEnabled: security.ipAllowlistEnabled,
      ipAllowlist: security.ipAllowlist,
      domainMappings: security.domainMappings,
      ssoProviders: security.ssoProviders.map(sanitizeProvider),
      updatedAt: security.updatedAt,
    },
    entitlements,
  });
});

router.put('/current/security/policies', requirePermission('tenant.member.manage'), async (req, res) => {
  const {
    requireMfa,
    sessionDurationHours,
    ipAllowlistEnabled,
    ipAllowlist,
  } = req.body ?? {};

  const security = await updatetenantSecurityState(req.tenant.id, (current) => ({
    ...current,
    requireMfa: typeof requireMfa === 'boolean' ? requireMfa : current.requireMfa,
    sessionDurationHours: sessionDurationHours == null
      ? current.sessionDurationHours
      : Math.min(24, Math.max(1, Number(sessionDurationHours) || current.sessionDurationHours)),
    ipAllowlistEnabled: typeof ipAllowlistEnabled === 'boolean' ? ipAllowlistEnabled : current.ipAllowlistEnabled,
    ipAllowlist: Array.isArray(ipAllowlist)
      ? ipAllowlist.map((ip) => String(ip || '').trim()).filter(Boolean)
      : current.ipAllowlist,
  }));

  writeAuditLog({
    userId: req.user.id,
    tenantId: req.tenant.id,
    action: 'tenant.security.policies.update',
    metadata: {
      requireMfa: security.requireMfa,
      sessionDurationHours: security.sessionDurationHours,
      ipAllowlistEnabled: security.ipAllowlistEnabled,
      ipAllowlistCount: security.ipAllowlist.length,
    },
  });

  res.json({
    message: 'Security policies updated.',
    security: {
      ...security,
      ssoProviders: security.ssoProviders.map(sanitizeProvider),
    },
  });
});

router.put('/current/security/domains', requirePermission('tenant.member.manage'), async (req, res) => {
  const domains = Array.isArray(req.body?.domains)
    ? req.body.domains.map((value) => String(value || '').toLowerCase().trim().replace(/^@+/, '')).filter(Boolean)
    : [];

  const security = await updatetenantSecurityState(req.tenant.id, (current) => ({
    ...current,
    domainMappings: [...new Set(domains)],
  }));

  writeAuditLog({
    userId: req.user.id,
    tenantId: req.tenant.id,
    action: 'tenant.security.domains.update',
    metadata: { domainCount: security.domainMappings.length },
  });

  res.json({ domains: security.domainMappings, updatedAt: security.updatedAt });
});

router.post('/current/security/sso/providers', requirePermission('tenant.member.manage'), async (req, res) => {
  const provider = ensureProviderShape({
    id: uuidv4(),
    ...req.body,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  if (!provider.name) {
    return res.status(400).json({ error: 'Provider name is required.' });
  }

  const security = await updatetenantSecurityState(req.tenant.id, (current) => ({
    ...current,
    ssoProviders: [...current.ssoProviders, provider],
  }));

  writeAuditLog({
    userId: req.user.id,
    tenantId: req.tenant.id,
    action: 'tenant.security.sso-provider.create',
    metadata: { providerId: provider.id, type: provider.type, name: provider.name },
  });

  res.status(201).json({ provider: sanitizeProvider(security.ssoProviders.find((item) => item.id === provider.id)) });
});

router.patch('/current/security/sso/providers/:providerId', requirePermission('tenant.member.manage'), async (req, res) => {
  const security = await gettenantSecurityState(req.tenant.id);
  const existing = security.ssoProviders.find((item) => item.id === req.params.providerId);
  if (!existing) return res.status(404).json({ error: 'SSO provider not found.' });

  const updated = ensureProviderShape({
    ...existing,
    ...req.body,
    id: existing.id,
    updatedAt: new Date().toISOString(),
  });

  const next = await updatetenantSecurityState(req.tenant.id, (current) => ({
    ...current,
    ssoProviders: current.ssoProviders.map((provider) => (
      provider.id === existing.id ? updated : provider
    )),
  }));

  writeAuditLog({
    userId: req.user.id,
    tenantId: req.tenant.id,
    action: 'tenant.security.sso-provider.update',
    metadata: { providerId: existing.id, type: updated.type, enabled: updated.enabled },
  });

  res.json({ provider: sanitizeProvider(next.ssoProviders.find((item) => item.id === existing.id)) });
});

router.delete('/current/security/sso/providers/:providerId', requirePermission('tenant.member.manage'), async (req, res) => {
  const security = await gettenantSecurityState(req.tenant.id);
  const existing = security.ssoProviders.find((item) => item.id === req.params.providerId);
  if (!existing) return res.status(404).json({ error: 'SSO provider not found.' });

  await updatetenantSecurityState(req.tenant.id, (current) => ({
    ...current,
    ssoProviders: current.ssoProviders.filter((provider) => provider.id !== existing.id),
  }));

  writeAuditLog({
    userId: req.user.id,
    tenantId: req.tenant.id,
    action: 'tenant.security.sso-provider.delete',
    metadata: { providerId: existing.id, name: existing.name },
  });

  res.json({ message: 'SSO provider removed.' });
});

router.post('/sso/simulate-login', requirePermission('tenant.read'), async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email is required.' });

  const tenant = await findtenantByDomain(email);
  if (!tenant) {
    return res.status(404).json({ error: 'No tenant domain mapping found for this email.' });
  }

  const security = await gettenantSecurityState(tenant.id);
  const provider = security.ssoProviders.find((item) => item.enabled);
  if (!provider) {
    return res.status(400).json({ error: 'No active SSO provider configured for tenant.' });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true },
  });
  const mappedMembership = user
    ? await prisma.tenantMembership.findFirst({
      where: {
        userId: user.id,
        tenantId: tenant.id,
      },
      select: { status: true },
    })
    : null;

  res.json({
    tenant: { id: tenant.id, name: tenant.name },
    provider: sanitizeProvider(provider),
    user: user ? { id: user.id, email: user.email, name: user.name } : null,
    membershipStatus: mappedMembership?.status || null,
  });
});

router.post('/current/security/ldap/import-users', requirePermission('tenant.member.manage'), async (req, res) => {
  const security = await gettenantSecurityState(req.tenant.id);
  const enabledLdapProviders = security.ssoProviders.filter((provider) => provider.type === 'ldap' && provider.enabled !== false);
  if (!enabledLdapProviders.length) {
    return res.status(400).json({ error: 'No enabled LDAP provider configured for this tenant.' });
  }

  const requestedProviderId = req.body?.providerId ? String(req.body.providerId) : '';
  const selectedProvider = requestedProviderId
    ? enabledLdapProviders.find((provider) => provider.id === requestedProviderId)
    : enabledLdapProviders[0];

  if (!selectedProvider) {
    return res.status(404).json({ error: 'LDAP provider not found or disabled.' });
  }

  const rows = Array.isArray(req.body?.users) ? req.body.users : [];
  if (!rows.length) return res.status(400).json({ error: 'users array is required.' });

  const imported = [];
  const skipped = [];
  const failed = [];

  for (let index = 0; index < rows.length; index += 1) {
    const parsed = sanitizeImportedUser(rows[index]);
    if (!parsed) {
      failed.push({ index, reason: 'Invalid email format.' });
      continue;
    }

    let user = await prisma.user.findUnique({ where: { email: parsed.email } });
    let existingMembership = user
      ? await prisma.tenantMembership.findFirst({
        where: {
          tenantId: req.tenant.id,
          userId: user.id,
        },
      })
      : null;

    const needsSeat = !existingMembership || existingMembership.status !== 'active';
    if (needsSeat) {
      const seatCheck = await canAssignSeats(req.tenant.id, 1);
      if (!seatCheck.allowed) {
        failed.push({ email: parsed.email, reason: seatCheck.reason, code: 'seat_limit_exceeded' });
        continue;
      }
    }

    if (!existingMembership || existingMembership.status !== 'active') {
      const collaboratorCheck = await canAssignCollaborators(req.tenant.id, 1);
      if (!collaboratorCheck.allowed) {
        failed.push({ email: parsed.email, reason: collaboratorCheck.reason, code: 'collaborator_limit_exceeded' });
        continue;
      }
    }

    if (!user) {
      user = await prisma.user.create({
        data: {
        id: uuidv4(),
        name: parsed.name,
        email: parsed.email,
        passwordHash: await bcrypt.hash(uuidv4(), 12),
        createdAt: new Date(),
        accountType: 'individual',
        emailVerified: true,
        failedLoginAttempts: 0,
        lockoutUntil: null,
        role: 'user',
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorTempSecret: null,
        currentTenantId: req.tenant.id,
        },
      });
    }

    if (existingMembership && existingMembership.status === 'active') {
      skipped.push({ email: parsed.email, reason: 'Already an active member.' });
      continue;
    }

    if (existingMembership) {
      await prisma.tenantMembership.update({
        where: { id: existingMembership.id },
        data: {
          status: 'active',
          email: parsed.email,
          updatedAt: new Date(),
        },
      });
      imported.push({ email: parsed.email, status: 'updated' });
    } else {
      existingMembership = await prisma.tenantMembership.create({
        data: {
        id: uuidv4(),
        tenantId: req.tenant.id,
        userId: user.id,
        email: parsed.email,
        billingAdmin: false,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        },
      });
      imported.push({ email: parsed.email, status: 'created' });
    }

    if (!user.currentTenantId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { currentTenantId: req.tenant.id },
      });
    }

    const tenantBilling = await gettenantBillingState(req.tenant.id);
    if (tenantBilling?.planId === 'enterprise') {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { accountType: 'Enterprise' },
      });
    }
  }

  writeAuditLog({
    userId: req.user.id,
    tenantId: req.tenant.id,
    action: 'tenant.security.ldap.import-users',
    metadata: {
      providerId: selectedProvider.id,
      requested: rows.length,
      imported: imported.length,
      skipped: skipped.length,
      failed: failed.length,
    },
  });

  return res.json({
    message: 'LDAP import completed.',
    provider: sanitizeProvider(selectedProvider),
    summary: {
      requested: rows.length,
      imported: imported.length,
      skipped: skipped.length,
      failed: failed.length,
    },
    imported,
    skipped,
    failed,
  });
});

router.get('/current/audit-logs', requirePermission('tenant.read'), async (req, res) => {
  const logs = await listAuditLogs({
    tenantId: req.tenant.id,
    userId: req.query.userId ? String(req.query.userId) : undefined,
    action: req.query.action ? String(req.query.action) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : 200,
  });
  res.json({ logs });
});

router.get('/current/audit-logs/export.csv', requirePermission('tenant.read'), async (req, res) => {
  const logs = await listAuditLogs({
    tenantId: req.tenant.id,
    userId: req.query.userId ? String(req.query.userId) : undefined,
    action: req.query.action ? String(req.query.action) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : 1000,
  });

  writeAuditLog({
    userId: req.user.id,
    tenantId: req.tenant.id,
    action: 'tenant.audit.export',
    metadata: { exportedRows: logs.length },
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="tenant-audit-logs.csv"');
  res.send(toAuditCsv(logs));
});

module.exports = router;
