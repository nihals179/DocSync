import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { authApi, type AuthSessionSummary, type AuthUser } from '../../services/api';

type AuditLog = {
  id: string;
  action: string;
  status: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

interface AccountSecurityPanelProps {
  token: string;
  user: AuthUser;
  onUserUpdate: (user: AuthUser) => void;
  onLoggedOut: () => void;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function Card({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Badge({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'neutral'; children: ReactNode }) {
  const styles = {
    good: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    warn: 'bg-amber-50 text-amber-700 ring-amber-200',
    bad: 'bg-red-50 text-red-600 ring-red-200',
    neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${styles[tone]}`}>
      {children}
    </span>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'neutral';
}) {
  const iconTone = {
    good: 'bg-emerald-50 text-emerald-600',
    warn: 'bg-amber-50 text-amber-600',
    neutral: 'bg-cyan-50 text-cyan-700',
  };
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconTone[tone]}`}>
        <span className="material-icons" aria-hidden="true">{icon}</span>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>
        <p className="mt-0.5 truncate text-base font-bold text-slate-900">{value}</p>
      </div>
    </div>
  );
}

export default function AccountSecurityPanel({ token, user, onUserUpdate, onLoggedOut }: AccountSecurityPanelProps) {
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
    <div className="space-y-6">
      {message && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
      )}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryTile
          icon={user.emailVerified ? 'mark_email_read' : 'mark_email_unread'}
          label="Email"
          value={user.emailVerified ? 'Verified' : 'Pending verification'}
          tone={user.emailVerified ? 'good' : 'warn'}
        />
        <SummaryTile
          icon={user.twoFactorEnabled ? 'verified_user' : 'gpp_maybe'}
          label="Two-factor auth"
          value={user.twoFactorEnabled ? 'Enabled' : 'Disabled'}
          tone={user.twoFactorEnabled ? 'good' : 'warn'}
        />
        <SummaryTile icon="devices" label="Active sessions" value={String(sessions.length)} tone="neutral" />
      </div>

      <Card
        title="Two-factor authentication"
        description="Require a code from an authenticator app each time you sign in."
        action={
          !user.twoFactorEnabled && (
            <button
              type="button"
              onClick={() => void handleStartTwoFactor()}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-500"
            >
              Set up 2FA
            </button>
          )
        }
      >
        {qrDataUrl && (
          <div className="mb-6 grid gap-6 rounded-xl bg-slate-50 p-5 md:grid-cols-[200px_1fr] md:items-center">
            <img src={qrDataUrl} alt="Two-factor QR code" className="mx-auto w-full max-w-[200px] rounded-xl border border-slate-200 bg-white p-3" />
            <div className="space-y-3">
              <p className="text-sm text-slate-600">Scan this QR code with Google Authenticator, 1Password, Authy, or another TOTP app.</p>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Manual setup key</p>
                <p className="mt-2 break-all font-mono text-sm text-slate-800">{secret}</p>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={twoFactorCode}
            onChange={(e) => setTwoFactorCode(e.target.value)}
            placeholder="Enter 6-digit code"
            className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
          />
          {user.twoFactorEnabled ? (
            <button
              type="button"
              onClick={() => void handleDisableTwoFactor()}
              className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-500"
            >
              Disable 2FA
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleEnableTwoFactor()}
              className="rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-500"
            >
              Confirm 2FA
            </button>
          )}
        </div>
      </Card>

      <Card
        title="Active sessions"
        description="Devices and browsers currently signed in to your account."
        action={
          <button
            type="button"
            onClick={() => void handleRevokeAll()}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
          >
            Revoke all sessions
          </button>
        }
      >
        <ul className="space-y-3">
          {loading && <li className="text-sm text-slate-500">Loading sessions…</li>}
          {!loading && sessions.map((session) => (
            <li
              key={session.id}
              className={`flex flex-col gap-3 rounded-xl border p-4 md:flex-row md:items-center md:justify-between ${
                session.current ? 'border-cyan-200 bg-cyan-50/40' : 'border-slate-200'
              }`}
            >
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 ring-1 ring-slate-200">
                  <span className="material-icons" aria-hidden="true">devices</span>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-slate-900">{session.userAgent}</p>
                    {session.current && <Badge tone="good">This device</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">IP {session.ipAddress} · Last used {formatDate(session.lastUsedAt)}</p>
                  <p className="text-xs text-slate-500">Expires {formatDate(session.expiresAt)}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleRevoke(session.id)}
                className="shrink-0 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50"
              >
                {session.current ? 'Sign out here' : 'Revoke'}
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Recent activity" description="Sign-ins and security changes on your account.">
        <ul className="divide-y divide-slate-100">
          {logs.map((log) => (
            <li key={log.id} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{log.action}</p>
                <p className="mt-1 text-xs text-slate-500">{formatDate(log.createdAt)} · {log.ipAddress}</p>
                <p className="truncate text-xs text-slate-400">{log.userAgent}</p>
              </div>
              <Badge tone={log.status === 'success' ? 'good' : 'bad'}>{log.status}</Badge>
            </li>
          ))}
          {!logs.length && !loading && <li className="py-3 text-sm text-slate-500">No security activity recorded yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
