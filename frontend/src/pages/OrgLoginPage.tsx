import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { authApi, type AuthSuccess } from '../services/api';
import { ssoApi, type OrganizationInfo } from '../services/ssoApi';

interface OrgLoginPageProps {
  slug: string;
  onAuthSuccess: (auth: AuthSuccess) => Promise<void>;
}

// Sign-in page on an organization's own address. Depending on the workspace's setting it offers SSO
// or email and password. Only invited members get in, so a link back to the main site is also shown.
function OrgLoginPage({ slug, onAuthSuccess }: OrgLoginPageProps) {
  const [searchParams] = useSearchParams();
  const [org, setOrg] = useState<OrganizationInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const ssoError = searchParams.get('sso_error');

  useEffect(() => {
    let cancelled = false;
    ssoApi
      .getOrganization(slug)
      .then((info) => {
        if (!cancelled) setOrg(info);
      })
      .catch(() => {
        if (!cancelled) setLoadError('This workspace could not be found.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function handlePasswordSignIn(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    try {
      const result = (await authApi.login(email.trim(), password, false, 'workspace', slug)) as AuthSuccess & {
        requiresTwoFactor?: boolean;
      };
      if (result.requiresTwoFactor) {
        setFormError('Two-factor sign-in is not available on this page. Sign in from the main site instead.');
        return;
      }
      await onAuthSuccess(result);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Same host without the organization label, e.g. acme.docsync.com -> docsync.com
  const mainSiteAuthUrl = `${window.location.protocol}//${window.location.host.split('.').slice(1).join('.')}/auth`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg">
        {isLoading && <p className="text-center text-sm text-slate-500">Loading...</p>}

        {!isLoading && !org && (
          <p className="text-center text-sm text-red-700">{loadError || 'This workspace could not be found.'}</p>
        )}

        {org && (
          <>
            <h1 className="text-xl font-black text-slate-900">Sign in to {org.name}</h1>
            <p className="mt-2 text-sm text-slate-500">
              {org.passwordSignIn
                ? 'Use your email and password. You need an invite from your administrator to join this workspace.'
                : 'Use your work account. You need an invite from your administrator to join this workspace.'}
            </p>

            {ssoError && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{ssoError}</p>}

            {org.passwordSignIn ? (
              <form onSubmit={handlePasswordSignIn} className="mt-6 space-y-3">
                <input
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Email"
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-cyan-500"
                />
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Password"
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-cyan-500"
                />
                {formError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</p>}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex w-full items-center justify-center rounded-xl bg-cyan-700 py-2.5 text-sm font-bold text-white shadow-md shadow-cyan-200 transition-all hover:bg-cyan-600 disabled:opacity-60"
                >
                  {isSubmitting ? 'Signing in...' : 'Sign in'}
                </button>
              </form>
            ) : org.ssoAvailable ? (
              <a
                href={`/api/auth/sso/org/${encodeURIComponent(org.slug)}/login`}
                className="mt-6 flex w-full items-center justify-center rounded-xl bg-cyan-700 py-2.5 text-sm font-bold text-white shadow-md shadow-cyan-200 transition-all hover:bg-cyan-600"
              >
                Continue with {org.providerName}
              </a>
            ) : (
              <p className="mt-6 text-sm text-slate-600">
                Single sign-on is not set up for this workspace yet. Contact your administrator.
              </p>
            )}

            <a href={mainSiteAuthUrl} className="mt-6 block text-center text-sm font-semibold text-cyan-700 hover:underline">
              Not part of {org.name}? Sign in with a personal account
            </a>
          </>
        )}
      </div>
    </div>
  );
}

export default OrgLoginPage;
