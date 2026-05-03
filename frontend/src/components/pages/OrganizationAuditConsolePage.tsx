import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { organizationsApi, type OrganizationAuditLog } from '../../lib/api';

interface OrganizationAuditConsolePageProps {
  token: string;
  userName: string;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

export default function OrganizationAuditConsolePage({ token, userName }: OrganizationAuditConsolePageProps) {
  const [logs, setLogs] = useState<OrganizationAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [actionFilter, setActionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [limitFilter, setLimitFilter] = useState(200);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { logs: rows } = await organizationsApi.getOrganizationAuditLogs(token, {
        action: actionFilter || undefined,
        status: statusFilter || undefined,
        limit: limitFilter,
      });
      setLogs(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load organization audit logs.');
    } finally {
      setLoading(false);
    }
  }, [token, actionFilter, statusFilter, limitFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportCsv() {
    setMessage('');
    setError('');
    try {
      const csv = await organizationsApi.exportOrganizationAuditCsv(token, {
        action: actionFilter || undefined,
        status: statusFilter || undefined,
        limit: limitFilter,
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'organization-audit-logs.csv';
      link.click();
      window.URL.revokeObjectURL(url);
      setMessage('CSV export complete.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export logs.');
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">Admin Audit Console</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">Organization activity timeline</h1>
            <p className="mt-2 text-sm text-slate-600">Operator: {userName}</p>
          </div>
          <div className="flex gap-2">
            <Link to="/enterprise-security" className="rounded-xl border border-cyan-200 px-4 py-2 text-sm font-bold text-cyan-700">
              Security settings
            </Link>
            <Link to="/admin" className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-bold text-white">
              Organization admin
            </Link>
          </div>
        </div>

        {message && <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
        {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <div className="grid gap-3 md:grid-cols-[1.2fr,1fr,140px,auto,auto] md:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Action filter</p>
              <input
                value={actionFilter}
                onChange={(event) => setActionFilter(event.target.value)}
                placeholder="organization.member.role.update"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Status</p>
              <input
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                placeholder="success"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Limit</p>
              <input
                type="number"
                min={1}
                max={1000}
                value={limitFilter}
                onChange={(event) => setLimitFilter(Number(event.target.value))}
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"
              />
            </div>
            <button type="button" onClick={() => void load()} className="rounded-xl border border-cyan-200 px-4 py-2 text-sm font-bold text-cyan-700">
              Apply filters
            </button>
            <button type="button" onClick={() => void exportCsv()} className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-bold text-white">
              Export CSV
            </button>
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          {loading ? (
            <p className="text-sm text-slate-500">Loading audit logs...</p>
          ) : logs.length === 0 ? (
            <p className="text-sm text-slate-500">No organization activity matched current filters.</p>
          ) : (
            <div className="space-y-3">
              {logs.map((entry) => (
                <article key={entry.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">{entry.action}</p>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{entry.status}</p>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{formatDate(entry.createdAt)} • Actor {entry.userId}</p>
                  {entry.metadata ? (
                    <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-50 p-3 text-xs text-slate-700">{JSON.stringify(entry.metadata, null, 2)}</pre>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
