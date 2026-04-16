import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  organizationsApi,
  type OrganizationInvite,
  type OrganizationMember,
  type OrganizationMembership,
  type OrganizationSummary,
} from '../../lib/api';

const ROLE_OPTIONS = ['owner', 'admin', 'editor', 'viewer'] as const;

type RoleValue = (typeof ROLE_OPTIONS)[number];

type MemberDrafts = Record<string, { role: RoleValue; billingAdmin: boolean }>;

interface OrganizationAdminPageProps {
  token: string;
  userName: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

export default function OrganizationAdminPage({ token, userName }: OrganizationAdminPageProps) {
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [currentOrganizationId, setCurrentOrganizationId] = useState<string>('');
  const [membership, setMembership] = useState<OrganizationMembership | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [memberDrafts, setMemberDrafts] = useState<MemberDrafts>({});
  const [invites, setInvites] = useState<OrganizationInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<RoleValue>('viewer');
  const [inviteBillingAdmin, setInviteBillingAdmin] = useState(false);

  const canManageMembers = useMemo(() => {
    const role = membership?.role;
    return role === 'owner' || role === 'admin';
  }, [membership]);

  async function load() {
    setLoading(true);
    setError('');

    try {
      const [{ organizations: orgs, currentOrganizationId: selectedOrgId }, currentOrg, membersRes, invitesRes] = await Promise.all([
        organizationsApi.mine(token),
        organizationsApi.current(token),
        organizationsApi.listMembers(token),
        organizationsApi.listInvites(token),
      ]);

      setOrganizations(orgs);
      setCurrentOrganizationId(selectedOrgId || currentOrg.organization.id);
      setMembership(currentOrg.membership);
      setMembers(membersRes.members);
      setInvites(invitesRes.invites);
      setMemberDrafts(
        membersRes.members.reduce<MemberDrafts>((acc, member) => {
          acc[member.id] = { role: member.role, billingAdmin: member.billingAdmin };
          return acc;
        }, {}),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load organization administration data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  async function handleSwitchOrganization(nextOrganizationId: string) {
    setMessage('');
    setError('');
    try {
      await organizationsApi.switchContext(token, nextOrganizationId);
      setCurrentOrganizationId(nextOrganizationId);
      await load();
      setMessage('Organization context updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch organization context.');
    }
  }

  async function handleInvite() {
    setMessage('');
    setError('');

    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      setError('Email is required.');
      return;
    }

    try {
      const { invite } = await organizationsApi.inviteMember(token, {
        email,
        role: inviteRole,
        billingAdmin: inviteBillingAdmin,
      });
      setInvites((prev) => [invite, ...prev]);
      setInviteEmail('');
      setInviteRole('viewer');
      setInviteBillingAdmin(false);
      setMessage('Invite sent successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invite.');
    }
  }

  async function handleSaveMember(memberId: string) {
    const draft = memberDrafts[memberId];
    if (!draft) return;

    setMessage('');
    setError('');
    try {
      const { member } = await organizationsApi.updateMember(token, memberId, {
        role: draft.role,
        billingAdmin: draft.billingAdmin,
      });
      setMembers((prev) => prev.map((item) => (item.id === member.id ? member : item)));
      setMessage('Member updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update member.');
    }
  }

  async function handleRemoveMember(memberId: string) {
    setMessage('');
    setError('');
    try {
      await organizationsApi.removeMember(token, memberId);
      setMembers((prev) => prev.filter((member) => member.id !== memberId));
      setMemberDrafts((prev) => {
        const next = { ...prev };
        delete next[memberId];
        return next;
      });
      setMessage('Member removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member.');
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">Organization Console</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">Tenant membership and access control</h1>
            <p className="mt-2 text-sm text-slate-600">Signed in as {userName}</p>
          </div>
          <div className="flex gap-2">
            <Link to="/billing" className="rounded-xl border border-cyan-200 px-4 py-2 text-sm font-bold text-cyan-700">
              Billing portal
            </Link>
            <Link to="/enterprise-security" className="rounded-xl border border-cyan-200 px-4 py-2 text-sm font-bold text-cyan-700">
              Enterprise security
            </Link>
            <Link to="/organization-audit" className="rounded-xl border border-cyan-200 px-4 py-2 text-sm font-bold text-cyan-700">
              Audit console
            </Link>
            <Link to="/workspace" className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-bold text-white">
              Back to workspace
            </Link>
          </div>
        </div>

        {message && <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
        {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <div className="grid gap-4 md:grid-cols-[1fr,2fr] md:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Active organization</p>
              <select
                value={currentOrganizationId}
                onChange={(event) => void handleSwitchOrganization(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-500"
              >
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <p>
                Your role: <span className="font-bold uppercase">{membership?.role ?? 'unknown'}</span>
              </p>
              <p className="mt-1">
                Billing admin: <span className="font-bold">{membership?.billingAdmin ? 'Yes' : 'No'}</span>
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-black text-slate-900">Invite member</h2>
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Role and billing privileges</p>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-[2fr,1fr,auto,auto] md:items-center">
            <input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="user@company.com"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"
            />
            <select
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as RoleValue)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500"
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={inviteBillingAdmin}
                onChange={(event) => setInviteBillingAdmin(event.target.checked)}
              />
              Billing admin
            </label>
            <button
              type="button"
              onClick={() => void handleInvite()}
              disabled={!canManageMembers || loading}
              className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              Send invite
            </button>
          </div>
          {!canManageMembers && (
            <p className="mt-3 text-sm text-amber-700">Only owner and admin can invite members.</p>
          )}
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-900">Members</h2>
          <div className="mt-4 space-y-3">
            {loading && <p className="text-sm text-slate-500">Loading members...</p>}
            {!loading && members.map((member) => {
              const draft = memberDrafts[member.id] ?? { role: member.role, billingAdmin: member.billingAdmin };
              const canEditOwner = member.role === 'owner' && membership?.userId !== member.userId;
              return (
                <article key={member.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="grid gap-3 md:grid-cols-[1.6fr,0.9fr,0.9fr,auto,auto] md:items-center">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{member.name}</p>
                      <p className="mt-1 text-xs text-slate-500">{member.email}</p>
                    </div>
                    <select
                      value={draft.role}
                      onChange={(event) => {
                        const role = event.target.value as RoleValue;
                        setMemberDrafts((prev) => ({
                          ...prev,
                          [member.id]: { ...draft, role },
                        }));
                      }}
                      disabled={!canManageMembers || canEditOwner}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-cyan-500 disabled:bg-slate-100"
                    >
                      {ROLE_OPTIONS.map((role) => (
                        <option key={role} value={role}>{role}</option>
                      ))}
                    </select>
                    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={draft.billingAdmin}
                        onChange={(event) => {
                          const billingAdmin = event.target.checked;
                          setMemberDrafts((prev) => ({
                            ...prev,
                            [member.id]: { ...draft, billingAdmin },
                          }));
                        }}
                        disabled={!canManageMembers || canEditOwner}
                      />
                      Billing admin
                    </label>
                    <button
                      type="button"
                      onClick={() => void handleSaveMember(member.id)}
                      disabled={!canManageMembers || canEditOwner}
                      className="rounded-xl border border-cyan-200 px-4 py-2 text-sm font-bold text-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRemoveMember(member.id)}
                      disabled={!canManageMembers || member.role === 'owner'}
                      className="rounded-xl border border-red-200 px-4 py-2 text-sm font-bold text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Remove
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-900">Pending invites</h2>
          <div className="mt-4 space-y-3">
            {invites.map((invite) => (
              <article key={invite.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{invite.email}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Role: {invite.role} • Billing admin: {invite.billingAdmin ? 'Yes' : 'No'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Expires: {formatDate(invite.expiresAt)}</p>
                  </div>
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">{invite.status}</span>
                </div>
              </article>
            ))}
            {!invites.length && !loading && (
              <p className="text-sm text-slate-500">No pending invites for this organization.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
