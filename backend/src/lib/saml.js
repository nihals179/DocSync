const { SAML } = require('passport-saml');
const zlib = require('zlib');
const { v4: uuidv4 } = require('uuid');

const samlInstances = new Map();

function getSamlInstance(provider, callbackUrl) {
  const cacheKey = provider.id;
  if (samlInstances.has(cacheKey)) {
    return samlInstances.get(cacheKey);
  }

  try {
    const saml = new SAML({
      protocol: 'http://',
      entryPoint: provider.ssoUrl,
      issuer: 'DocSync',
      identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      cert: provider.certificate,
      callbackUrl: callbackUrl,
      validateInResponseTo: false,
      disableRequestedAuthnContext: true,
    });

    samlInstances.set(cacheKey, saml);
    return saml;
  } catch (error) {
    throw new Error(`Failed to initialize SAML: ${error.message}`);
  }
}

async function generateSamlAuthRequest(provider, callbackUrl, relayStateEmail) {
  try {
    // Generate SAML AuthnRequest XML
    const requestId = `_${uuidv4()}`;
    const now = new Date().toISOString();

    const samlRequest = `<?xml version="1.0" encoding="UTF-8"?>
        <samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
          xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
          ID="${requestId}"
          Version="2.0"
          IssueInstant="${now}"
          Destination="${provider.ssoUrl}"
          AssertionConsumerServiceURL="${callbackUrl}"
          ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">
          <saml:Issuer>${provider.issuerUrl}</saml:Issuer>
          <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>
        </samlp:AuthnRequest>`;

    // Encode SAML request for HTTP Redirect binding
    // Deflate and base64 encode as required by SAML Redirect binding
    return new Promise((resolve, reject) => {
      zlib.deflateRaw(Buffer.from(samlRequest), (deflateErr, compressed) => {
        if (deflateErr) {
          reject(deflateErr);
        } else {
          const encodedRequest = compressed.toString('base64');
          const relayState = Buffer.from(relayStateEmail || callbackUrl).toString('base64');

          // Construct the authorization URL with SAML request as query parameter
          const authUrl = new URL(provider.ssoUrl);
          authUrl.searchParams.set('SAMLRequest', encodedRequest);
          authUrl.searchParams.set('RelayState', relayState);

          resolve({
            authorizeUrl: authUrl.toString(),
            samlRequest: samlRequest,
          });
        }
      });
    });
  } catch (error) {
    throw new Error(`Failed to generate SAML auth request: ${error.message}`);
  }
}

async function validateSamlResponse(provider, samlResponse, relayState, callbackUrl) {
  const saml = getSamlInstance(provider, callbackUrl);
  const { profile } = await saml.validatePostResponseAsync({
    SAMLResponse: samlResponse,
    RelayState: relayState,
  });
  return profile;
}

function extractUserInfo(samlProfile) {
  // Handle both array and object formats from SAML parser
  let profile = samlProfile;

  // If samlProfile is an array, convert to object by merging all items
  if (Array.isArray(samlProfile)) {
    console.log('[SAML] Profile is array format, length:', samlProfile.length);
    if (samlProfile.length > 0) {
      console.log('[SAML] First item:', samlProfile[0]);
    }
    profile = {};
    samlProfile.forEach((item) => {
      if (typeof item === 'object' && item !== null) {
        Object.assign(profile, item);
      }
    });
  }

  // Try multiple paths for email attribute (Azure AD, Okta, Google, generic SAML)
  const email =
    profile.email ||
    profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] ||
    profile['http://schemas.microsoft.com/identity/claims/objectidentifier'] ||
    profile.mail ||
    profile.emailAddress ||
    profile.userPrincipalName ||
    profile.nameID;

  const name =
    profile.displayName ||
    profile.name ||
    profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] ||
    profile.givenName;

  if (!email) {
    console.error('[SAML] Available attributes:', Object.keys(profile));
    throw new Error('Email not found in SAML response');
  }

  // Extract email domain if it's a UPN (user@domain.com)
  let cleanEmail = String(email).toLowerCase().trim();
  if (cleanEmail.includes('@')) {
    // Standard email format
  } else if (cleanEmail.includes('#EXT#')) {
    // Azure AD guest format: user#EXT#@tenant.onmicrosoft.com - extract the actual email
    cleanEmail = cleanEmail.split('#')[0] + '@' + cleanEmail.split('@')[1];
  }

  return {
    email: cleanEmail,
    name: name ? String(name).trim() : cleanEmail.split('@')[0],
    sub: profile.nameID || email,
  };
}

module.exports = {
  generateSamlAuthRequest,
  validateSamlResponse,
  extractUserInfo,
};
