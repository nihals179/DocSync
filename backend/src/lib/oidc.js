const crypto = require('crypto');
const { Issuer, generators } = require('openid-client');

const oidcClientCache = new Map();

async function getOidcClient(provider) {
  if (!provider.issuerUrl) {
    throw new Error('issuerUrl is required for OIDC provider');
  }

  const cacheKey = `${provider.id}`;
  if (oidcClientCache.has(cacheKey)) {
    return oidcClientCache.get(cacheKey);
  }

  try {
    const issuer = await Issuer.discover(provider.issuerUrl);
    const client = new issuer.Client({
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      redirect_uris: [process.env.OAUTH_CALLBACK_URL || 'http://localhost:3001/auth/callback'],
      response_types: ['code'],
    });

    oidcClientCache.set(cacheKey, client);
    return client;
  } catch (error) {
    throw new Error('Failed to initialize OIDC client');
  }
}

async function exchangeCodeForToken(provider, code, redirectUri, state) {
  const client = await getOidcClient(provider);
  try {
    const tokenSet = await client.callback(
      redirectUri,
      { code, state },
      { state },
    );
    return tokenSet;
  } catch (error) {
    console.error('[OIDC] Token exchange error details:', {
      provider: provider.name,
      errorMessage: error.message,
      errorCode: error.code || error.error,
      errorDescription: error.error_description || error.description,
    });
    throw new Error('Token exchange failed');
  }
}

async function getUserInfoFromToken(provider, tokenSet) {
  const client = await getOidcClient(provider);
  try {
    const userInfo = await client.userinfo(tokenSet.access_token);

    // Also check ID token claims as fallback (Azure AD might return email there)
    let idTokenClaims = {};
    try {
      idTokenClaims = tokenSet.claims();
    } catch (e) {
      // ID token not available or can't be decoded
    }

    return {
      email: userInfo.email || userInfo.preferred_username || idTokenClaims.email || idTokenClaims.preferred_username,
      name: userInfo.name || userInfo.given_name || idTokenClaims.name || idTokenClaims.given_name || userInfo.email,
      picture: userInfo.picture,
      sub: userInfo.sub || idTokenClaims.sub,
    };
  } catch (error) {
    throw new Error('Failed to retrieve user information');
  }
}

async function verifyIdToken(provider, tokenSet) {
  const client = await getOidcClient(provider);
  try {
    const claims = tokenSet.claims();
    return claims;
  } catch (error) {
    throw new Error('Token verification failed');
  }
}

function clearOidcClientCache(providerId) {
  oidcClientCache.delete(providerId);
}

// Microsoft authorities that accept accounts from many directories. For these, the ID token's `tid`
// names the real issuer, so it is checked against that issuer instead of the template.
const MICROSOFT_MULTI_TENANT = /login\.microsoftonline\.com\/(common|organizations|consumers)\//i;

function buildLoginConfig({ key, name, issuerUrl, clientId, clientSecret }) {
  return { key, name, issuerUrl, clientId, clientSecret, multiTenant: MICROSOFT_MULTI_TENANT.test(issuerUrl || '') };
}

// "Continue with Google / Microsoft": one platform app registration per provider, from env.
function getPlatformConfig(key) {
  if (key === 'microsoft') {
    const authority = process.env.MICROSOFT_TENANT_ID || 'common';
    return buildLoginConfig({
      key,
      name: 'Microsoft',
      issuerUrl: `https://login.microsoftonline.com/${authority}/v2.0`,
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    });
  }
  if (key === 'google') {
    return buildLoginConfig({
      key,
      name: 'Google',
      issuerUrl: 'https://accounts.google.com',
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    });
  }
  return null;
}

// An organization's own identity provider, from its security policy. The key includes the tenant so
// a callback can never pick up another tenant's configuration.
function getTenantLoginConfig(tenantId, provider) {
  return buildLoginConfig({
    key: `tenant:${tenantId}:${provider.id}`,
    name: provider.name,
    issuerUrl: provider.issuerUrl,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
  });
}

async function getLoginClient(config, redirectUri) {
  if (!config?.issuerUrl || !config?.clientId || !config?.clientSecret) {
    throw new Error(`${config?.name || 'SSO'} sign-in is not configured`);
  }
  const cacheKey = `login:${config.key}:${config.issuerUrl}:${config.clientId}`;
  let issuer = oidcClientCache.get(cacheKey);
  if (!issuer) {
    issuer = await Issuer.discover(config.issuerUrl);
    oidcClientCache.set(cacheKey, issuer);
  }
  return new issuer.Client({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uris: [redirectUri],
    response_types: ['code'],
  });
}

// Starts a login. Returns the provider URL and the per-attempt values the callback must present again.
async function beginLogin(config, redirectUri, extra = {}) {
  const client = await getLoginClient(config, redirectUri);
  const txn = {
    provider: config.key,
    state: generators.state(),
    nonce: generators.nonce(),
    codeVerifier: generators.codeVerifier(),
    redirectUri,
    ...extra,
  };
  const authorizationUrl = client.authorizationUrl({
    scope: 'openid profile email',
    state: txn.state,
    nonce: txn.nonce,
    code_challenge: generators.codeChallenge(txn.codeVerifier),
    code_challenge_method: 'S256',
    response_mode: 'query',
    ...(config.issuerUrl.includes('accounts.google.com') ? { prompt: 'select_account' } : {}),
  });
  return { authorizationUrl, txn };
}

function decodeJwtPayload(jwt) {
  return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8'));
}

// Finishes a login: checks state, exchanges the code with PKCE, validates the ID token (signature,
// issuer, audience, nonce) and returns the identity from its claims.
async function completeLogin(config, txn, params) {
  if (!params.state || params.state !== txn.state) throw new Error('State mismatch');

  const client = await getLoginClient(config, txn.redirectUri);
  let tokenSet = await client.grant({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: txn.redirectUri,
    code_verifier: txn.codeVerifier,
  });
  if (!tokenSet.id_token) throw new Error('No ID token returned');

  let validatingClient = client;
  if (config.multiTenant) {
    const { tid } = decodeJwtPayload(tokenSet.id_token);
    if (!/^[0-9a-f-]{36}$/i.test(String(tid || ''))) throw new Error('ID token has no tenant id');
    const issuer = new Issuer({ ...client.issuer.metadata, issuer: `https://login.microsoftonline.com/${tid}/v2.0` });
    validatingClient = new issuer.Client({ client_id: config.clientId, client_secret: config.clientSecret });
  }
  tokenSet = await validatingClient.validateIdToken(tokenSet, txn.nonce, 'token');
  const claims = tokenSet.claims();

  let email;
  if (/microsoftonline|sts\.windows\.net/i.test(config.issuerUrl)) {
    // preferred_username is the UPN, which Entra checks against a verified domain. The email claim is not verified.
    email = claims.preferred_username || claims.email;
  } else {
    const isGoogle = config.issuerUrl.includes('accounts.google.com');
    if (isGoogle ? claims.email_verified !== true : claims.email_verified === false) {
      throw new Error('Email is not verified');
    }
    email = claims.email;
  }

  return {
    providerName: config.name,
    email: email ? String(email).toLowerCase().trim() : null,
    name: claims.name || claims.given_name || null,
    sub: claims.sub,
  };
}

module.exports = {
  getPlatformConfig,
  getTenantLoginConfig,
  beginLogin,
  completeLogin,
  getOidcClient,
  exchangeCodeForToken,
  getUserInfoFromToken,
  verifyIdToken,
  clearOidcClientCache,
};
