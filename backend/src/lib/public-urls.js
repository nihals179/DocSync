// Public base URL of this API as the browser and identity providers reach it, e.g. https://api.docsync.com.
// Used to build SAML ACS and OAuth callback URLs, so they must match what is registered with the provider.
function apiPublicUrl() {
  return (process.env.API_PUBLIC_URL || 'http://localhost:4000').replace(/\/+$/, '');
}

module.exports = { apiPublicUrl };
