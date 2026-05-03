const { v4: uuidv4 } = require('uuid');
const { PLAN_CATALOG, TRIAL_DAYS_BY_PLAN } = require('./catalog');
const {
	users,
	organizations,
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
} = require('./schemas');

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
		documentUpdates: existing && existing.monthKey === monthKey ? (existing.documentUpdates || 0) : 0,
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

function canCreateDocuments(organizationId, additionalDocuments = 1) {
	const billing = refreshBillingStatus(organizationId) || getOrganizationBillingState(organizationId);
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

function canUpdateDocuments(organizationId, additionalUpdates = 1) {
	const billing = refreshBillingStatus(organizationId) || getOrganizationBillingState(organizationId);
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

function consumeDocumentUpdates(organizationId, count = 1) {
	const check = canUpdateDocuments(organizationId, count);
	if (!check.allowed) return check;
	const usage = getOrganizationUsage(organizationId);
	usage.documentUpdates = (usage.documentUpdates || 0) + Math.max(0, count);
	organizationUsage.set(organizationId, usage);
	return { allowed: true, usage };
}

function canUseGrammar(organizationId) {
	const organization = organizations.get(organizationId);
	if (!organization) return { allowed: false, reason: 'Organization not found.' };
	const billing = refreshBillingStatus(organizationId) || getOrganizationBillingState(organizationId);
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
	const organization = organizations.get(organizationId);
	if (!organization) return { allowed: false, reason: 'Organization not found.' };
	const billing = refreshBillingStatus(organizationId) || getOrganizationBillingState(organizationId);
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

function getVersionHistoryRetentionDays(organizationId) {
	const billing = refreshBillingStatus(organizationId) || getOrganizationBillingState(organizationId);
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
	ensureOrganizationForUser,
	ensureTenantBootstrapForUser,
	ensureWorkspaceForUser,
};
