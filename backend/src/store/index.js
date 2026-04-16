/**
 * In-memory data store.
 * Each Map is keyed by entity ID.
 * Swap these out for a real DB (Postgres, MongoDB, etc.) later.
 */

const { v4: uuidv4 } = require('uuid');

/** @type {Map<string, { id: string, name: string, username?: string, email: string, passwordHash: string, createdAt: string, emailVerified: boolean, failedLoginAttempts: number, lockoutUntil: string | null, role?: string, twoFactorEnabled: boolean, twoFactorSecret: string | null, twoFactorTempSecret: string | null }>} */
const users = new Map();

/** @type {Map<string, { id: string, name: string, ownerUserId: string, createdAt: string, updatedAt: string, billing?: Record<string, unknown> }>} */
const organizations = new Map();

const PLAN_CATALOG = {
	free: {
		id: 'free',
		name: 'Free',
		priceMonthlyCents: 0,
		limits: {
			seats: 3,
			storageBytes: 1024 * 1024 * 1024,
			aiRequestsPerMonth: 200,
			collaborators: 2,
		},
	},
	pro: {
		id: 'pro',
		name: 'Pro',
		priceMonthlyCents: 2900,
		limits: {
			seats: 10,
			storageBytes: 20 * 1024 * 1024 * 1024,
			aiRequestsPerMonth: 5000,
			collaborators: 8,
		},
	},
	business: {
		id: 'business',
		name: 'Business',
		priceMonthlyCents: 12900,
		limits: {
			seats: 50,
			storageBytes: 200 * 1024 * 1024 * 1024,
			aiRequestsPerMonth: 30000,
			collaborators: 40,
		},
	},
	enterprise: {
		id: 'enterprise',
		name: 'Enterprise',
		priceMonthlyCents: 39900,
		limits: {
			seats: 500,
			storageBytes: 2 * 1024 * 1024 * 1024 * 1024,
			aiRequestsPerMonth: 200000,
			collaborators: 450,
		},
	},
};

const TRIAL_DAYS_BY_PLAN = {
	pro: 14,
	business: 14,
	enterprise: 30,
};

/** @type {Map<string, { id: string, organizationId: string, userId: string, role: 'owner' | 'admin' | 'editor' | 'viewer', billingAdmin: boolean, status: 'active' | 'removed', createdAt: string, updatedAt: string }>} */
const organizationMemberships = new Map();

/** @type {Map<string, { id: string, token: string, organizationId: string, email: string, role: 'owner' | 'admin' | 'editor' | 'viewer', billingAdmin: boolean, status: 'pending' | 'accepted' | 'expired' | 'cancelled', invitedByUserId: string, createdAt: string, updatedAt: string, expiresAt: string, acceptedAt: string | null }>} */
const organizationInvites = new Map();

/** @type {Map<string, { id: string, userId: string, refreshTokenHash: string, csrfToken: string, createdAt: string, lastUsedAt: string, expiresAt: string, revokedAt: string | null, remember: boolean, userAgent: string, ipAddress: string }>} */
const authSessions = new Map();

/** @type {Map<string, { id: string, organizationId: string, provider: string, status: 'draft' | 'open' | 'paid' | 'failed' | 'void', amountCents: number, currency: string, periodStart: string | null, periodEnd: string | null, issuedAt: string, paidAt: string | null, hostedUrl: string | null }>} */
const invoices = new Map();

/** @type {Map<string, { organizationId: string, monthKey: string, aiRequests: number }>} */
const organizationUsage = new Map();

/** @type {Map<string, { id: string, eventId: string, provider: string, type: string, payload: Record<string, unknown>, status: 'queued' | 'processing' | 'processed' | 'failed', attempts: number, maxAttempts: number, nextAttemptAt: string, lastError: string | null, createdAt: string, updatedAt: string }>} */
const webhookJobs = new Map();

/** @type {Map<string, { eventId: string, provider: string, processedAt: string }>} */
const processedWebhookEvents = new Map();

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

function ensureOrganizationBillingState(organization) {
	if (!organization.billing) {
		organization.billing = {
			planId: 'free',
			status: 'active',
			purchasedSeats: PLAN_CATALOG.free.limits.seats,
			trialEndsAt: null,
			trialUsed: false,
			subscriptionId: null,
			customerId: null,
			currentPeriodEndAt: null,
			graceEndsAt: null,
			updatedAt: nowIso(),
		};
	}
	if (!organization.billing.planId || !PLAN_CATALOG[organization.billing.planId]) {
		organization.billing.planId = 'free';
	}
	if (!organization.billing.purchasedSeats || organization.billing.purchasedSeats < 1) {
		organization.billing.purchasedSeats = getPlan(organization.billing.planId).limits.seats;
	}
	if (typeof organization.billing.trialUsed !== 'boolean') {
		organization.billing.trialUsed = false;
	}
	if (!organization.billing.updatedAt) organization.billing.updatedAt = nowIso();
	organizations.set(organization.id, organization);
	return organization.billing;
}

function getOrganizationBillingState(organizationId) {
	const organization = organizations.get(organizationId);
	if (!organization) return null;
	return ensureOrganizationBillingState(organization);
}

function refreshBillingStatus(organizationId) {
	const organization = organizations.get(organizationId);
	if (!organization) return null;
	const billing = ensureOrganizationBillingState(organization);
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

	organizations.set(organization.id, organization);
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
		aiRequests: existing && existing.monthKey === monthKey ? existing.aiRequests : 0,
	};
	organizationUsage.set(organizationId, usage);
	return usage;
}

function getAssignedSeatCount(organizationId) {
	return [...organizationMemberships.values()].filter(
		(membership) => membership.organizationId === organizationId && membership.status === 'active',
	).length;
}

function getCollaboratorCount(organizationId) {
	return [...organizationMemberships.values()].filter(
		(membership) =>
			membership.organizationId === organizationId &&
			membership.status === 'active' &&
			membership.role !== 'viewer',
	).length;
}

function canAssignSeats(organizationId, additionalSeats = 1) {
	const billing = refreshBillingStatus(organizationId) || getOrganizationBillingState(organizationId);
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

function canAssignCollaborators(organizationId, additionalCollaborators = 1) {
	const billing = refreshBillingStatus(organizationId) || getOrganizationBillingState(organizationId);
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

function canConsumeAiRequests(organizationId, count = 1) {
	const billing = refreshBillingStatus(organizationId) || getOrganizationBillingState(organizationId);
	if (!billing) return { allowed: false, reason: 'Organization not found.' };
	if (billing.status === 'suspended') {
		return { allowed: false, reason: 'Subscription suspended due to failed payments.' };
	}
	const plan = getPlan(billing.planId);
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

function consumeAiRequests(organizationId, count = 1) {
	const check = canConsumeAiRequests(organizationId, count);
	if (!check.allowed) return check;
	const usage = getOrganizationUsage(organizationId);
	usage.aiRequests += Math.max(0, count);
	organizationUsage.set(organizationId, usage);
	return { allowed: true, usage };
}

function getOrganizationEntitlements(organizationId) {
	const billing = refreshBillingStatus(organizationId) || getOrganizationBillingState(organizationId);
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
		},
		usage: {
			monthKey: usage.monthKey,
			aiRequests: usage.aiRequests,
			assignedSeats,
			storageUsedBytes,
			collaboratorsAssigned,
		},
	};
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

function ensureOrganizationForUser(user) {
	const existingMembership = [...organizationMemberships.values()].find(
		(membership) => membership.userId === user.id && membership.status === 'active',
	);
	if (existingMembership) {
		const existingOrg = organizations.get(existingMembership.organizationId);
		if (existingOrg) {
			ensureOrganizationBillingState(existingOrg);
			ensureOrganizationSecurityState(existingOrg);
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
	ensureOrganizationBillingState(organization);
	ensureOrganizationSecurityState(organization);

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
	ensureOrganizationBillingState(organization);
	hydrateLegacyResourcesForUser(user, organization.id);
	ensureWorkspaceForUser(user, organization.id);
	return organization;
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
	organizationUsage,
	webhookJobs,
	processedWebhookEvents,
	authTokens,
	auditLogs,
	documents,
	comments,
	versions,
	todos,
	workspaces,
	nowIso,
	monthKeyFromDate,
	getPlan,
	getAllPlans,
	normalizeDomain,
	getOrganizationBillingState,
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
	upsertInvoice,
	listInvoicesByOrganization,
	enqueueWebhookJob,
	listWebhookJobs,
	getDueWebhookJobs,
	markWebhookJobProcessing,
	markWebhookJobProcessed,
	markWebhookJobFailed,
	ensureOrganizationForUser,
	ensureTenantBootstrapForUser,
	ensureWorkspaceForUser,
};
