import { useState } from 'react';

import { authApi, tenantsApi, type AuthSuccess } from '../services/api';

interface AdminLoginPageProps {
  onAuthSuccess: (session: AuthSuccess) => void;
}

function GoogleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" role="img">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.55-.2-2.27H12v4.3h6.45a5.51 5.51 0 0 1-2.39 3.61v3h3.87c2.27-2.09 3.56-5.17 3.56-8.64Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.87-3c-1.07.72-2.44 1.15-4.08 1.15-3.13 0-5.78-2.11-6.73-4.95H1.27v3.09A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.3A7.2 7.2 0 0 1 4.9 12c0-.8.14-1.58.37-2.3V6.61H1.27A12 12 0 0 0 0 12c0 1.94.46 3.78 1.27 5.39l4-3.09Z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.36.61 4.61 1.81l3.45-3.45C17.95 1.06 15.24 0 12 0A12 12 0 0 0 1.27 6.61l4 3.09C6.22 6.86 8.87 4.75 12 4.75Z" />
    </svg>
  );
}

function MicrosoftLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" role="img">
      <path fill="#F35325" d="M1 1h10.5v10.5H1z" />
      <path fill="#81BC06" d="M12.5 1H23v10.5H12.5z" />
      <path fill="#05A6F0" d="M1 12.5h10.5V23H1z" />
      <path fill="#FFBA08" d="M12.5 12.5H23V23H12.5z" />
    </svg>
  );
}

export default function AdminLoginPage({ onAuthSuccess }: AdminLoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await authApi.login(email.trim().toLowerCase(), password, false, 'admin');

      if ('requiresTwoFactor' in result) {
        setError('Two-factor authentication is not supported in the admin portal. Disable 2FA and try again.');
        return;
      }

      const session = result as AuthSuccess;

      let hasAdminAccess = session.user.role === 'admin' || session.user.role === 'owner';
      if (!hasAdminAccess) {
        try {
          const context = await tenantsApi.current(session.accessToken);
          hasAdminAccess = context.membership.status === 'active';
        } catch {
          hasAdminAccess = false;
        }
      }

      if (!hasAdminAccess) {
        setError('Access denied. This portal is restricted to admin and owner accounts only.');
        try { await authApi.logout(session.accessToken, 'admin'); } catch { /* ignore */ }
        return;
      }

      onAuthSuccess(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="flex w-full items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-600">
              <span className="material-icons text-white" style={{ fontSize: '1.2rem' }}>admin_panel_settings</span>
            </div>
            <div>
              <p className="text-lg font-black tracking-tight text-cyan-700">DocSync Admin</p>
              <p className="text-xs text-slate-500">Restricted tenant portal</p>
            </div>
          </div>
        </div>
      </header>

      <main className="grid min-h-[calc(100vh-73px)] w-full gap-8 px-4 py-8 sm:px-6 lg:grid-cols-12 lg:px-8">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-7 lg:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">Admin Access</p>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-900">Manage Your Tenant From One Console</h1>
          <p className="mt-3 max-w-2xl text-sm text-slate-600">
            Use the admin portal to manage membership, roles, billing authority, and invitation workflows. This page is isolated from the workspace UI and all actions are audited.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-4">
              <p className="text-sm font-bold text-cyan-700">Role-Gated Access</p>
              <p className="mt-1 text-xs text-cyan-700/90">Only owner and admin accounts can continue.</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-bold text-slate-700">Direct URL Entry</p>
              <p className="mt-1 text-xs text-slate-600">Portal is reachable only via the /admin route.</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-5 lg:p-8">
          {error && (
            <div className="mb-5 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              <span className="material-icons mt-0.5 shrink-0" style={{ fontSize: '1rem' }}>error_outline</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div>
              <label htmlFor="admin-email" className="block text-xs font-semibold uppercase tracking-widest text-slate-500">
                Email
              </label>
              <input
                id="admin-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                placeholder="admin@company.com"
              />
            </div>

            <div>
              <label htmlFor="admin-password" className="block text-xs font-semibold uppercase tracking-widest text-slate-500">
                Password
              </label>
              <input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-xl bg-cyan-600 py-2.5 text-sm font-bold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <span className="material-icons animate-spin" style={{ fontSize: '1rem' }}>hourglass_empty</span>
                  Verifying...
                </span>
              ) : 'Sign in to Admin Portal'}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            <span>or continue with SSO</span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {(['google', 'microsoft'] as const).map((provider) => (
              <button
                key={provider}
                type="button"
                disabled={loading}
                onClick={() => { window.location.href = `/api/auth/sso/login/${provider}?scope=admin`; }}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold capitalize text-slate-700 transition hover:border-cyan-400 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {provider === 'google' ? <GoogleLogo /> : <MicrosoftLogo />}
                {provider === 'google' ? 'Google' : 'Microsoft'}
              </button>
            ))}
          </div>

          <p className="mt-6 text-center text-xs text-slate-400">
            This portal is not accessible from the regular workspace menu.
          </p>
        </section>
      </main>
    </div>
  );
}
