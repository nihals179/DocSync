const LEGACY_INVITE_ROLE = 'organization_member';

function nowIso() {
  return new Date().toISOString();
}

function mapInviteResponse(invite) {
  return {
    id: invite.id,
    email: invite.email,
    role: LEGACY_INVITE_ROLE,
    billingAdmin: invite.billingAdmin,
    status: invite.status,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    inviteToken: process.env.NODE_ENV === 'production' ? undefined : invite.token,
  };
}

function parseBooleanInput(value, fieldName) {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value === 'boolean') return { ok: true, value };
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return { ok: true, value: true };
    if (normalized === 'false') return { ok: true, value: false };
  }
  return { ok: false, error: `${fieldName} must be a boolean.` };
}

module.exports = {
  nowIso,
  mapInviteResponse,
  parseBooleanInput,
};
