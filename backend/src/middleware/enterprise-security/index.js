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

function nowIso() {
  return new Date().toISOString();
}

function sanitizeImportedUser(row) {
  const email = String(row?.email || '').trim().toLowerCase();
  const hasValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!hasValidEmail) return null;
  const displayName = String(row?.name || email.split('@')[0]).trim() || email.split('@')[0];
  return {
    email,
    name: displayName,
  };
}

module.exports = {
  sanitizeProvider,
  ensureProviderShape,
  nowIso,
  sanitizeImportedUser,
};
