const express = require('express');
const { v4: uuidv4 } = require('uuid');

const { requireAuth } = require('../middleware/auth');
const { resolveOrganizationContext, requirePermission } = require('../middleware/rbac');
const {
  findOrganizationByDomain,
  getOrganizationSecurityState,
  organizationMemberships,
  updateOrganizationSecurityState,
  users,
} = require('../store');
const { listAuditLogs, toAuditCsv, writeAuditLog } = require('../lib/audit');

const router = express.Router();

router.use(requireAuth, resolveOrganizationContext);

function sanitizeProvider(provider) {
  return {
    id: provider.id,
    type: provider.type,
    name: provider.name,
    issuerUrl: provider.issuerUrl || null,
    ssoUrl: provider.ssoUrl || null,
    clientId: provider.clientId || null,
    certificate: provider.certificate || null,
    enabled: provider.enabled !== false,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

function ensureProviderShape(provider) {
  const rawType = String(provider.type || '').toLowerCase();
  const normalizedType = rawType === 'saml' || rawType === 'ldap' ? rawType : 'oidc';
  return {
    id: provider.id,
    type: normalizedType,
    name: String(provider.name || 'SSO Provider').trim(),
    issuerUrl: provider.issuerUrl ? String(provider.issuerUrl).trim() : null,
    ssoUrl: provider.ssoUrl ? String(provider.ssoUrl).trim() : null,
    clientId: provider.clientId ? String(provider.clientId).trim() : null,
    clientSecret: provider.clientSecret ? String(provider.clientSecret) : null,
    certificate: provider.certificate ? String(provider.certificate) : null,
    enabled: provider.enabled !== false,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

router.get('/current/security', requirePermission('organization.read'), (req, res) => {
  const security = getOrganizationSecurityState(req.organization.id);
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

router.put('/current/security/policies', requirePermission('organization.member.manage'), (req, res) => {
  const {
    requireMfa,
    sessionDurationHours,
    ipAllowlistEnabled,
    ipAllowlist,
  } = req.body ?? {};

  const security = updateOrganizationSecurityState(req.organization.id, (current) => ({
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
    organizationId: req.organization.id,
    action: 'organization.security.policies.update',
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

router.put('/current/security/domains', requirePermission('organization.member.manage'), (req, res) => {
  const domains = Array.isArray(req.body?.domains)
    ? req.body.domains.map((value) => String(value || '').toLowerCase().trim().replace(/^@+/, '')).filter(Boolean)
    : [];

  const security = updateOrganizationSecurityState(req.organization.id, (current) => ({
    ...current,
    domainMappings: [...new Set(domains)],
  }));

  writeAuditLog({
    userId: req.user.id,
    organizationId: req.organization.id,
    action: 'organization.security.domains.update',
    metadata: { domainCount: security.domainMappings.length },
  });

  res.json({ domains: security.domainMappings, updatedAt: security.updatedAt });
});

router.post('/current/security/sso/providers', requirePermission('organization.member.manage'), (req, res) => {
  const provider = ensureProviderShape({
    id: uuidv4(),
    ...req.body,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  if (!provider.name) {
    return res.status(400).json({ error: 'Provider name is required.' });
  }

  const security = updateOrganizationSecurityState(req.organization.id, (current) => ({
    ...current,
    ssoProviders: [...current.ssoProviders, provider],
  }));

  writeAuditLog({
    userId: req.user.id,
    organizationId: req.organization.id,
    action: 'organization.security.sso-provider.create',
    metadata: { providerId: provider.id, type: provider.type, name: provider.name },
  });

  res.status(201).json({ provider: sanitizeProvider(security.ssoProviders.find((item) => item.id === provider.id)) });
});

router.patch('/current/security/sso/providers/:providerId', requirePermission('organization.member.manage'), (req, res) => {
  const security = getOrganizationSecurityState(req.organization.id);
  const existing = security.ssoProviders.find((item) => item.id === req.params.providerId);
  if (!existing) return res.status(404).json({ error: 'SSO provider not found.' });

  const updated = ensureProviderShape({
    ...existing,
    ...req.body,
    id: existing.id,
    updatedAt: new Date().toISOString(),
  });

  const next = updateOrganizationSecurityState(req.organization.id, (current) => ({
    ...current,
    ssoProviders: current.ssoProviders.map((provider) => (
      provider.id === existing.id ? updated : provider
    )),
  }));

  writeAuditLog({
    userId: req.user.id,
    organizationId: req.organization.id,
    action: 'organization.security.sso-provider.update',
    metadata: { providerId: existing.id, type: updated.type, enabled: updated.enabled },
  });

  res.json({ provider: sanitizeProvider(next.ssoProviders.find((item) => item.id === existing.id)) });
});

router.delete('/current/security/sso/providers/:providerId', requirePermission('organization.member.manage'), (req, res) => {
  const security = getOrganizationSecurityState(req.organization.id);
  const existing = security.ssoProviders.find((item) => item.id === req.params.providerId);
  if (!existing) return res.status(404).json({ error: 'SSO provider not found.' });

  updateOrganizationSecurityState(req.organization.id, (current) => ({
    ...current,
    ssoProviders: current.ssoProviders.filter((provider) => provider.id !== existing.id),
  }));

  writeAuditLog({
    userId: req.user.id,
    organizationId: req.organization.id,
    action: 'organization.security.sso-provider.delete',
    metadata: { providerId: existing.id, name: existing.name },
  });

  res.json({ message: 'SSO provider removed.' });
});

router.post('/sso/simulate-login', requirePermission('organization.read'), (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email is required.' });

  const organization = findOrganizationByDomain(email);
  if (!organization) {
    return res.status(404).json({ error: 'No organization domain mapping found for this email.' });
  }

  const security = getOrganizationSecurityState(organization.id);
  const provider = security.ssoProviders.find((item) => item.enabled);
  if (!provider) {
    return res.status(400).json({ error: 'No active SSO provider configured for organization.' });
  }

  const user = [...users.values()].find((item) => item.email === email) || null;
  const mappedMembership = user
    ? [...organizationMemberships.values()].find(
      (membership) => membership.userId === user.id && membership.organizationId === organization.id,
    )
    : null;

  res.json({
    organization: { id: organization.id, name: organization.name },
    provider: sanitizeProvider(provider),
    user: user ? { id: user.id, email: user.email, name: user.name } : null,
    membershipStatus: mappedMembership?.status || null,
  });
});

router.get('/current/audit-logs', requirePermission('organization.read'), (req, res) => {
  const logs = listAuditLogs({
    organizationId: req.organization.id,
    userId: req.query.userId ? String(req.query.userId) : undefined,
    action: req.query.action ? String(req.query.action) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : 200,
  });
  res.json({ logs });
});

router.get('/current/audit-logs/export.csv', requirePermission('organization.read'), (req, res) => {
  const logs = listAuditLogs({
    organizationId: req.organization.id,
    userId: req.query.userId ? String(req.query.userId) : undefined,
    action: req.query.action ? String(req.query.action) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : 1000,
  });

  writeAuditLog({
    userId: req.user.id,
    organizationId: req.organization.id,
    action: 'organization.audit.export',
    metadata: { exportedRows: logs.length },
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="organization-audit-logs.csv"');
  res.send(toAuditCsv(logs));
});

module.exports = router;
