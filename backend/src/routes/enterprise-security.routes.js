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
	canAssignResources,
  findTenantByDomain,
  getTenantBillingState,
  getTenantEntitlements,
  getTenantSecurityState,
  getPlan,
  upsertTenantBillingState,
  updateTenantSecurityState,
  findTenantBySlug,
} = require('../store');
const { listAuditLogs, toAuditCsv, writeAuditLog } = require('../lib/audit');
const { findUserByIdentifier } = require('../middleware/auth');

async function getSecurityByDomain(email) {
  const normalizedEmail = String(email || '').toLowerCase().trim();
  if (!normalizedEmail || !normalizedEmail.includes('@')) return null;

  let tenant = await findTenantByDomain(normalizedEmail);
  if (!tenant) {
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { currentTenantId: true },
    });
    tenant = user?.currentTenantId
      ? await prisma.tenant.findUnique({ where: { id: user.currentTenantId } })
      : null;
  }

  if (!tenant) return null;

  const security = await getTenantSecurityState(tenant.id);
  return { tenant, security };
}

async function testOidcProviderConnectivity(provider) {
  try {
    if (!provider.issuerUrl) return { success: false, reason: 'Missing issuer URL' };

    const issuerUrl = provider.issuerUrl.replace(/\/$/, '');

    // Try multiple discovery endpoints for different OIDC providers
    const discoveryUrls = [
      issuerUrl.includes('.well-known/openid-configuration') ? issuerUrl : `${issuerUrl}/.well-known/openid-configuration`,
      issuerUrl.includes('microsoftonline') && !issuerUrl.includes('.well-known/openid-configuration') ? `${issuerUrl}/v2.0/.well-known/openid-configuration` : null,
      !issuerUrl.includes('.well-known') ? `${issuerUrl}/.well-known/oauth-authorization-server` : null,
    ].filter(Boolean);

    let configUrl = null;
    let lastError = null;

    for (const url of discoveryUrls) {
      try {
        const response = await fetch(url, { timeout: 5000 });
        if (response.ok) {
          config = await response.json();
          configUrl = url;
          break;
        } else {
          lastError = `HTTP ${response.status}`;
        }
      } catch (err) {
        lastError = err.message;
      }
    }

    if (!config) {
      return {
        success: false,
        reason: `OIDC discovery failed: endpoint not accessible (${lastError || 'unknown error'})`,
        issuerUrl,
        suggestion: 'For Azure AD: https://login.microsoftonline.com/{tenantId}/v2.0. For Google: https://accounts.google.com. For Okta: https://your-domain.okta.com',
        status: 404,
      };
    }

    if (!config.token_endpoint) {
      return { success: false, reason: 'Invalid OIDC configuration: no token endpoint found', configUrl };
    }

    return {
      success: true,
      reason: 'OIDC configuration valid and accessible',
      configUrl,
      issuerUrl,
      endpoints: {
        authorization: config.authorization_endpoint,
        token: config.token_endpoint,
        userinfo: config.userinfo_endpoint,
        revocation: config.revocation_endpoint,
      },
      scopes: config.scopes_supported || ['openid', 'profile', 'email'],
    };
  } catch (error) {
    return {
      success: false,
      reason: `Connection error: ${error.message}`,
      error: error.message,
      suggestion: 'Check network connectivity and firewall rules',
    };
  }
}

async function testSamlProviderConnectivity(provider) {
  try {
    if (!provider.ssoUrl) return { success: false, reason: 'Missing SAML SSO URL' };
    if (!provider.certificate) return { success: false, reason: 'Missing SAML certificate' };

    const response = await fetch(provider.ssoUrl, {
      method: 'HEAD',
      timeout: 5000,
      redirect: 'follow',
    });

    if (!response.ok && response.status !== 405) {
      return {
        success: false,
        reason: `SAML endpoint unreachable: ${response.status}`,
        status: response.status,
      };
    }

    return {
      success: true,
      reason: 'SAML endpoint accessible and certificate present',
      endpoints: {
        sso: provider.ssoUrl,
        certificatePresent: true,
      },
    };
  } catch (error) {
    return {
      success: false,
      reason: `Connection error: ${error.message}`,
      error: error.message,
    };
  }
}

async function testSsoProviderAuthentication(provider) {
  switch (provider.type?.toLowerCase()) {
    case 'oidc':
      return await testOidcProviderConnectivity(provider);

    case 'saml':
      return await testSamlProviderConnectivity(provider);

    case 'ldap':
      return {
        success: true,
        reason: 'LDAP configuration valid (runtime test requires credentials)',
        note: 'Full LDAP test requires username/password',
      };

    default:
      return { success: false, reason: `Unknown provider type: ${provider.type}` };
  }
}

const router = express.Router();

router.use(requireAuth, resolveTenantContext);

router.get('/current/security', requirePermission('tenant.read'), async (req, res) => {
  const security = await getTenantSecurityState(req.tenant.id);
  res.json({
    security: {
      requireMfa: security.requireMfa,
      allowSignInWithoutSlug: security.allowSignInWithoutSlug,
      sessionDurationHours: security.sessionDurationHours,
      ipAllowlistEnabled: security.ipAllowlistEnabled,
      ipAllowlist: security.ipAllowlist,
      domainMappings: security.domainMappings,
      slug: security.slug,
      signInAddressUsesSso: security.signInAddressUsesSso,
      ssoProviders: security.ssoProviders.map(sanitizeProvider),
      updatedAt: security.updatedAt,
    },
  });
});

router.post('/current/enterprise/environment', requirePermission('tenant.member.manage'), async (req, res) => {
  const tenant = req.tenant;
  if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });

  const enterprisePlan = getPlan('enterprise');
  const existingBilling = await getTenantBillingState(tenant.id) || {};
  const requestedSeats = Number(req.body?.purchasedSeats);
  const purchasedSeats = Number.isFinite(requestedSeats) && requestedSeats > 0
    ? Math.floor(requestedSeats)
    : Math.max(Number(existingBilling.purchasedSeats || 0), enterprisePlan.limits.seats);

  const now = nowIso();
  const billing = await upsertTenantBillingState(tenant.id, {
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
  })).map((membership) => membership.userId).filter(Boolean);
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

  const security = await updateTenantSecurityState(req.tenant.id, (current) => {
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

  const entitlements = await getTenantEntitlements(req.tenant.id);

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
      allowSignInWithoutSlug: security.allowSignInWithoutSlug,
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
    allowSignInWithoutSlug,
    sessionDurationHours,
    ipAllowlistEnabled,
    ipAllowlist,
  } = req.body ?? {};

  const security = await updateTenantSecurityState(req.tenant.id, (current) => ({
    ...current,
    requireMfa: typeof requireMfa === 'boolean' ? requireMfa : current.requireMfa,
    allowSignInWithoutSlug: typeof allowSignInWithoutSlug === 'boolean' ? allowSignInWithoutSlug : current.allowSignInWithoutSlug,
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
      allowSignInWithoutSlug: security.allowSignInWithoutSlug,
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

// Organization sign-in address: <slug>.<base domain>. Chosen by the tenant admin.
const TENANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
const RESERVED_TENANT_SLUGS = new Set(['www', 'app', 'api', 'admin', 'auth', 'mail', 'static', 'cdn', 'docs', 'support', 'status', 'help']);

const SIGN_IN_PROVIDER_TYPES = new Set(['oidc', 'saml']);

router.put('/current/security/slug', requirePermission('tenant.member.manage'), async (req, res) => {
  const slug = String(req.body?.slug || '').toLowerCase().trim();
  if (!TENANT_SLUG_PATTERN.test(slug) || RESERVED_TENANT_SLUGS.has(slug)) {
    return res.status(400).json({
      error: 'Use 3–63 lowercase letters, numbers or hyphens. Hyphens cannot start or end the name.',
    });
  }

  // usesSso: false = No SSO (email and password at the address). Omit to keep the current mode.
  const usesSso = typeof req.body?.usesSso === 'boolean' ? req.body.usesSso : null;
  // Optional: which enabled OIDC or SAML provider the sign-in address uses. Omit to keep the current choice.
  const providerId = usesSso !== false && req.body?.providerId ? String(req.body.providerId) : null;
  const current = await getTenantSecurityState(req.tenant.id);
  if (providerId && !current.ssoProviders.some((item) => item.id === providerId && item.enabled !== false && SIGN_IN_PROVIDER_TYPES.has(item.type))) {
    return res.status(400).json({ error: 'Choose an enabled OIDC or SAML provider for the sign-in address.' });
  }
  const nextUsesSso = usesSso ?? current.signInAddressUsesSso;

  const taken = await findTenantBySlug(slug);
  if (taken && taken.tenant.id !== req.tenant.id) {
    return res.status(409).json({ error: 'That organization address is already taken.' });
  }

  try {
    const security = await updateTenantSecurityState(req.tenant.id, (state) => ({
      ...state,
      slug,
      signInAddressUsesSso: nextUsesSso,
      ssoProviders: !nextUsesSso
        ? state.ssoProviders.map((item) => ({ ...item, signInAddress: false }))
        : providerId
          ? state.ssoProviders.map((item) => ({ ...item, signInAddress: item.id === providerId }))
          : state.ssoProviders,
    }));
    writeAuditLog({
      userId: req.user.id,
      tenantId: req.tenant.id,
      action: 'tenant.security.slug.update',
      metadata: { slug, providerId, usesSso: nextUsesSso },
    });
    res.json({
      slug: security.slug,
      signInAddressUsesSso: security.signInAddressUsesSso,
      ssoProviders: security.ssoProviders.map(sanitizeProvider),
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ error: 'That organization address is already taken.' });
    }
    throw error;
  }
});

router.put('/current/security/domains', requirePermission('tenant.member.manage'), async (req, res) => {
  const domains = Array.isArray(req.body?.domains)
    ? req.body.domains.map((value) => String(value || '').toLowerCase().trim().replace(/^@+/, '')).filter(Boolean)
    : [];

  const security = await updateTenantSecurityState(req.tenant.id, (current) => ({
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

  const security = await updateTenantSecurityState(req.tenant.id, (current) => ({
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
  const security = await getTenantSecurityState(req.tenant.id);
  const existing = security.ssoProviders.find((item) => item.id === req.params.providerId);
  if (!existing) return res.status(404).json({ error: 'SSO provider not found.' });

  const updated = ensureProviderShape({
    ...existing,
    ...req.body,
    id: existing.id,
    updatedAt: new Date().toISOString(),
  });

  const next = await updateTenantSecurityState(req.tenant.id, (current) => ({
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
  const security = await getTenantSecurityState(req.tenant.id);
  const existing = security.ssoProviders.find((item) => item.id === req.params.providerId);
  if (!existing) return res.status(404).json({ error: 'SSO provider not found.' });

  await updateTenantSecurityState(req.tenant.id, (current) => ({
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

function validateSsoProviderConfig(provider) {
  if (!provider) return { valid: false, reason: 'Provider not configured' };

  if (!provider.enabled) return { valid: false, reason: 'Provider is disabled' };

  const baseValidation = {
    valid: Boolean(provider.issuerUrl),
    reason: provider.issuerUrl ? null : 'Missing issuer URL',
  };

  if (!baseValidation.valid) return baseValidation;

  switch (provider.type?.toLowerCase()) {
    case 'oidc':
      return {
        valid: Boolean(provider.clientId && provider.clientSecret),
        reason: !provider.clientId ? 'Missing OAuth client ID' : !provider.clientSecret ? 'Missing OAuth client secret' : null,
        config: { issuerUrl: provider.issuerUrl, clientId: provider.clientId },
      };

    case 'saml':
      return {
        valid: Boolean(provider.ssoUrl && provider.certificate),
        reason: !provider.ssoUrl ? 'Missing SAML SSO URL' : !provider.certificate ? 'Missing SAML certificate' : null,
        config: { issuerUrl: provider.issuerUrl, ssoUrl: provider.ssoUrl, hasCertificate: true },
      };

    case 'ldap':
      return {
        valid: Boolean(provider.ldapServerUrl),
        reason: provider.ldapServerUrl ? null : 'Missing LDAP server URL',
        config: { ldapServerUrl: provider.ldapServerUrl },
      };

    default:
      return { valid: false, reason: `Unknown provider type: ${provider.type}` };
  }
}

router.post('/sso/simulate-login', requirePermission('tenant.read'), async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email is required.' });

  const result = await getSecurityByDomain(email);
  if (!result) {
    return res.status(404).json({ error: 'No tenant domain mapping found for this email.' });
  }

  const { tenant, security } = result;
  const provider = security.ssoProviders.find((item) => item.enabled);

  if (!provider) {
    return res.status(400).json({ error: 'No active SSO provider configured for tenant.' });
  }

  const validation = validateSsoProviderConfig(provider);
  if (!validation.valid) {
    return res.status(400).json({
      error: `SSO provider configuration incomplete: ${validation.reason}`,
      provider: { id: provider.id, type: provider.type, name: provider.name },
    });
  }

  // Test real OIDC authentication connectivity
  const authTest = await testSsoProviderAuthentication(provider);
  if (!authTest.success) {
    return res.status(400).json({
      error: `OIDC authentication test failed: ${authTest.reason}`,
      provider: { id: provider.id, type: provider.type, name: provider.name },
      details: authTest,
    });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true },
  });

  const mappedMembership = user
    ? await prisma.tenantMembership.findFirst({
      where: { userId: user.id, tenantId: tenant.id },
      select: { status: true },
    })
    : null;

  // Every workspace this user belongs to, each with its own active SSO provider, in the same shape as the summary line.
  const allMemberships = user
    ? await prisma.tenantMembership.findMany({
      where: { userId: user.id },
      select: { status: true, tenant: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    })
    : [];
  const memberships = await Promise.all(allMemberships.map(async (membershipRow) => {
    const tenantSecurity = await getTenantSecurityState(membershipRow.tenant.id);
    const activeProvider = tenantSecurity.ssoProviders.find((item) => item.enabled !== false);
    return {
      tenant: { id: membershipRow.tenant.id, name: membershipRow.tenant.name },
      provider: activeProvider ? { name: activeProvider.name, type: activeProvider.type } : null,
      membershipStatus: membershipRow.status,
    };
  }));

  res.json({
    tenant: { id: tenant.id, name: tenant.name },
    provider: sanitizeProvider(provider),
    providerValidation: {
      valid: true,
      type: provider.type,
      config: validation.config,
      configStatus: 'valid',
    },
    authenticationTest: {
      success: authTest.success,
      status: 'ready',
      message: authTest.reason,
      ...(authTest.endpoints && { endpoints: authTest.endpoints }),
      ...(authTest.scopes && { scopes: authTest.scopes }),
    },
    ssoFlow: {
      type: provider.type,
      step1: `Redirect user to authorization endpoint with client_id=${provider.clientId}&scope=openid%20profile%20email`,
      step2: 'User authenticates with provider and consents',
      step3: 'Provider redirects back with authorization code',
      step4: `Exchange code at token endpoint for access_token`,
      step5: `Use access_token to fetch user info from userinfo endpoint`,
      step6: `Map user to DocSync account by email or create new account`,
    },
    user: user ? { id: user.id, email: user.email, name: user.name } : null,
    membershipStatus: mappedMembership?.status || null,
    memberships,
  });
});

router.post('/current/security/ldap/import-users', requirePermission('tenant.member.manage'), async (req, res) => {
  const security = await getTenantSecurityState(req.tenant.id);
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

    const isNewMembership = !existingMembership || existingMembership.status !== 'active';
    if (isNewMembership) {
      const resourceCheck = await canAssignResources(req.tenant.id, 1, 1);
      if (!resourceCheck.allowed) {
        const code = !resourceCheck.seats.allowed ? 'seat_limit_exceeded' : 'collaborator_limit_exceeded';
        failed.push({ email: parsed.email, reason: resourceCheck.reason, code });
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

    const tenantBilling = await getTenantBillingState(req.tenant.id);
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
