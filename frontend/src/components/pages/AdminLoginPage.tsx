import { useState } from 'react';

import { authApi, type AuthSuccess } from '../../lib/api';

interface AdminLoginPageProps {
  onAuthSuccess: (session: AuthSuccess) => void;
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

      if (session.user.role !== 'admin' && session.user.role !== 'owner') {
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
              <p className="text-xs text-slate-500">Restricted organization portal</p>
            </div>
          </div>
        </div>
      </header>

      <main className="grid min-h-[calc(100vh-73px)] w-full gap-8 px-4 py-8 sm:px-6 lg:grid-cols-12 lg:px-8">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-7 lg:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">Admin Access</p>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-900">Manage Your Organization From One Console</h1>
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

          <p className="mt-6 text-center text-xs text-slate-400">
            This portal is not accessible from the regular workspace menu.
          </p>
        </section>
      </main>
    </div>
  );
}
