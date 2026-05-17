const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');
const { nowIso: runtimeNowIso, isDatabaseConfigured: runtimeIsDatabaseConfigured, toIsoOrNull: runtimeToIsoOrNull } = require('../lib/runtime-utils');
const { PLAN_CATALOG, TRIAL_DAYS_BY_PLAN } = require('./catalog');
const {
	users,
	organizations,
	organizationMemberships,
	organizationInvites,
	authSessions,
	invoices,
	organizationBilling,
	userBilling,
	organizationUsage,
	userUsage,
	webhookJobs,
	processedWebhookEvents,
	authTokens,
	auditLogs,
	documents,
	profiles,
	comments,
	versions,
	todos,
	workspaces,
	initializePersistentMaps: initializeSchemaPersistentMaps,
} = require('./schemas');

const nowIso = () => runtimeNowIso();
const isDatabaseConfigured = () => runtimeIsDatabaseConfigured();
const toIsoOrNull = (value) => runtimeToIsoOrNull(value);

function normalizeUserBillingState(input, userId, fallbackEmail = null) {
	const resolvedEmail = String(input?.email || fallbackEmail || '').toLowerCase().trim();
	const state = {
		userId,
		email: resolvedEmail || null,
		planId: input?.planId,
		status: input?.status,
		trialEndsAt: toIsoOrNull(input?.trialEndsAt),
		trialUsed: input?.trialUsed,
		subscriptionId: input?.subscriptionId || null,
		customerId: input?.customerId || null,
		currentPeriodEndAt: toIsoOrNull(input?.currentPeriodEndAt),
		graceEndsAt: toIsoOrNull(input?.graceEndsAt),
		updatedAt: toIsoOrNull(input?.updatedAt) || nowIso(),
	};

	if (!state.planId || !PLAN_CATALOG[state.planId]) state.planId = 'free';
	if (!state.status) state.status = 'active';
	state.trialUsed = typeof state.trialUsed === 'boolean' ? state.trialUsed : false;
	return state;
}

function normalizeOrganizationBillingState(input, organizationId) {
	const state = {
		organizationId,
		planId: input?.planId,
		status: input?.status,
		purchasedSeats: Number(input?.purchasedSeats || 0),
		trialEndsAt: toIsoOrNull(input?.trialEndsAt),
		trialUsed: input?.trialUsed,
		subscriptionId: input?.subscriptionId || null,
		customerId: input?.customerId || null,
		currentPeriodEndAt: toIsoOrNull(input?.currentPeriodEndAt),
		graceEndsAt: toIsoOrNull(input?.graceEndsAt),
		updatedAt: toIsoOrNull(input?.updatedAt) || nowIso(),
	};

	if (!state.planId || !PLAN_CATALOG[state.planId]) state.planId = 'free';
	if (!state.status) state.status = 'active';
	if (!state.purchasedSeats || state.purchasedSeats < 1) {
		state.purchasedSeats = getPlan(state.planId).limits.seats;
	}
	state.trialUsed = typeof state.trialUsed === 'boolean' ? state.trialUsed : false;
	return state;
}

async function readUserBillingStateFromDb(userId, email = null) {
	if (!isDatabaseConfigured()) return null;
	const normalizedEmail = String(email || '').toLowerCase().trim();
	const row = await prisma.userBilling.findUnique({ where: { userId } });
	if (!row && normalizedEmail) {
		const byEmail = await prisma.userBilling.findUnique({ where: { email: normalizedEmail } });
		if (byEmail) {
			return normalizeUserBillingState(byEmail, byEmail.userId, normalizedEmail);
		}
	}
	if (!row) return null;
	return normalizeUserBillingState(row, userId, normalizedEmail);
}

async function writeUserBillingStateToDb(state) {
	if (!isDatabaseConfigured() || !state?.userId) return;
	const normalizedEmail = String(state.email || '').toLowerCase().trim();
	if (!normalizedEmail) return;
	await prisma.userBilling.upsert({
		where: { email: normalizedEmail },
		update: {
			userId: state.userId,
			email: normalizedEmail,
			planId: state.planId,
			status: state.status,
			trialEndsAt: state.trialEndsAt ? new Date(state.trialEndsAt) : null,
			trialUsed: Boolean(state.trialUsed),
			subscriptionId: state.subscriptionId || null,
			customerId: state.customerId || null,
			currentPeriodEndAt: state.currentPeriodEndAt ? new Date(state.currentPeriodEndAt) : null,
			graceEndsAt: state.graceEndsAt ? new Date(state.graceEndsAt) : null,
		},
		create: {
			userId: state.userId,
			email: normalizedEmail,
			planId: state.planId,
			status: state.status,
			trialEndsAt: state.trialEndsAt ? new Date(state.trialEndsAt) : null,
			trialUsed: Boolean(state.trialUsed),
			subscriptionId: state.subscriptionId || null,
			customerId: state.customerId || null,
			currentPeriodEndAt: state.currentPeriodEndAt ? new Date(state.currentPeriodEndAt) : null,
			graceEndsAt: state.graceEndsAt ? new Date(state.graceEndsAt) : null,
		},
	});
}

async function readOrganizationBillingStateFromDb(organizationId) {
	if (!isDatabaseConfigured()) return null;
	const row = await prisma.organizationBilling.findUnique({
		where: { organizationId },
	});
	if (!row) return null;
	return normalizeOrganizationBillingState(row, organizationId);
}

async function writeOrganizationBillingStateToDb(organizationId, state) {
	if (!isDatabaseConfigured() || !organizationId || !state) return;
	await prisma.organizationBilling.upsert({
		where: { organizationId },
		update: {
			planId: state.planId,
			status: state.status,
			purchasedSeats: state.purchasedSeats,
			trialEndsAt: state.trialEndsAt ? new Date(state.trialEndsAt) : null,
			trialUsed: Boolean(state.trialUsed),
			subscriptionId: state.subscriptionId || null,
			customerId: state.customerId || null,
			currentPeriodEndAt: state.currentPeriodEndAt ? new Date(state.currentPeriodEndAt) : null,
			graceEndsAt: state.graceEndsAt ? new Date(state.graceEndsAt) : null,
		},
		create: {
			organizationId,
			planId: state.planId,
			status: state.status,
			purchasedSeats: state.purchasedSeats,
			trialEndsAt: state.trialEndsAt ? new Date(state.trialEndsAt) : null,
			trialUsed: Boolean(state.trialUsed),
			subscriptionId: state.subscriptionId || null,
			customerId: state.customerId || null,
			currentPeriodEndAt: state.currentPeriodEndAt ? new Date(state.currentPeriodEndAt) : null,
			graceEndsAt: state.graceEndsAt ? new Date(state.graceEndsAt) : null,
		},
	});
}

function monthKeyFromDate(input = new Date()) {
	const date = input instanceof Date ? input : new Date(input);
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getPlan(planId) {
	return PLAN_CATALOG[planId] || PLAN_CATALOG.free;
}

function getAllPlans() {
	return Object.values(PLAN_CATALOG);
}

const PROFILE_TABLE_DEFAULTS = [
	{
		role: 'platform_admin',
		canAccessAdminBoard: true,
		canReviewSecurityAudit: true,
		canManageGlobalSettings: true,
		canManageMembers: false,
		canManageMemberBillingAdmin: false,
		canManageOrganizationBilling: false,
		canManageWorkspacesDocuments: false,
		canReadOrganizationResources: true,
		canUseAiGrammarByPlan: true,
		canManageBillingSettings: false,
		canViewInvoicesSubscription: true,
	},
	{
		role: 'organization_owner',
		canAccessAdminBoard: false,
		canReviewSecurityAudit: false,
		canManageGlobalSettings: false,
		canManageMembers: true,
		canManageMemberBillingAdmin: true,
		canManageOrganizationBilling: true,
		canManageWorkspacesDocuments: true,
		canReadOrganizationResources: true,
		canUseAiGrammarByPlan: true,
		canManageBillingSettings: true,
		canViewInvoicesSubscription: true,
	},
	{
		role: 'organization_member',
		canAccessAdminBoard: false,
		canReviewSecurityAudit: false,
		canManageGlobalSettings: false,
		canManageMembers: false,
		canManageMemberBillingAdmin: false,
		canManageOrganizationBilling: false,
		canManageWorkspacesDocuments: true,
		canReadOrganizationResources: true,
		canUseAiGrammarByPlan: true,
		canManageBillingSettings: false,
		canViewInvoicesSubscription: false,
	},
	{
		role: 'billing_admin',
		canAccessAdminBoard: false,
		canReviewSecurityAudit: false,
		canManageGlobalSettings: false,
		canManageMembers: false,
		canManageMemberBillingAdmin: false,
		canManageOrganizationBilling: true,
		canManageWorkspacesDocuments: false,
		canReadOrganizationResources: true,
		canUseAiGrammarByPlan: false,
		canManageBillingSettings: true,
		canViewInvoicesSubscription: true,
	},
];

function ensureProfileTableSeeded() {
	if (profiles.size > 0) return;
	const timestamp = nowIso();
	for (const definition of PROFILE_TABLE_DEFAULTS) {
		const id = uuidv4();
		profiles.set(id, {
			id,
			role: definition.role,
			canAccessAdminBoard: Boolean(definition.canAccessAdminBoard),
			canReviewSecurityAudit: Boolean(definition.canReviewSecurityAudit),
			canManageGlobalSettings: Boolean(definition.canManageGlobalSettings),
			canManageMembers: Boolean(definition.canManageMembers),
			canManageMemberBillingAdmin: Boolean(definition.canManageMemberBillingAdmin),
			canManageOrganizationBilling: Boolean(definition.canManageOrganizationBilling),
			canManageWorkspacesDocuments: Boolean(definition.canManageWorkspacesDocuments),
			canReadOrganizationResources: Boolean(definition.canReadOrganizationResources),
			canUseAiGrammarByPlan: Boolean(definition.canUseAiGrammarByPlan),
			canManageBillingSettings: Boolean(definition.canManageBillingSettings),
			canViewInvoicesSubscription: Boolean(definition.canViewInvoicesSubscription),
			createdAt: timestamp,
			updatedAt: timestamp,
		});
	}
}

function getProfileTable() {
	ensureProfileTableSeeded();
	return [...profiles.values()]
		.map((profile) => ({
			id: profile.id,
			role: profile.role,
			canAccessAdminBoard: Boolean(profile.canAccessAdminBoard),
			canReviewSecurityAudit: Boolean(profile.canReviewSecurityAudit),
			canManageGlobalSettings: Boolean(profile.canManageGlobalSettings),
			canManageMembers: Boolean(profile.canManageMembers),
			canManageMemberBillingAdmin: Boolean(profile.canManageMemberBillingAdmin),
			canManageOrganizationBilling: Boolean(profile.canManageOrganizationBilling),
			canManageWorkspacesDocuments: Boolean(profile.canManageWorkspacesDocuments),
			canReadOrganizationResources: Boolean(profile.canReadOrganizationResources),
			canUseAiGrammarByPlan: Boolean(profile.canUseAiGrammarByPlan),
			canManageBillingSettings: Boolean(profile.canManageBillingSettings),
			canViewInvoicesSubscription: Boolean(profile.canViewInvoicesSubscription),
			createdAt: profile.createdAt,
			updatedAt: profile.updatedAt,
		}))
		.sort((a, b) => a.role.localeCompare(b.role));
}

async function initializePersistentMaps() {
	await initializeSchemaPersistentMaps();
	ensureProfileTableSeeded();
}

function normalizeDomain(value) {
	return String(value || '').toLowerCase().trim().replace(/^@+/, '');
}

function normalizeIp(value) {
	return String(value || '').trim();
}

function ensureOrganizationSecurityState(organization) {
	if (!organization.security) {
		organization.security = {
			requireMfa: false,
			sessionDurationHours: 8,
			ipAllowlistEnabled: false,
			ipAllowlist: [],
			domainMappings: [],
			ssoProviders: [],
			updatedAt: nowIso(),
		};
	}

	if (typeof organization.security.requireMfa !== 'boolean') organization.security.requireMfa = false;
	if (typeof organization.security.ipAllowlistEnabled !== 'boolean') organization.security.ipAllowlistEnabled = false;
	if (!Array.isArray(organization.security.ipAllowlist)) organization.security.ipAllowlist = [];
	if (!Array.isArray(organization.security.domainMappings)) organization.security.domainMappings = [];
	if (!Array.isArray(organization.security.ssoProviders)) organization.security.ssoProviders = [];

	organization.security.sessionDurationHours = Math.min(
		24,
		Math.max(1, Number(organization.security.sessionDurationHours || 8)),
	);

	organization.security.ipAllowlist = organization.security.ipAllowlist
		.map(normalizeIp)
		.filter(Boolean);
	organization.security.domainMappings = organization.security.domainMappings
		.map(normalizeDomain)
		.filter(Boolean);

	if (!organization.security.updatedAt) organization.security.updatedAt = nowIso();
	organizations.set(organization.id, organization);
	return organization.security;
}

function getOrganizationSecurityState(organizationId) {
	const organization = organizations.get(organizationId);
	if (!organization) return null;
	return ensureOrganizationSecurityState(organization);
}

function updateOrganizationSecurityState(organizationId, updater) {
	const organization = organizations.get(organizationId);
	if (!organization) return null;
	const current = ensureOrganizationSecurityState(organization);
	const next = typeof updater === 'function' ? updater({ ...current }) : current;
	if (!next) return current;

	organization.security = {
		...current,
		...next,
		updatedAt: nowIso(),
	};
	ensureOrganizationSecurityState(organization);
	organizations.set(organization.id, organization);
	return organization.security;
}

function findOrganizationByDomain(emailOrDomain) {
	const raw = String(emailOrDomain || '').toLowerCase();
	const domain = raw.includes('@') ? raw.split('@').pop() : raw;
	const normalized = normalizeDomain(domain);
	if (!normalized) return null;

	for (const organization of organizations.values()) {
		const security = ensureOrganizationSecurityState(organization);
		if (security.domainMappings.includes(normalized)) return organization;
	}
	return null;
}

async function ensureOrganizationBillingState(organization) {
	if (!organization?.id) return null;
	let billing = null;
	if (isDatabaseConfigured()) {
		billing = await readOrganizationBillingStateFromDb(organization.id);
	}

	if (!billing) {
		billing = normalizeOrganizationBillingState(null, organization.id);
		if (isDatabaseConfigured()) {
			await writeOrganizationBillingStateToDb(organization.id, billing);
		}
	}
	return billing;
}

async function getOrganizationBillingState(organizationId) {
	const organization = organizations.get(organizationId);
	if (!organization) return null;
	return ensureOrganizationBillingState(organization);
}

async function upsertOrganizationBillingState(organizationId, updates = {}) {
	const organization = organizations.get(organizationId);
	if (!organization) return null;
	const current = await ensureOrganizationBillingState(organization);
	const next = normalizeOrganizationBillingState({
		...current,
		...updates,
		updatedAt: nowIso(),
	}, organizationId);
	organizationBilling.set(organizationId, next);
	if (isDatabaseConfigured()) {
		await writeOrganizationBillingStateToDb(organizationId, next);
	}
	return next;
}

async function ensureUserBillingState(user) {
	if (!user?.id) return null;

	if (isDatabaseConfigured()) {
		const direct = await readUserBillingStateFromDb(user.id, user.email);
		if (direct) {
			const normalizedDirect = normalizeUserBillingState(direct, user.id, user.email);
			userBilling.set(user.id, normalizedDirect);
			await writeUserBillingStateToDb(normalizedDirect);
			return normalizedDirect;
		}
		const created = normalizeUserBillingState(null, user.id, user.email);
		await writeUserBillingStateToDb(created);
		userBilling.set(user.id, created);
		return created;
	}

	const existing = userBilling.get(user.id);
	if (existing) {
		const normalized = normalizeUserBillingState(existing, user.id, user.email);
		userBilling.set(user.id, normalized);
		return normalized;
	}
	const state = normalizeUserBillingState(null, user.id, user.email);
	userBilling.set(user.id, state);
	return state;
}

async function refreshBillingStatus(organizationId) {
	const organization = organizations.get(organizationId);
	if (!organization) return null;
	const billing = await ensureOrganizationBillingState(organization);
	const nowMs = Date.now();

	if ((billing.status === 'past_due' || billing.status === 'grace') && billing.graceEndsAt) {
		if (new Date(billing.graceEndsAt).getTime() <= nowMs) {
			billing.status = 'suspended';
			billing.updatedAt = nowIso();
		}
	}

	if (billing.status === 'trialing' && billing.trialEndsAt) {
		if (new Date(billing.trialEndsAt).getTime() <= nowMs) {
			billing.status = 'active';
			billing.updatedAt = nowIso();
		}
	}

	if (billing.status === 'canceled' && billing.currentPeriodEndAt) {
		if (new Date(billing.currentPeriodEndAt).getTime() <= nowMs) {
			billing.planId = 'free';
			billing.status = 'active';
			billing.purchasedSeats = PLAN_CATALOG.free.limits.seats;
			billing.subscriptionId = null;
			billing.currentPeriodEndAt = null;
			billing.graceEndsAt = null;
			billing.updatedAt = nowIso();
		}
	}

	organizationBilling.set(organization.id, billing);
	if (isDatabaseConfigured()) {
		await writeOrganizationBillingStateToDb(organization.id, billing);
	}
	return billing;
}

function isBillingWriteBlocked(billingState) {
	if (!billingState) return false;
	return billingState.status === 'suspended';
}

function getOrganizationUsage(organizationId) {
	const monthKey = monthKeyFromDate(new Date());
	const existing = organizationUsage.get(organizationId);
	if (existing && existing.monthKey === monthKey) return existing;
	const usage = {
		organizationId,
		monthKey,
		aiRequests: 0,
		documentUpdates: 0,
	};
	organizationUsage.set(organizationId, usage);
	return usage;
}

function isWithinPlanAccessDays(organization, accessDays) {
	if (!organization) return false;
	if (accessDays === null || accessDays === undefined) return true;
	const parsedDays = Number(accessDays);
	if (!Number.isFinite(parsedDays) || parsedDays <= 0) return false;
	const startAtMs = new Date(organization.createdAt || nowIso()).getTime();
	const expiresAtMs = startAtMs + parsedDays * 24 * 60 * 60 * 1000;
	return Date.now() <= expiresAtMs;
}

function countOrganizationDocuments(organizationId) {
	let total = 0;
	for (const doc of documents.values()) {
		if (doc.organizationId === organizationId) total += 1;
	}
	return total;
}

async function canCreateDocuments(organizationId, additionalDocuments = 1) {
	const billing = await refreshBillingStatus(organizationId) || await getOrganizationBillingState(organizationId);
	if (!billing) return { allowed: false, reason: 'Organization not found.' };
	const plan = getPlan(billing.planId);
	const limit = plan.limits.documents;
	if (limit === null || limit === undefined) {
		return { allowed: true, current: countOrganizationDocuments(organizationId), limit: null };
	}
	const current = countOrganizationDocuments(organizationId);
	const nextTotal = current + Math.max(0, additionalDocuments);
	if (nextTotal > limit) {
		return {
			allowed: false,
			reason: `Document limit reached (${current}/${limit}) for ${plan.name} plan.`,
		};
	}
	return { allowed: true, current, limit };
}

async function canUpdateDocuments(organizationId, additionalUpdates = 1) {
	const billing = await refreshBillingStatus(organizationId) || await getOrganizationBillingState(organizationId);
	if (!billing) return { allowed: false, reason: 'Organization not found.' };
	const plan = getPlan(billing.planId);
	const limit = plan.limits.documentUpdatesPerMonth;
	const usage = getOrganizationUsage(organizationId);
	if (limit === null || limit === undefined) {
		return { allowed: true, usage, limit: null };
	}
	const nextTotal = (usage.documentUpdates || 0) + Math.max(0, additionalUpdates);
	if (nextTotal > limit) {
		return {
			allowed: false,
			reason: `Document update limit reached (${usage.documentUpdates || 0}/${limit}) for ${plan.name} plan.`,
			usage,
			limit,
		};
	}
	return { allowed: true, usage, limit };
}

async function consumeDocumentUpdates(organizationId, count = 1) {
	const check = await canUpdateDocuments(organizationId, count);
	if (!check.allowed) return check;
	const usage = getOrganizationUsage(organizationId);
	usage.documentUpdates = (usage.documentUpdates || 0) + Math.max(0, count);
	organizationUsage.set(organizationId, usage);
	return { allowed: true, usage };
}

async function canUseGrammar(organizationId) {
	const organization = organizations.get(organizationId);
	if (!organization) return { allowed: false, reason: 'Organization not found.' };
	const billing = await refreshBillingStatus(organizationId) || await getOrganizationBillingState(organizationId);
	if (!billing) return { allowed: false, reason: 'Organization not found.' };
	const plan = getPlan(billing.planId);
	if (isWithinPlanAccessDays(organization, plan.limits.grammarAccessDays)) {
		return { allowed: true };
	}
	return {
		allowed: false,
		reason: `Grammar checker access expired for ${plan.name} plan.`,
	};
}

function getAssignedSeatCount(organizationId) {
	return [...organizationMemberships.values()].filter(
		(membership) => membership.organizationId === organizationId && membership.status === 'active',
	).length;
}

function getCollaboratorCount(organizationId) {
	return getAssignedSeatCount(organizationId);
}

async function canAssignSeats(organizationId, additionalSeats = 1) {
	const billing = await refreshBillingStatus(organizationId) || await getOrganizationBillingState(organizationId);
	if (!billing) return { allowed: false, reason: 'Organization not found.' };
	const assignedSeats = getAssignedSeatCount(organizationId);
	const nextAssigned = assignedSeats + Math.max(0, additionalSeats);
	if (nextAssigned > billing.purchasedSeats) {
		return {
			allowed: false,
			reason: `Seat limit reached (${assignedSeats}/${billing.purchasedSeats}). Purchase more seats to continue.`,
		};
	}
	return { allowed: true, assignedSeats, purchasedSeats: billing.purchasedSeats };
}

async function canAssignCollaborators(organizationId, additionalCollaborators = 1) {
	const billing = await refreshBillingStatus(organizationId) || await getOrganizationBillingState(organizationId);
	if (!billing) return { allowed: false, reason: 'Organization not found.' };
	const plan = getPlan(billing.planId);
	const current = getCollaboratorCount(organizationId);
	const nextTotal = current + Math.max(0, additionalCollaborators);
	if (nextTotal > plan.limits.collaborators) {
		return {
			allowed: false,
			reason: `Collaborator limit reached (${current}/${plan.limits.collaborators}) for ${plan.name} plan.`,
		};
	}
	return { allowed: true, current, limit: plan.limits.collaborators };
}

function calculateOrganizationStorageBytes(organizationId) {
	let total = 0;
	for (const doc of documents.values()) {
		if (doc.organizationId === organizationId) {
			total += Buffer.byteLength(String(doc.content || ''), 'utf8');
		}
	}
	return total;
}

async function canConsumeAiRequests(organizationId, count = 1) {
	const organization = organizations.get(organizationId);
	if (!organization) return { allowed: false, reason: 'Organization not found.' };
	const billing = await refreshBillingStatus(organizationId) || await getOrganizationBillingState(organizationId);
	if (!billing) return { allowed: false, reason: 'Organization not found.' };
	if (billing.status === 'suspended') {
		return { allowed: false, reason: 'Subscription suspended due to failed payments.' };
	}
	const plan = getPlan(billing.planId);
	if (!isWithinPlanAccessDays(organization, plan.limits.aiAccessDays)) {
		return {
			allowed: false,
			reason: `AI assistant access expired for ${plan.name} plan.`,
		};
	}
	const usage = getOrganizationUsage(organizationId);
	const nextUsage = usage.aiRequests + Math.max(0, count);
	if (nextUsage > plan.limits.aiRequestsPerMonth) {
		return {
			allowed: false,
			reason: `AI monthly limit reached (${usage.aiRequests}/${plan.limits.aiRequestsPerMonth}) for ${plan.name} plan.`,
		};
	}
	return { allowed: true, usage, limit: plan.limits.aiRequestsPerMonth };
}

async function consumeAiRequests(organizationId, count = 1) {
	const check = await canConsumeAiRequests(organizationId, count);
	if (!check.allowed) return check;
	const usage = getOrganizationUsage(organizationId);
	usage.aiRequests += Math.max(0, count);
	organizationUsage.set(organizationId, usage);
	return { allowed: true, usage };
}

async function getOrganizationEntitlements(organizationId) {
	const billing = await refreshBillingStatus(organizationId) || await getOrganizationBillingState(organizationId);
	if (!billing) return null;
	const plan = getPlan(billing.planId);
	const usage = getOrganizationUsage(organizationId);
	const assignedSeats = getAssignedSeatCount(organizationId);
	const storageUsedBytes = calculateOrganizationStorageBytes(organizationId);
	const collaboratorsAssigned = getCollaboratorCount(organizationId);

	return {
		billing,
		plan,
		limits: {
			seatsPurchased: billing.purchasedSeats,
			storageBytes: plan.limits.storageBytes,
			aiRequestsPerMonth: plan.limits.aiRequestsPerMonth,
			collaborators: plan.limits.collaborators,
			documents: plan.limits.documents,
			documentUpdatesPerMonth: plan.limits.documentUpdatesPerMonth,
			versionHistoryDays: plan.limits.versionHistoryDays,
			grammarAccessDays: plan.limits.grammarAccessDays,
			aiAccessDays: plan.limits.aiAccessDays,
		},
		usage: {
			monthKey: usage.monthKey,
			aiRequests: usage.aiRequests,
			documentUpdates: usage.documentUpdates || 0,
			assignedSeats,
			storageUsedBytes,
			collaboratorsAssigned,
		},
	};
}

async function getVersionHistoryRetentionDays(organizationId) {
	const billing = await refreshBillingStatus(organizationId) || await getOrganizationBillingState(organizationId);
	if (!billing) return null;
	const plan = getPlan(billing.planId);
	return plan.limits.versionHistoryDays;
}

function upsertInvoice(invoice) {
	invoices.set(invoice.id, invoice);
	return invoice;
}

function listInvoicesByOrganization(organizationId) {
	return [...invoices.values()]
		.filter((invoice) => invoice.organizationId === organizationId)
		.sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime());
}

function enqueueWebhookJob(provider, event) {
	const eventId = String(event.id || uuidv4());
	if (processedWebhookEvents.get(eventId)) {
		return { skipped: true, reason: 'already-processed', eventId };
	}
	const existingJob = [...webhookJobs.values()].find((job) => job.eventId === eventId);
	if (existingJob) return { skipped: true, reason: 'already-queued', eventId, job: existingJob };

	const now = nowIso();
	const job = {
		id: uuidv4(),
		eventId,
		provider,
		type: String(event.type || 'unknown'),
		payload: event,
		status: 'queued',
		attempts: 0,
		maxAttempts: 8,
		nextAttemptAt: now,
		lastError: null,
		createdAt: now,
		updatedAt: now,
	};
	webhookJobs.set(job.id, job);
	return { skipped: false, eventId, job };
}

function listWebhookJobs() {
	return [...webhookJobs.values()].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function getDueWebhookJobs(limit = 20) {
	const nowMs = Date.now();
	return [...webhookJobs.values()]
		.filter((job) => (job.status === 'queued' || job.status === 'failed') && new Date(job.nextAttemptAt).getTime() <= nowMs)
		.sort((a, b) => new Date(a.nextAttemptAt).getTime() - new Date(b.nextAttemptAt).getTime())
		.slice(0, limit);
}

function markWebhookJobProcessing(jobId) {
	const job = webhookJobs.get(jobId);
	if (!job) return null;
	job.status = 'processing';
	job.updatedAt = nowIso();
	webhookJobs.set(job.id, job);
	return job;
}

function markWebhookJobProcessed(jobId) {
	const job = webhookJobs.get(jobId);
	if (!job) return null;
	job.status = 'processed';
	job.updatedAt = nowIso();
	webhookJobs.set(job.id, job);
	processedWebhookEvents.set(job.eventId, {
		eventId: job.eventId,
		provider: job.provider,
		processedAt: nowIso(),
	});
	return job;
}

function markWebhookJobFailed(jobId, errorMessage) {
	const job = webhookJobs.get(jobId);
	if (!job) return null;
	job.attempts += 1;
	job.lastError = String(errorMessage || 'Unknown webhook processing error');
	job.status = job.attempts >= job.maxAttempts ? 'failed' : 'queued';
	const backoffMs = Math.min(60 * 60 * 1000, Math.pow(2, job.attempts) * 1000);
	job.nextAttemptAt = new Date(Date.now() + backoffMs).toISOString();
	job.updatedAt = nowIso();
	webhookJobs.set(job.id, job);
	return job;
}

function mapWorkspaceRowToRecord(row) {
	return {
		id: row.id,
		name: row.name,
		ownerId: row.ownerId,
		memberIds: Array.isArray(row.memberIds) ? row.memberIds : [row.ownerId],
		organizationId: row.organizationId || null,
		createdAt: new Date(row.createdAt).toISOString(),
		updatedAt: new Date(row.updatedAt).toISOString(),
	};
}

async function syncCurrentOrganizationFromMembership(user) {
	if (!user) return null;
	if (!isDatabaseConfigured()) return null;

	const normalizedEmail = String(user.email || '').toLowerCase().trim();
	if (!normalizedEmail) return null;

	const dbUser = await prisma.user.findUnique({
		where: { email: normalizedEmail },
		select: { id: true },
	});
	if (!dbUser) return null;

	const activeMemberships = await prisma.organizationMembership.findMany({
		where: {
			userId: dbUser.id,
			status: 'active',
		},
		orderBy: {
			createdAt: 'asc',
		},
	});

	if (!activeMemberships.length) {
		user.currentOrganizationId = null;
		users.set(user.id, user);
		await prisma.user.updateMany({
			where: { email: normalizedEmail },
			data: { currentOrganizationId: null },
		});
		return null;
	}

	const existingCurrent = activeMemberships.find(
		(membership) => membership.organizationId === user.currentOrganizationId,
	);
	const selectedMembership = existingCurrent || activeMemberships[0];

	let organization = organizations.get(selectedMembership.organizationId) || null;
	if (!organization) {
		const row = await prisma.organization.findUnique({ where: { id: selectedMembership.organizationId } });
		if (row) {
			organization = {
				id: row.id,
				name: row.name,
				ownerUserId: row.ownerUserId,
				createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
				updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
				...(row.security && typeof row.security === 'object' && !Array.isArray(row.security) ? { security: row.security } : {}),
			};
			organizations.set(organization.id, organization);
		}
	}

	if (!organization) {
		user.currentOrganizationId = null;
		users.set(user.id, user);
		await prisma.user.updateMany({
			where: { email: normalizedEmail },
			data: { currentOrganizationId: null },
		});
		return null;
	}

	await ensureOrganizationBillingState(organization);
	ensureOrganizationSecurityState(organization);
	user.currentOrganizationId = organization.id;
	users.set(user.id, user);
	await prisma.user.updateMany({
		where: { email: normalizedEmail },
		data: { currentOrganizationId: organization.id },
	});

	return organization;
}

async function ensureWorkspaceForUserProvisioned(user) {
	const personalScopeId = user.id;
	if (!isDatabaseConfigured()) {
		return null;
	}

	let row = await prisma.workspace.findFirst({
		where: {
			ownerId: user.id,
			organizationId: personalScopeId,
		},
		orderBy: {
			createdAt: 'asc',
		},
	});
	if (!row) {
		const workspace = {
			id: uuidv4(),
			name: `${user.name}'s Workspace`,
			ownerId: user.id,
			memberIds: [user.id],
			organizationId: personalScopeId,
			createdAt: nowIso(),
			updatedAt: nowIso(),
		};

		row = await prisma.workspace.create({
			data: {
				id: workspace.id,
				name: workspace.name,
				ownerId: workspace.ownerId,
				organizationId: workspace.organizationId,
				memberIds: workspace.memberIds,
				createdAt: new Date(workspace.createdAt),
			},
		});
	}
	return mapWorkspaceRowToRecord(row);
}

async function ensureTenantBootstrapForUser(user) {
	if (!user) return null;
	if (!isDatabaseConfigured()) return null;
	const normalizedEmail = String(user.email || '').toLowerCase().trim();
	if (!normalizedEmail) return null;

	const dbUser = await prisma.user.findUnique({
		where: { email: normalizedEmail },
		select: { id: true, name: true, currentOrganizationId: true, email: true },
	});
	if (!dbUser) return null;

	const membershipEmail = dbUser.email;
	const activeMemberships = await prisma.organizationMembership.findMany({
		where: {
			email: membershipEmail,
			status: 'active',
		},
		orderBy: {
			createdAt: 'asc',
		},
	});

	if (activeMemberships.length) {
		await prisma.userBilling.deleteMany({
			where: {
				userId: dbUser.id,
			},
		});

		const organization = await prisma.organization.findUnique({ where: { id: activeMemberships[0].organizationId } });
		if (!organization) return null;

		await ensureOrganizationBillingState(organization);
		const security = ensureOrganizationSecurityState(organization);
		await prisma.organization.updateMany({
			where: { id: organization.id },
			data: { security },
		});

		user.currentOrganizationId = organization.id;
		await prisma.user.updateMany({
			where: { email: normalizedEmail },
			data: { currentOrganizationId: organization.id },
		});

		await prisma.document.updateMany({
			where: {
				userId: user.id,
				organizationId: null,
			},
			data: {
				organizationId: organization.id,
			},
		});

		return organization;
	}

	return null;
}

module.exports = {
	users,
	organizations,
	PLAN_CATALOG,
	TRIAL_DAYS_BY_PLAN,
	organizationMemberships,
	organizationInvites,
	authSessions,
	invoices,
	organizationBilling,
	userBilling,
	organizationUsage,
	userUsage,
	webhookJobs,
	processedWebhookEvents,
	authTokens,
	auditLogs,
	documents,
	comments,
	versions,
	todos,
	workspaces,
	initializePersistentMaps,
	nowIso,
	getPlan,
	getAllPlans,
	getOrganizationBillingState,
	upsertOrganizationBillingState,
	ensureUserBillingState,
	getOrganizationSecurityState,
	findOrganizationByDomain,
	updateOrganizationSecurityState,
	refreshBillingStatus,
	isBillingWriteBlocked,
	getOrganizationEntitlements,
	canAssignSeats,
	canAssignCollaborators,
	calculateOrganizationStorageBytes,
	canConsumeAiRequests,
	consumeAiRequests,
	canCreateDocuments,
	canUpdateDocuments,
	consumeDocumentUpdates,
	canUseGrammar,
	getVersionHistoryRetentionDays,
	upsertInvoice,
	listInvoicesByOrganization,
	enqueueWebhookJob,
	listWebhookJobs,
	getDueWebhookJobs,
	markWebhookJobProcessing,
	markWebhookJobProcessed,
	markWebhookJobFailed,
	ensureTenantBootstrapForUser,
	syncCurrentOrganizationFromMembership,
	ensureWorkspaceForUserProvisioned,
	getProfileTable,
};
