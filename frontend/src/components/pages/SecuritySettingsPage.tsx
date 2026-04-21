import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { authApi, type AuthSessionSummary, type AuthUser } from '../../lib/api';

type AuditLog = {
  id: string;
  action: string;
  status: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

interface SecuritySettingsPageProps {
  token: string;
  user: AuthUser;
  onUserUpdate: (user: AuthUser) => void;
  onLoggedOut: () => void;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

export default function SecuritySettingsPage({ token, user, onUserUpdate, onLoggedOut }: SecuritySettingsPageProps) {
  const [sessions, setSessions] = useState<AuthSessionSummary[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [secret, setSecret] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [{ sessions: activeSessions }, { logs: auditLogs }] = await Promise.all([
        authApi.getSessions(token),
        authApi.getAuditLogs(token),
      ]);
      setSessions(activeSessions);
      setLogs(auditLogs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load security settings.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRevoke(sessionId: string) {
    setMessage('');
    setError('');
    try {
      await authApi.revokeSession(token, sessionId);
      setSessions((prev) => prev.filter((item) => item.id !== sessionId));
      if (sessions.find((item) => item.id === sessionId)?.current) onLoggedOut();
      else setMessage('Session revoked.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke session.');
    }
  }

  async function handleRevokeAll() {
    setMessage('');
    setError('');
    try {
      await authApi.revokeAllSessions(token);
      onLoggedOut();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke all sessions.');
    }
  }

  async function handleStartTwoFactor() {
    setMessage('');
    setError('');
    try {
      const result = await authApi.setupTwoFactor(token);
      setSecret(result.secret);
      setQrDataUrl(result.qrDataUrl);
      setMessage('Scan the QR code and enter a code from your authenticator app.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start two-factor setup.');
    }
  }

  async function handleEnableTwoFactor() {
    setMessage('');
    setError('');
    try {
      const result = await authApi.enableTwoFactor(token, twoFactorCode);
      onUserUpdate(result.user);
      setSecret('');
      setQrDataUrl('');
      setTwoFactorCode('');
      setMessage(result.message);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable two-factor authentication.');
    }
  }

  async function handleDisableTwoFactor() {
    setMessage('');
    setError('');
    try {
      const result = await authApi.disableTwoFactor(token, twoFactorCode);
      onUserUpdate(result.user);
      setTwoFactorCode('');
      setMessage(result.message);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disable two-factor authentication.');
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">Security Center</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">Sessions, protection, and audit activity</h1>
          </div>
          <Link to="/workspace" className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-bold text-white">
            Back to workspace
          </Link>
        </div>

        {message && <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
        {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-900">Account security</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Email status</p>
              <p className="mt-2 text-sm font-semibold text-slate-800">{user.emailVerified ? 'Verified' : 'Pending verification'}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Two-factor auth</p>
              <p className="mt-2 text-sm font-semibold text-slate-800">{user.twoFactorEnabled ? 'Enabled' : 'Disabled'}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Active sessions</p>
              <p className="mt-2 text-sm font-semibold text-slate-800">{sessions.length}</p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-black text-slate-900">Two-factor authentication</h2>
            {!user.twoFactorEnabled && (
              <button type="button" onClick={() => void handleStartTwoFactor()} className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-bold text-white">
                Set up 2FA
              </button>
            )}
          </div>

          {qrDataUrl && (
            <div className="mt-4 grid gap-4 md:grid-cols-[220px,1fr] md:items-start">
              <img src={qrDataUrl} alt="Two-factor QR code" className="rounded-2xl border border-slate-200 p-3" />
              <div className="space-y-3">
                <p className="text-sm text-slate-600">Scan this QR code with Google Authenticator, 1Password, Authy, or another TOTP app.</p>
                <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                  <p className="font-semibold text-slate-900">Manual setup key</p>
                  <p className="mt-2 break-all font-mono text-xs">{secret}</p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={twoFactorCode}
              onChange={(e) => setTwoFactorCode(e.target.value)}
              placeholder="Enter 6-digit code"
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-cyan-500"
            />
            {user.twoFactorEnabled ? (
              <button type="button" onClick={() => void handleDisableTwoFactor()} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white">
                Disable 2FA
              </button>
            ) : (
              <button type="button" onClick={() => void handleEnableTwoFactor()} className="rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-bold text-white">
                Confirm 2FA
              </button>
            )}
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-black text-slate-900">Session management</h2>
            <button type="button" onClick={() => void handleRevokeAll()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">
              Revoke all sessions
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {loading && <p className="text-sm text-slate-500">Loading sessions...</p>}
            {!loading && sessions.map((session) => (
              <article key={session.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{session.userAgent}</p>
                  <p className="mt-1 text-xs text-slate-500">IP {session.ipAddress} • Last used {formatDate(session.lastUsedAt)}</p>
                  <p className="mt-1 text-xs text-slate-500">Expires {formatDate(session.expiresAt)} {session.current ? '• Current session' : ''}</p>
                </div>
                <button type="button" onClick={() => void handleRevoke(session.id)} className="rounded-xl border border-red-200 px-4 py-2 text-sm font-bold text-red-600">
                  {session.current ? 'Sign out here' : 'Revoke'}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-900">Audit activity</h2>
          <div className="mt-4 space-y-3">
            {logs.map((log) => (
              <article key={log.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{log.action}</p>
                    <p className="mt-1 text-xs text-slate-500">{formatDate(log.createdAt)} • {log.ipAddress}</p>
                    <p className="mt-1 text-xs text-slate-500">{log.userAgent}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${log.status === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                    {log.status}
                  </span>
                </div>
              </article>
            ))}
            {!logs.length && !loading && <p className="text-sm text-slate-500">No security activity recorded yet.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
