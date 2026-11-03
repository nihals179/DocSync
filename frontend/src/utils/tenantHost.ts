// Organization sign-in addresses look like <slug>.<base domain>. These subdomains belong to the app itself.
const NON_ORG_SUBDOMAINS = new Set(['www', 'app', 'api', 'admin', 'auth', 'mail', 'static', 'cdn', 'docs', 'support', 'status', 'help']);

// Returns the organization slug when the page is on an organization's address, otherwise null.
// Works for acme.docsync.com and for acme.localhost in development.
export function getOrgSlugFromHost(hostname: string = window.location.hostname): string | null {
  if (/^\d+(\.\d+){3}$/.test(hostname)) return null;

  const labels = hostname.toLowerCase().split('.');
  const isLocal = labels[labels.length - 1] === 'localhost';
  const hasSubdomain = isLocal ? labels.length === 2 : labels.length >= 3;
  if (!hasSubdomain) return null;

  const slug = labels[0];
  return NON_ORG_SUBDOMAINS.has(slug) ? null : slug;
}

// Full sign-in address for a slug. VITE_TENANT_URL_TEMPLATE is the same value the backend uses, e.g. https://{slug}.docsync.com
export function organizationSignInUrl(slug: string): string {
  const template = import.meta.env.VITE_TENANT_URL_TEMPLATE as string | undefined;
  return template ? template.replace('{slug}', slug) : `${slug}.<your-domain>`;
}
