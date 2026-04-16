/**
 * In-memory data store.
 * Each Map is keyed by entity ID.
 * Swap these out for a real DB (Postgres, MongoDB, etc.) later.
 */

const { v4: uuidv4 } = require('uuid');

/** @type {Map<string, { id: string, name: string, username?: string, email: string, passwordHash: string, createdAt: string, emailVerified: boolean, failedLoginAttempts: number, lockoutUntil: string | null, role?: string, twoFactorEnabled: boolean, twoFactorSecret: string | null, twoFactorTempSecret: string | null }>} */
const users = new Map();

/** @type {Map<string, { id: string, name: string, ownerUserId: string, createdAt: string, updatedAt: string }>} */
const organizations = new Map();

/** @type {Map<string, { id: string, organizationId: string, userId: string, role: 'owner' | 'admin' | 'editor' | 'viewer', billingAdmin: boolean, status: 'active' | 'removed', createdAt: string, updatedAt: string }>} */
const organizationMemberships = new Map();

/** @type {Map<string, { id: string, token: string, organizationId: string, email: string, role: 'owner' | 'admin' | 'editor' | 'viewer', billingAdmin: boolean, status: 'pending' | 'accepted' | 'expired' | 'cancelled', invitedByUserId: string, createdAt: string, updatedAt: string, expiresAt: string, acceptedAt: string | null }>} */
const organizationInvites = new Map();

/** @type {Map<string, { id: string, userId: string, refreshTokenHash: string, csrfToken: string, createdAt: string, lastUsedAt: string, expiresAt: string, revokedAt: string | null, remember: boolean, userAgent: string, ipAddress: string }>} */
const authSessions = new Map();

/** @type {Map<string, { id: string, userId: string, type: 'email-verification' | 'password-reset', expiresAt: string, createdAt: string }>} */
const authTokens = new Map();

/** @type {Map<string, { id: string, userId: string | null, action: string, status: 'success' | 'failure', ipAddress: string, userAgent: string, createdAt: string, metadata?: Record<string, unknown> }>} */
const auditLogs = new Map();

/** @type {Map<string, { id: string, title: string, content: string, userId: string, createdAt: string, updatedAt: string }>} */
const documents = new Map();

/** @type {Map<string, Array<{ id: string, text: string, userId: string, createdAt: string }>>} */
const comments = new Map();

/** @type {Map<string, Array<{ id: string, preview: string, content: string, savedAt: string }>>} */
const versions = new Map();

/** @type {Map<string, Array<{ id: string, text: string, done: boolean }>>} */
const todos = new Map();

/** @type {Map<string, { id: string, name: string, ownerId: string, memberIds: string[], createdAt: string, updatedAt: string }>} */
const workspaces = new Map();

function nowIso() {
	return new Date().toISOString();
}

function ensureOrganizationForUser(user) {
	const existingMembership = [...organizationMemberships.values()].find(
		(membership) => membership.userId === user.id && membership.status === 'active',
	);
	if (existingMembership) {
		const existingOrg = organizations.get(existingMembership.organizationId);
		if (existingOrg) {
			if (!user.currentOrganizationId) user.currentOrganizationId = existingOrg.id;
			users.set(user.id, user);
			return existingOrg;
		}
	}

	const now = nowIso();
	const organization = {
		id: uuidv4(),
		name: `${user.name}'s Organization`,
		ownerUserId: user.id,
		createdAt: now,
		updatedAt: now,
	};
	organizations.set(organization.id, organization);

	const membership = {
		id: uuidv4(),
		organizationId: organization.id,
		userId: user.id,
		role: 'owner',
		billingAdmin: true,
		status: 'active',
		createdAt: now,
		updatedAt: now,
	};
	organizationMemberships.set(membership.id, membership);

	user.currentOrganizationId = organization.id;
	users.set(user.id, user);
	return organization;
}

function ensureWorkspaceForUser(user, organizationId) {
	const orgId = organizationId || ensureOrganizationForUser(user).id;
	const existing = [...workspaces.values()].find((w) => w.ownerId === user.id && w.organizationId === orgId);
	if (existing) return existing;

	const now = nowIso();
	const workspace = {
		id: uuidv4(),
		name: `${user.name}'s Workspace`,
		ownerId: user.id,
		memberIds: [user.id],
		organizationId: orgId,
		createdAt: now,
		updatedAt: now,
	};
	workspaces.set(workspace.id, workspace);
	return workspace;
}

function hydrateLegacyResourcesForUser(user, organizationId) {
	for (const doc of documents.values()) {
		if (doc.userId === user.id && !doc.organizationId) {
			doc.organizationId = organizationId;
			documents.set(doc.id, doc);
		}
	}

	for (const workspace of workspaces.values()) {
		if (workspace.memberIds?.includes(user.id) && !workspace.organizationId) {
			workspace.organizationId = organizationId;
			workspaces.set(workspace.id, workspace);
		}
	}
}

function ensureTenantBootstrapForUser(user) {
	const organization = ensureOrganizationForUser(user);
	hydrateLegacyResourcesForUser(user, organization.id);
	ensureWorkspaceForUser(user, organization.id);
	return organization;
}

module.exports = {
	users,
	organizations,
	organizationMemberships,
	organizationInvites,
	authSessions,
	authTokens,
	auditLogs,
	documents,
	comments,
	versions,
	todos,
	workspaces,
	nowIso,
	ensureOrganizationForUser,
	ensureTenantBootstrapForUser,
	ensureWorkspaceForUser,
};
