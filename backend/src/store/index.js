const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');
const { PLAN_CATALOG, TRIAL_DAYS_BY_PLAN, refreshPlanCatalogFromDb } = require('./catalog');
const { nowIso: runtimeNowIso, isDatabaseConfigured: runtimeIsDatabaseConfigured, toIsoOrNull: runtimeToIsoOrNull } = require('../lib/runtime-utils');

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

	if (!state.planId) state.planId = 'free';
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

	if (!state.planId) state.planId = 'free';
	if (!state.status) state.status = 'active';
	if (!state.purchasedSeats || state.purchasedSeats < 1) {
		state.purchasedSeats = getPlan(state.planId).limits.seats;
	}
	state.trialUsed = typeof state.trialUsed === 'boolean' ? state.trialUsed : false;
	return state;
}

async function readUserBillingStateFromDb(email = null) {
	if (!isDatabaseConfigured()) return null;
	const normalizedEmail = String(email || '').toLowerCase().trim();
	if (normalizedEmail) {
		const byEmail = await prisma.userBilling.findUnique({ where: { email: normalizedEmail } });
		if (byEmail) {
			return normalizeUserBillingState(byEmail, byEmail.userId, normalizedEmail);
		}
	}
	return null;
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

function mapDbOrganizationToRecord(row) {
	if (!row) return null;
	return {
		id: row.id,
		name: row.name,
		ownerUserId: row.ownerUserId,
		createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
		updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
		...(row.security && typeof row.security === 'object' && !Array.isArray(row.security) ? { security: row.security } : {}),
	};
}

async function resolveOrganizationById(organizationId) {
	if (!organizationId) return null;
	if (!isDatabaseConfigured()) return null;
	const row = await prisma.organization.findUnique({ where: { id: organizationId } });
	if (!row) return null;
	const organization = mapDbOrganizationToRecord(row);
	return organization;
}

function normalizeUsageState(input, organizationId, monthKey) {
	return {
		organizationId,
		monthKey,
		aiRequests: Number(input?.aiRequests || 0),
		documentUpdates: Number(input?.documentUpdates || 0),
	};
}

async function readOrganizationUsageFromDb(organizationId, monthKey) {
	if (!isDatabaseConfigured()) return null;
	const row = await prisma.organizationUsage.findUnique({
		where: {
			organizationId_monthKey: {
				organizationId,
				monthKey,
			},
		},
	});
	if (!row) return null;
	return normalizeUsageState(row, organizationId, monthKey);
}

async function writeOrganizationUsageToDb(organizationId, monthKey, usage) {
	if (!isDatabaseConfigured() || !organizationId || !monthKey || !usage) return;
	await prisma.organizationUsage.upsert({
		where: {
			organizationId_monthKey: {
				organizationId,
				monthKey,
			},
		},
		update: {
			aiRequests: Number(usage.aiRequests || 0),
			documentUpdates: Number(usage.documentUpdates || 0),
		},
		create: {
			organizationId,
			monthKey,
			aiRequests: Number(usage.aiRequests || 0),
			documentUpdates: Number(usage.documentUpdates || 0),
		},
	});
}

function monthKeyFromDate(input = new Date()) {
	const date = input instanceof Date ? input : new Date(input);
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getPlan(planId) {
	if (isDatabaseConfigured()) {
		void refreshPlanCatalogFromDb().catch(() => {});
	}
	return PLAN_CATALOG[planId] || PLAN_CATALOG.free;
}

async function getAllPlans() {
	if (isDatabaseConfigured()) {
		await refreshPlanCatalogFromDb();
	}
	return Object.values(PLAN_CATALOG);
}

async function getPlanById(planId) {
	if (isDatabaseConfigured()) {
		await refreshPlanCatalogFromDb();
	}
	return getPlan(planId);
}

async function getProfileTable() {
	if (!isDatabaseConfigured()) return [];
	const rows = await prisma.profile.findMany({ orderBy: { role: 'asc' } });
	return rows.map((row) => ({
		id: row.id,
		role: row.role,
		canAccessAdminBoard: Boolean(row.canAccessAdminBoard),
		canReviewSecurityAudit: Boolean(row.canReviewSecurityAudit),
		canManageGlobalSettings: Boolean(row.canManageGlobalSettings),
		canManageMembers: Boolean(row.canManageMembers),
		canManageMemberBillingAdmin: Boolean(row.canManageMemberBillingAdmin),
		canManageOrganizationBilling: Boolean(row.canManageOrganizationBilling),
		canManageWorkspacesDocuments: Boolean(row.canManageWorkspacesDocuments),
		canReadOrganizationResources: Boolean(row.canReadOrganizationResources),
		canUseAiGrammarByPlan: Boolean(row.canUseAiGrammarByPlan),
		canManageBillingSettings: Boolean(row.canManageBillingSettings),
		canViewInvoicesSubscription: Boolean(row.canViewInvoicesSubscription),
		createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
		updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
	}));
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
	return organization.security;
}

async function getOrganizationSecurityState(organizationId) {
	const organization = await resolveOrganizationById(organizationId);
	if (!organization) return null;
	return ensureOrganizationSecurityState(organization);
}

async function updateOrganizationSecurityState(organizationId, updater) {
	const organization = await resolveOrganizationById(organizationId);
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
	await prisma.organization.update({
		where: { id: organizationId },
		data: { security: organization.security },
	});
	return organization.security;
}

async function findOrganizationByDomain(emailOrDomain) {
	const raw = String(emailOrDomain || '').toLowerCase();
	const domain = raw.includes('@') ? raw.split('@').pop() : raw;
	const normalized = normalizeDomain(domain);
	if (!normalized) return null;

	if (!isDatabaseConfigured()) return null;
	const rows = await prisma.organization.findMany();
	for (const row of rows) {
		const organization = mapDbOrganizationToRecord(row);
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
	const organization = await resolveOrganizationById(organizationId);
	if (!organization) return null;
	return ensureOrganizationBillingState(organization);
}

async function upsertOrganizationBillingState(organizationId, updates = {}) {
	const organization = await resolveOrganizationById(organizationId);
	if (!organization) return null;
	const current = await ensureOrganizationBillingState(organization);
	const next = normalizeOrganizationBillingState({
		...current,
		...updates,
		updatedAt: nowIso(),
	}, organizationId);
	await writeOrganizationBillingStateToDb(organizationId, next);
	return next;
}

async function ensureUserBillingState(user) {
	if (!user?.id || !user?.email) return null;

	if (isDatabaseConfigured()) {
		const direct = await readUserBillingStateFromDb(user.email);
		if (direct) {
			await writeUserBillingStateToDb(direct);
			return direct;
		}
		const created = normalizeUserBillingState(null, user.id, user.email);
		await writeUserBillingStateToDb(created);
		return created;
	}
	return null;
}

async function refreshBillingStatus(organizationId) {
	const organization = await resolveOrganizationById(organizationId);
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

	if (isDatabaseConfigured()) {
		await writeOrganizationBillingStateToDb(organization.id, billing);
	}
	return billing;
}

function isBillingWriteBlocked(billingState) {
	if (!billingState) return false;
	return billingState.status === 'suspended';
}

async function getOrganizationUsage(organizationId) {
	const monthKey = monthKeyFromDate(new Date());
	let usage = null;
	if (isDatabaseConfigured()) {
		usage = await readOrganizationUsageFromDb(organizationId, monthKey);
	}

	if (!usage) {
		usage = normalizeUsageState(null, organizationId, monthKey);
		if (isDatabaseConfigured()) {
			await writeOrganizationUsageToDb(organizationId, monthKey, usage);
		}
	}
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

async function countOrganizationDocuments(organizationId) {
	return prisma.document.count({ where: { organizationId } });
}

async function canCreateDocuments(organizationId, additionalDocuments = 1) {
	const billing = await refreshBillingStatus(organizationId) || await getOrganizationBillingState(organizationId);
	if (!billing) return { allowed: false, reason: 'Organization not found.' };
	const plan = getPlan(billing.planId);
	const limit = plan.limits.documents;
	if (limit === null || limit === undefined) {
		return { allowed: true, current: await countOrganizationDocuments(organizationId), limit: null };
	}
	const current = await countOrganizationDocuments(organizationId);
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
	const usage = await getOrganizationUsage(organizationId);
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
	const usage = await getOrganizationUsage(organizationId);
	usage.documentUpdates = (usage.documentUpdates || 0) + Math.max(0, count);
	if (isDatabaseConfigured()) {
		await writeOrganizationUsageToDb(organizationId, usage.monthKey, usage);
	}
	return { allowed: true, usage };
}

async function canUseGrammar(organizationId) {
	const organization = await resolveOrganizationById(organizationId);
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

async function getAssignedSeatCount(organizationId) {
	if (isDatabaseConfigured()) {
		return prisma.organizationMembership.count({
			where: {
				organizationId,
				status: 'active',
			},
		});
	}
}


async function getCollaboratorCount(organizationId) {
	return getAssignedSeatCount(organizationId);
}

async function canAssignSeats(organizationId, additionalSeats = 1) {
	const billing = await refreshBillingStatus(organizationId) || await getOrganizationBillingState(organizationId);
	if (!billing) return { allowed: false, reason: 'Organization not found.' };
	const assignedSeats = await getAssignedSeatCount(organizationId);
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
	const current = await getCollaboratorCount(organizationId);
	const nextTotal = current + Math.max(0, additionalCollaborators);
	if (nextTotal > plan.limits.collaborators) {
		return {
			allowed: false,
			reason: `Collaborator limit reached (${current}/${plan.limits.collaborators}) for ${plan.name} plan.`,
		};
	}
	return { allowed: true, current, limit: plan.limits.collaborators };
}

async function calculateOrganizationStorageBytes(organizationId) {
	const docs = await prisma.document.findMany({
		where: { organizationId },
		select: { content: true },
	});
	return docs.reduce((total, doc) => total + Buffer.byteLength(String(doc.content || ''), 'utf8'), 0);
}

async function canConsumeAiRequests(organizationId, count = 1) {
	const organization = await resolveOrganizationById(organizationId);
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
	const usage = await getOrganizationUsage(organizationId);
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
	const usage = await getOrganizationUsage(organizationId);
	usage.aiRequests += Math.max(0, count);
	if (isDatabaseConfigured()) {
		await writeOrganizationUsageToDb(organizationId, usage.monthKey, usage);
	}
	return { allowed: true, usage };
}

async function getOrganizationEntitlements(organizationId) {
	const billing = await refreshBillingStatus(organizationId) || await getOrganizationBillingState(organizationId);
	if (!billing) return null;
	const plan = getPlan(billing.planId);
	const usage = await getOrganizationUsage(organizationId);
	const assignedSeats = await getAssignedSeatCount(organizationId);
	const storageUsedBytes = await calculateOrganizationStorageBytes(organizationId);
	const collaboratorsAssigned = await getCollaboratorCount(organizationId);

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
	const normalized = {
		id: String(invoice?.id || `inv_${uuidv4()}`),
		organizationId: String(invoice?.organizationId || ''),
		provider: String(invoice?.provider || 'mock'),
		invoiceNumber: invoice?.invoiceNumber ? String(invoice.invoiceNumber) : null,
		amountCents: Number(invoice?.amountCents || 0),
		currency: String(invoice?.currency || 'usd').toLowerCase(),
		status: String(invoice?.status || 'open'),
		periodStart: toIsoOrNull(invoice?.periodStart),
		periodEnd: toIsoOrNull(invoice?.periodEnd),
		issuedAt: toIsoOrNull(invoice?.issuedAt) || nowIso(),
		dueAt: toIsoOrNull(invoice?.dueAt),
		paidAt: toIsoOrNull(invoice?.paidAt),
		hostedUrl: invoice?.hostedUrl ? String(invoice.hostedUrl) : null,
		metadata: invoice?.metadata && typeof invoice.metadata === 'object' && !Array.isArray(invoice.metadata)
			? invoice.metadata
			: null,
	};

	return prisma.invoice.upsert({
		where: { id: normalized.id },
		update: {
			organizationId: normalized.organizationId,
			provider: normalized.provider,
			invoiceNumber: normalized.invoiceNumber,
			amountCents: normalized.amountCents,
			currency: normalized.currency,
			status: normalized.status,
			issuedAt: new Date(normalized.issuedAt),
			dueAt: normalized.dueAt ? new Date(normalized.dueAt) : null,
			paidAt: normalized.paidAt ? new Date(normalized.paidAt) : null,
			metadata: {
				periodStart: normalized.periodStart,
				periodEnd: normalized.periodEnd,
				hostedUrl: normalized.hostedUrl,
				...(normalized.metadata || {}),
			},
		},
		create: {
			id: normalized.id,
			organizationId: normalized.organizationId,
			provider: normalized.provider,
			invoiceNumber: normalized.invoiceNumber,
			amountCents: normalized.amountCents,
			currency: normalized.currency,
			status: normalized.status,
			issuedAt: new Date(normalized.issuedAt),
			dueAt: normalized.dueAt ? new Date(normalized.dueAt) : null,
			paidAt: normalized.paidAt ? new Date(normalized.paidAt) : null,
			metadata: {
				periodStart: normalized.periodStart,
				periodEnd: normalized.periodEnd,
				hostedUrl: normalized.hostedUrl,
				...(normalized.metadata || {}),
			},
		},
	}).then((row) => {
		const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
			? row.metadata
			: {};
		return {
			id: row.id,
			organizationId: row.organizationId,
			provider: row.provider,
			invoiceNumber: row.invoiceNumber || null,
			amountCents: row.amountCents,
			currency: row.currency,
			status: row.status,
			periodStart: toIsoOrNull(metadata.periodStart),
			periodEnd: toIsoOrNull(metadata.periodEnd),
			issuedAt: toIsoOrNull(row.issuedAt),
			dueAt: toIsoOrNull(row.dueAt),
			paidAt: toIsoOrNull(row.paidAt),
			hostedUrl: metadata.hostedUrl ? String(metadata.hostedUrl) : null,
		};
	});
}

function listInvoicesByOrganization(organizationId) {
	return prisma.invoice.findMany({
		where: { organizationId },
		orderBy: { issuedAt: 'desc' },
	}).then((rows) => rows.map((row) => {
		const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
			? row.metadata
			: {};
		return {
			id: row.id,
			organizationId: row.organizationId,
			provider: row.provider,
			invoiceNumber: row.invoiceNumber || null,
			amountCents: row.amountCents,
			currency: row.currency,
			status: row.status,
			periodStart: toIsoOrNull(metadata.periodStart),
			periodEnd: toIsoOrNull(metadata.periodEnd),
			issuedAt: toIsoOrNull(row.issuedAt),
			dueAt: toIsoOrNull(row.dueAt),
			paidAt: toIsoOrNull(row.paidAt),
			hostedUrl: metadata.hostedUrl ? String(metadata.hostedUrl) : null,
		};
	}));
}

async function enqueueWebhookJob(provider, event) {
	const eventId = String(event.id || uuidv4());
	if (!isDatabaseConfigured()) return { skipped: true, reason: 'no-db', eventId };

	const alreadyProcessed = await prisma.processedWebhookEvent.findUnique({ where: { eventId } });
	if (alreadyProcessed) return { skipped: true, reason: 'already-processed', eventId };

	const existingJob = await prisma.webhookJob.findFirst({ where: { eventId } });
	if (existingJob) return { skipped: true, reason: 'already-queued', eventId, job: existingJob };

	const job = await prisma.webhookJob.create({
		data: {
			id: uuidv4(),
			eventId,
			provider,
			type: String(event.type || 'unknown'),
			payload: event,
			status: 'queued',
			attempts: 0,
			maxAttempts: 8,
			nextAttemptAt: new Date(),
		},
	});
	return { skipped: false, eventId, job };
}

async function listWebhookJobs() {
	if (!isDatabaseConfigured()) return [];
	return prisma.webhookJob.findMany({ orderBy: { createdAt: 'asc' } });
}

async function getDueWebhookJobs(limit = 20) {
	if (!isDatabaseConfigured()) return [];
	return prisma.webhookJob.findMany({
		where: {
			status: { in: ['queued', 'failed'] },
			nextAttemptAt: { lte: new Date() },
		},
		orderBy: { nextAttemptAt: 'asc' },
		take: limit,
	});
}

async function markWebhookJobProcessing(jobId) {
	if (!isDatabaseConfigured()) return null;
	return prisma.webhookJob.update({
		where: { id: jobId },
		data: { status: 'processing' },
	});
}

async function markWebhookJobProcessed(jobId) {
	if (!isDatabaseConfigured()) return null;
	const job = await prisma.webhookJob.update({
		where: { id: jobId },
		data: { status: 'processed' },
	});
	await prisma.processedWebhookEvent.upsert({
		where: { eventId: job.eventId },
		update: { processedAt: new Date() },
		create: { eventId: job.eventId, provider: job.provider },
	});
	return job;
}

async function markWebhookJobFailed(jobId, errorMessage) {
	if (!isDatabaseConfigured()) return null;
	const job = await prisma.webhookJob.findUnique({ where: { id: jobId } });
	if (!job) return null;
	const attempts = (job.attempts || 0) + 1;
	const status = attempts >= job.maxAttempts ? 'failed' : 'queued';
	const backoffMs = Math.min(60 * 60 * 1000, Math.pow(2, attempts) * 1000);
	return prisma.webhookJob.update({
		where: { id: jobId },
		data: {
			attempts,
			lastError: String(errorMessage || 'Unknown webhook processing error'),
			status,
			nextAttemptAt: new Date(Date.now() + backoffMs),
		},
	});
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

	const row = await prisma.organization.findUnique({ where: { id: selectedMembership.organizationId } });
	let organization = null;
	if (row) {
		organization = {
			id: row.id,
			name: row.name,
			ownerUserId: row.ownerUserId,
			createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
			updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
			...(row.security && typeof row.security === 'object' && !Array.isArray(row.security) ? { security: row.security } : {}),
		};
	}

	if (!organization) {
		user.currentOrganizationId = null;
		await prisma.user.updateMany({
			where: { email: normalizedEmail },
			data: { currentOrganizationId: null },
		});
		return null;
	}

	await ensureOrganizationBillingState(organization);
	ensureOrganizationSecurityState(organization);
	user.currentOrganizationId = organization.id;
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
	nowIso,
	PLAN_CATALOG,
	TRIAL_DAYS_BY_PLAN,
	getPlan,
	getPlanById,
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
