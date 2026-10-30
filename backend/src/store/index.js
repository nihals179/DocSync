const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../db/client');
const { PLAN_CATALOG, TRIAL_DAYS_BY_PLAN, refreshPlanCatalogFromDb, mapDbPlanToCatalogRecord } = require('./catalog');
const { nowIso: runtimeNowIso, isDatabaseConfigured: runtimeIsDatabaseConfigured, toIsoOrNull: runtimeToIsoOrNull } = require('../lib/runtime-utils');
const { get } = require('../app');

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

function normalizeTenantUsageRecords(usageRows) {
	if (!Array.isArray(usageRows)) return [];
	return usageRows.map((row) => ({
		tenantId: row.tenantId,
		monthKey: row.monthKey,
		aiRequests: Number(row.aiRequests || 0),
		documentUpdates: Number(row.documentUpdates || 0),
		updatedAt: toIsoOrNull(row.updatedAt),
	}));
}

function normalizeTenantEntitlementSnapshot(input, tenantId, monthKey) {
	return {
		tenantId,
		monthKey,
		aiRequests: Number(input?.aiRequests || 0),
		documentUpdates: Number(input?.documentUpdates || 0),
		assignedSeats: Number(input?.assignedSeats || 0),
		storageUsedBytes:
			typeof input?.storageUsedBytes === 'bigint'
				? Number(input.storageUsedBytes)
				: Number(input?.storageUsedBytes || 0),
		updatedAt: toIsoOrNull(input?.updatedAt) || nowIso(),
	};
}

function isTenantEntitlementsViewMissing(error) {
	if (!error || typeof error !== 'object') return false;
	const prismaCode = error.code;
	const tableName = String(error?.meta?.table || '').toLowerCase();
	const message = String(error.message || '').toLowerCase();
	if (prismaCode === 'P2021' && tableName.includes('tenant_entitlements')) return true;
	return message.includes('tenant_entitlements') && message.includes('does not exist');
}

function normalizeTenantBillingState(input, tenantId) {
	const state = {
		tenantId,
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
		tenant : input?.tenant,
		tenantUsage: normalizeTenantUsageRecords(input?.tenant?.usage),
		planCatalog: input?.planCatalog,
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
	const data = {
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
	};

	const updated = await prisma.userBilling.updateMany({
		where: { email: normalizedEmail },
		data,
	});
	if (updated.count > 0) return;

	try {
		await prisma.userBilling.create({
			data,
		});
	} catch {
		// Another request may create the row concurrently.
		await prisma.userBilling.updateMany({
			where: { email: normalizedEmail },
			data,
		});
	}
}

async function readTenantBillingStateFromDb(tenantId) {
	if (!isDatabaseConfigured()) return null;
	// Load from the tenant side: billing rows can outlive their tenant row, and a required
	// `tenant` include on tenantBilling throws instead of returning null for those.
	const tenantRow = await prisma.tenant.findUnique({
		where: { id: tenantId },
		include: {
			usage: true,
			billing: { include: { planCatalog: true } },
		},
	});
	if (!tenantRow?.billing) return null;
	const { billing, ...tenant } = tenantRow;
	return normalizeTenantBillingState({ ...billing, tenant }, tenantId);
}

async function writeTenantBillingStateToDb(tenantId, state) {
	if (!isDatabaseConfigured() || !tenantId || !state) return;
	const data = {
		planId: state.planId,
		status: state.status,
		purchasedSeats: state.purchasedSeats,
		trialEndsAt: state.trialEndsAt ? new Date(state.trialEndsAt) : null,
		trialUsed: Boolean(state.trialUsed),
		subscriptionId: state.subscriptionId || null,
		customerId: state.customerId || null,
		currentPeriodEndAt: state.currentPeriodEndAt ? new Date(state.currentPeriodEndAt) : null,
		graceEndsAt: state.graceEndsAt ? new Date(state.graceEndsAt) : null,
	};

	const updated = await prisma.tenantBilling.updateMany({
		where: { tenantId },
		data,
	});
	if (updated.count > 0) return;

	try {
		await prisma.tenantBilling.create({
			data: {
				tenantId,
				...data,
			},
		});
	} catch {
		await prisma.tenantBilling.updateMany({
			where: { tenantId },
			data,
		});
	}
}

function mapDbTenantToRecord(row) {
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

async function resolveTenantById(tenantId) {
	if (!tenantId) return null;
	if (!isDatabaseConfigured()) return null;
	const row = await prisma.tenant.findUnique({ where: { id: tenantId } });
	if (!row) return null;
	const tenant = mapDbTenantToRecord(row);
	return tenant;
}

function normalizeUsageState(input, tenantId, monthKey) {
	return {
		tenantId,
		monthKey,
		aiRequests: Number(input?.aiRequests || 0),
		documentUpdates: Number(input?.documentUpdates || 0),
	};
}

async function readTenantUsageFromDb(tenantId, monthKey) {
	if (!isDatabaseConfigured()) return null;
	const row = await prisma.tenantsUsage.findUnique({
		where: {
			tenantId_monthKey: {
				tenantId,
				monthKey,
			},
		},
	});
	if (!row) return null;
	return normalizeUsageState(row, tenantId, monthKey);
}

async function writeTenantUsageToDb(tenantId, monthKey, usage) {
	if (!isDatabaseConfigured() || !tenantId || !monthKey || !usage) return;
	const data = {
		aiRequests: Number(usage.aiRequests || 0),
		documentUpdates: Number(usage.documentUpdates || 0),
	};

	const updated = await prisma.tenantsUsage.updateMany({
		where: { tenantId, monthKey },
		data,
	});
	if (updated.count > 0) return;

	try {
		await prisma.tenantsUsage.create({
			data: {
				tenantId,
				monthKey,
				...data,
			},
		});
	} catch {
		// Another request may create the row concurrently.
		await prisma.tenantsUsage.updateMany({
			where: { tenantId, monthKey },
			data,
		});
	}
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

// The tenant's joined plan_catalog row wins over the cached catalog; both come back in the
// catalog record shape (`plan.limits.*`), so limit checks never read flat `limit*` columns.
function resolveBillingPlan(billing) {
	if (billing?.planCatalog) return mapDbPlanToCatalogRecord(billing.planCatalog);
	return getPlan(billing?.planId);
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
		canManageTenantBilling: Boolean(row.canManageTenantBilling),
		canManageWorkspacesDocuments: Boolean(row.canManageWorkspacesDocuments),
		canReadTenantResources: Boolean(row.canReadTenantResources),
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

function ensureTenantSecurityState(tenant) {
	if (!tenant.security) {
		tenant.security = {
			requireMfa: false,
			sessionDurationHours: 8,
			ipAllowlistEnabled: false,
			ipAllowlist: [],
			domainMappings: [],
			ssoProviders: [],
			updatedAt: nowIso(),
		};
	}

	if (typeof tenant.security.requireMfa !== 'boolean') tenant.security.requireMfa = false;
	if (typeof tenant.security.ipAllowlistEnabled !== 'boolean') tenant.security.ipAllowlistEnabled = false;
	if (!Array.isArray(tenant.security.ipAllowlist)) tenant.security.ipAllowlist = [];
	if (!Array.isArray(tenant.security.domainMappings)) tenant.security.domainMappings = [];
	if (!Array.isArray(tenant.security.ssoProviders)) tenant.security.ssoProviders = [];

	tenant.security.sessionDurationHours = Math.min(
		24,
		Math.max(1, Number(tenant.security.sessionDurationHours || 8)),
	);

	tenant.security.ipAllowlist = tenant.security.ipAllowlist
		.map(normalizeIp)
		.filter(Boolean);
	tenant.security.domainMappings = tenant.security.domainMappings
		.map(normalizeDomain)
		.filter(Boolean);

	if (!tenant.security.updatedAt) tenant.security.updatedAt = nowIso();
	return tenant.security;
}

async function getTenantSecurityState(tenantId) {
	const tenant = await resolveTenantById(tenantId);
	if (!tenant) return null;
	return ensureTenantSecurityState(tenant);
}

async function updateTenantSecurityState(tenantId, updater) {
	const tenant = await resolveTenantById(tenantId);
	if (!tenant) return null;
	const current = ensureTenantSecurityState(tenant);
	const next = typeof updater === 'function' ? updater({ ...current }) : current;
	if (!next) return current;

	tenant.security = {
		...current,
		...next,
		updatedAt: nowIso(),
	};
	ensureTenantSecurityState(tenant);
	await prisma.tenant.update({
		where: { id: tenantId },
		data: { security: tenant.security },
	});
	return tenant.security;
}

async function findTenantByDomain(emailOrDomain) {
	const raw = String(emailOrDomain || '').toLowerCase();
	const domain = raw.includes('@') ? raw.split('@').pop() : raw;
	const normalized = normalizeDomain(domain);
	if (!normalized) return null;

	if (!isDatabaseConfigured()) return null;
	const rows = await prisma.tenant.findMany();
	for (const row of rows) {
		const tenant = mapDbTenantToRecord(row);
		const security = ensureTenantSecurityState(tenant);
		if (security.domainMappings.includes(normalized)) return tenant;
	}
	return null;
}

async function ensureTenantBillingState(tenantId) {
	let billing = null;
	if (isDatabaseConfigured()) {
		billing = await readTenantBillingStateFromDb(tenantId);
	}

	if (!billing) {
		// Never create (or overwrite) billing for a tenant that does not exist.
		if (isDatabaseConfigured() && !await resolveTenantById(tenantId)) return null;
		billing = normalizeTenantBillingState(null, tenantId);
		if (isDatabaseConfigured()) {
			await writeTenantBillingStateToDb(tenantId, billing);
		}
	}
	return billing;
}

async function getTenantBillingState(tenantId) {
	const tenant = await resolveTenantById(tenantId);
	if (!tenant) return null;
	return ensureTenantBillingState(tenantId);
}

async function upsertTenantBillingState(tenantId, updates = {}) {
	const tenant = await resolveTenantById(tenantId);
	if (!tenant) return null;
	const current = await ensureTenantBillingState(tenantId);
	const next = normalizeTenantBillingState({
		...current,
		...updates,
		updatedAt: nowIso(),
	}, tenantId);
	await writeTenantBillingStateToDb(tenantId, next);
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
		const created = normalizeUserBillingState({ planId: 'free', status: 'active', trialUsed: false }, user.id, user.email);
		await writeUserBillingStateToDb(created);
		return created;
	}
	return normalizeUserBillingState({ planId: 'free', status: 'active', trialUsed: false }, user.id, user.email);
}

async function refreshBillingStatus(tenantId) {
	const billing = await ensureTenantBillingState(tenantId);
	if (!billing) return null;
	const nowMs = Date.now();
	let changed = false;

	if ((billing.status === 'active') && billing.trialEndsAt) {
		if (new Date(billing.trialEndsAt).getTime() >= nowMs) {
			billing.status = 'expired';
			billing.updatedAt = nowIso();
			changed = true;
		}
	}


	if ((billing.status === 'past_due' || billing.status === 'grace') && billing.graceEndsAt) {
		if (new Date(billing.graceEndsAt).getTime() >= nowMs) {
			billing.status = 'suspended';
			billing.updatedAt = nowIso();
			changed = true;
		}
	}

	if (billing.status === 'trialing' && billing.trialEndsAt) {
		if (new Date(billing.trialEndsAt).getTime() <= nowMs) {
			billing.status = 'active';
			billing.updatedAt = nowIso();
			changed = true;
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
			changed = true;
		}
	}

	if (changed && isDatabaseConfigured()) {
		await writeTenantBillingStateToDb(tenantId, billing);
	}

	return billing;
}

function isBillingWriteBlocked(billingState) {
	if (!billingState) return false;
	return billingState.status === 'suspended' || billingState.status === 'canceled' || billingState.status === 'expired';
}

async function getTenantUsage(tenantId) {
	const monthKey = monthKeyFromDate(new Date());
	let usage = null;
	if (isDatabaseConfigured()) {
		usage = await readTenantUsageFromDb(tenantId, monthKey);
	}

	if (!usage) {
		usage = normalizeUsageState(null, tenantId, monthKey);
		if (isDatabaseConfigured()) {
			await writeTenantUsageToDb(tenantId, monthKey, usage);
		}
	}
	return usage;
}

async function getTenantUsageMetrics(tenantId) {
	if (!isDatabaseConfigured()) {
		const monthKey = monthKeyFromDate(new Date());
		return {
			usage: normalizeUsageState(null, tenantId, monthKey),
			assignedSeats: 0,
			storageUsedBytes: 0,
		};
	}

	const monthKey = monthKeyFromDate(new Date());
	const results = await prisma.$queryRaw`
		SELECT
			tu."tenantId",
			tu."monthKey",
			tu."aiRequests",
			tu."documentUpdates",
			tu."updatedAt",
			COUNT(DISTINCT tm.id)::int as "assignedSeats",
			COALESCE(SUM(OCTET_LENGTH(d.content)), 0)::bigint AS "storageUsedBytes"
		FROM tenant_usage tu
		LEFT JOIN tenant_memberships tm ON tu."tenantId" = tm."tenantId" AND tm.status = 'active'
		LEFT JOIN documents d ON tu."tenantId" = d."tenantId"
		WHERE tu."tenantId" = ${tenantId} AND tu."monthKey" = ${monthKey}
		GROUP BY tu."tenantId", tu."monthKey", tu."aiRequests", tu."documentUpdates", tu."updatedAt"
	`;

	if (!results || results.length === 0) {
		const emptyUsage = normalizeUsageState(null, tenantId, monthKey);
		await writeTenantUsageToDb(tenantId, monthKey, emptyUsage);
		return {
			usage: emptyUsage,
			assignedSeats: 0,
			storageUsedBytes: 0,
		};
	}

	const row = results[0];
	return {
		usage: normalizeUsageState(row, tenantId, monthKey),
		assignedSeats: Number(row.assignedSeats),
		storageUsedBytes: Number(row.storageUsedBytes),
	};
}

function isWithinPlanAccessDays(tenant, accessDays) {
	if (!tenant) return false;
	if (accessDays === null || accessDays === undefined) return true;
	const parsedDays = Number(accessDays);
	if (!Number.isFinite(parsedDays) || parsedDays <= 0) return false;
	const startAtMs = new Date(tenant.createdAt || nowIso()).getTime();
	const expiresAtMs = startAtMs + parsedDays * 24 * 60 * 60 * 1000;
	return Date.now() <= expiresAtMs;
}

async function countTenantDocuments(tenantId) {
	return prisma.document.count({ where: { tenantId } });
}

async function canCreateDocuments(tenantId, additionalDocuments = 1) {
	const billing = await refreshBillingStatus(tenantId) || await getTenantBillingState(tenantId);
	if (!billing) return { allowed: false, reason: 'Tenant not found.' };
	const plan = resolveBillingPlan(billing);
	const limit = plan.limits.documents;
	const current = await countTenantDocuments(tenantId);
	if (limit === null || limit === undefined) {
		return { allowed: true, current, limit: null };
	}
	const nextTotal = current + Math.max(0, additionalDocuments);
	if (nextTotal > limit) {
		return {
			allowed: false,
			reason: `Document limit reached (${current}/${limit}) for ${plan.name} plan.`,
		};
	}
	return { allowed: true, current, limit };
}

async function canUpdateDocuments(tenantId, additionalUpdates = 1) {
	const billing = await refreshBillingStatus(tenantId) || await getTenantBillingState(tenantId);
	if (!billing) return { allowed: false, reason: 'Tenant not found.' };
	const plan = resolveBillingPlan(billing);
	const limit = plan.limits.documentUpdatesPerMonth;
	const usage = await getTenantUsage(tenantId);
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

// Callers check canUpdateDocuments first. The increment is a single atomic upsert so
// concurrent saves cannot overwrite each other's count (read-modify-write lost updates).
async function consumeDocumentUpdates(tenantId, count = 1) {
	const increment = Math.max(0, count);
	const monthKey = monthKeyFromDate(new Date());
	if (!isDatabaseConfigured() || !increment) return { allowed: true };
	const row = await prisma.tenantsUsage.upsert({
		where: { tenantId_monthKey: { tenantId, monthKey } },
		update: { documentUpdates: { increment } },
		create: { tenantId, monthKey, documentUpdates: increment },
	});
	return { allowed: true, usage: normalizeUsageState(row, tenantId, monthKey) };
}

async function canUseGrammar(tenantId) {
	const tenant = await resolveTenantById(tenantId);
	if (!tenant) return { allowed: false, reason: 'Tenant not found.' };
	const billing = await refreshBillingStatus(tenantId) || await getTenantBillingState(tenantId);
	if (!billing) return { allowed: false, reason: 'Tenant not found.' };
	const plan = getPlan(billing.planId);
	if (isWithinPlanAccessDays(tenant, plan.limits.grammarAccessDays)) {
		return { allowed: true };
	}
	return {
		allowed: false,
		reason: `Grammar checker access expired for ${plan.name} plan.`,
	};
}

async function getAssignedSeatCount(tenantId) {
	if (isDatabaseConfigured()) {
		return prisma.tenantMembership.count({
			where: {
				tenantId,
				status: 'active',
			},
		});
	}
}


async function getCollaboratorCount(tenantId) {
	return getAssignedSeatCount(tenantId);
}

async function canAssignResources(tenantId, additionalSeats = 1, additionalCollaborators = 1) {
	const billing = await refreshBillingStatus(tenantId) || await getTenantBillingState(tenantId);
	if (!billing) return { allowed: false, reason: 'Tenant not found.', seats: null, collaborators: null };

	const assignedSeats = await getAssignedSeatCount(tenantId);
	const nextAssigned = assignedSeats + Math.max(0, additionalSeats);
	const seatsExceeded = nextAssigned > billing.planCatalog.limitSeats;

	const plan = getPlan(billing.planId);
	const currentCollaborators = await getCollaboratorCount(tenantId);
	const nextTotal = currentCollaborators + Math.max(0, additionalCollaborators);
	const collaboratorsExceeded = nextTotal > plan.limits.collaborators;

	const seats = {
		allowed: !seatsExceeded,
		assignedSeats,
		purchasedSeats: billing.purchasedSeats,
		reason: seatsExceeded ? `Seat limit reached (${assignedSeats}/${billing.planCatalog.limitSeats}). Purchase more seats to continue.` : null,
	};

	const collaborators = {
		allowed: !collaboratorsExceeded,
		current: currentCollaborators,
		limit: plan.limits.collaborators,
		reason: collaboratorsExceeded ? `Collaborator limit reached (${currentCollaborators}/${plan.limits.collaborators}) for ${plan.name} plan.` : null,
	};

	return {
		allowed: !seatsExceeded && !collaboratorsExceeded,
		reason: seatsExceeded ? seats.reason : collaboratorsExceeded ? collaborators.reason : null,
		seats,
		collaborators,
	};
}

async function calculateTenantStorageBytes(tenantId) {
	try {
		const rows = await prisma.$queryRaw`
			SELECT COALESCE(SUM(OCTET_LENGTH(content)), 0)::bigint AS total
			FROM documents
			WHERE "tenantId" = ${tenantId}
		`;
		const total = Array.isArray(rows) && rows[0] ? rows[0].total : 0;
		if (typeof total === 'bigint') return Number(total);
		return Number(total || 0);
	} catch {
		const docs = await prisma.document.findMany({
			where: { tenantId },
			select: { content: true },
		});
		return docs.reduce((total, doc) => total + Buffer.byteLength(String(doc.content || ''), 'utf8'), 0);
	}
}

async function canConsumeAiRequests(tenantId, count = 1) {
	const tenant = await resolveTenantById(tenantId);
	if (!tenant) return { allowed: false, reason: 'Tenant not found.' };
	const billing = await refreshBillingStatus(tenantId) || await getTenantBillingState(tenantId);
	if (!billing) return { allowed: false, reason: 'Tenant not found.' };
	if (billing.status === 'suspended') {
		return { allowed: false, reason: 'Subscription suspended due to failed payments.' };
	}
	const plan = getPlan(billing.planId);
	if (!isWithinPlanAccessDays(tenant, plan.limits.aiAccessDays)) {
		return {
			allowed: false,
			reason: `AI assistant access expired for ${plan.name} plan.`,
		};
	}
	const usage = await getTenantUsage(tenantId);
	const nextUsage = usage.aiRequests + Math.max(0, count);
	if (nextUsage > plan.limits.aiRequestsPerMonth) {
		return {
			allowed: false,
			reason: `AI monthly limit reached (${usage.aiRequests}/${plan.limits.aiRequestsPerMonth}) for ${plan.name} plan.`,
		};
	}
	return { allowed: true, usage, limit: plan.limits.aiRequestsPerMonth };
}

async function consumeAiRequests(tenantId, count = 1) {
	const check = await canConsumeAiRequests(tenantId, count);
	if (!check.allowed) return check;
	const usage = await getTenantUsage(tenantId);
	usage.aiRequests += Math.max(0, count);
	if (isDatabaseConfigured()) {
		await writeTenantUsageToDb(tenantId, usage.monthKey, usage);
	}
	return { allowed: true, usage };
}

async function getTenantEntitlements(tenantId) {
	const billing = await refreshBillingStatus(tenantId) || await getTenantBillingState(tenantId);
	if (!billing) return null;
	// Raw Prisma relations are left out of the response; plan_catalog stores limits as flat
	// limit* columns, and limitStorageBytes is a BigInt, which JSON.stringify cannot serialize.
	const { tenant, tenantUsage, planCatalog, ...billingSummary } = billing;
	const plan = planCatalog
		? { ...planCatalog, limitStorageBytes: Number(planCatalog.limitStorageBytes) }
		: getPlan(billing.planId);
	// Limits come from the normalized plan record so they are correct whether or not the
	// billing row has a joined plan_catalog row (the cached catalog has no flat limit* fields).
	const { limits } = resolveBillingPlan(billing);
	const { usage, assignedSeats, storageUsedBytes } = await getTenantUsageMetrics(tenantId);
	const collaboratorsAssigned = assignedSeats;

	return {
		billing: billingSummary,
		plan,
		limits: {
			seatsPurchased: billing.purchasedSeats,
			storageBytes: limits.storageBytes || null,
			aiRequestsPerMonth: limits.aiRequestsPerMonth || null,
			collaborators: limits.collaborators || null,
			documents: limits.documents || null,
			documentUpdatesPerMonth: limits.documentUpdatesPerMonth || null,
			versionHistoryDays: limits.versionHistoryDays || null,
			grammarAccessDays: limits.grammarAccessDays || null,
			aiAccessDays: limits.aiAccessDays || null,
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

async function getVersionHistoryRetentionDays(tenantId) {
	const billing = await refreshBillingStatus(tenantId) || await getTenantBillingState(tenantId);
	if (!billing) return null;
	const plan = getPlan(billing.planId);
	return plan.limits.versionHistoryDays;
}

function upsertInvoice(invoice) {
	const normalized = {
		id: String(invoice?.id || `inv_${uuidv4()}`),
		tenantId: String(invoice?.tenantId || ''),
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
			tenantId: normalized.tenantId,
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
			tenantId: normalized.tenantId,
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
			tenantId: row.tenantId,
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

function listInvoicesByTenant(tenantId) {
	return prisma.invoice.findMany({
		where: { tenantId },
		orderBy: { issuedAt: 'desc' },
	}).then((rows) => rows.map((row) => {
		const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
			? row.metadata
			: {};
		return {
			id: row.id,
			tenantId: row.tenantId,
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
		tenantId: row.tenantId || null,
		createdAt: new Date(row.createdAt).toISOString(),
		updatedAt: new Date(row.updatedAt).toISOString(),
	};
}

async function ensureDefaultTenantForUser(user) {
	if (!user?.id || !isDatabaseConfigured()) return null;

	const tenantId = uuidv4();
	const now = new Date();
	const tenantName = String(user.name || '').trim() ? `${String(user.name).trim()}'s Tenant` : 'Personal Tenant';

	
	await prisma.tenant.create({
		data: {
			id: tenantId,
			name: tenantName,
			ownerUserId: user.id,
			createdAt: now,
			updatedAt: now,
		},
	});

	await prisma.tenantMembership.create({
		data: {
			id: uuidv4(),
			tenantId: tenantId,
			userId: user.id,
			email: String(user.email || '').toLowerCase().trim(),
			billingAdmin: true,
			status: 'active',
			createdAt: now,
			updatedAt: now,
		},
	});

	const tenant = {
		id: tenantId,
		name: tenantName,
		ownerUserId: user.id,
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
	};
	ensureTenantSecurityState(tenant);
	await prisma.tenant.update({
		where: { id: tenantId },
		data: { security: tenant.security },
	});

	await ensureTenantBillingState(tenantId);

	await prisma.user.update({
		where: { id: user.id },
		data: { currentTenantId: tenantId },
	});

	user.currentTenantId = tenantId;
	return tenant;
}

async function syncCurrentTenantFromMembership(user) {
	if (!user) return null;
	if (!isDatabaseConfigured()) return null;

	const normalizedEmail = String(user.email || '').toLowerCase().trim();
	if (!normalizedEmail) return null;
	
	if(user.tenantMemberships){
		return null
	}	

	const activeMemberships = await prisma.tenantMembership.findMany({
		where: {
			AND: [
				{
					OR: [
						{ userId: user.id },
						{ email: normalizedEmail },
					],
				},
				{ status: 'active' },
			],
		},
		orderBy: {
			createdAt: 'asc',
		},
	});

	if (!activeMemberships.length) {
		user.currentTenantId = null;
		await prisma.user.updateMany({
			where: { email: normalizedEmail },
			data: { currentTenantId: null },
		});
		throw new Error(`No active memberships found for user: ${user.id}`);
	}

	const existingCurrent = activeMemberships.find(
		(membership) => membership.tenantId === (user.currentTenantId),
	);
	const selectedMembership = existingCurrent || activeMemberships[0];

	const row = await prisma.tenant.findUnique({ where: { id: selectedMembership.tenantId } });
	let tenant = null;
	
	if (row) {
		tenant = {
			id: row.id,
			name: row.name,
			ownerUserId: row.ownerUserId,
			createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
			updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
			...(row.security && typeof row.security === 'object' && !Array.isArray(row.security) ? { security: row.security } : {}),
		};
	}

	if (!tenant) {
		user.currentTenantId = null;
		await prisma.user.updateMany({
			where: { email: normalizedEmail },
			data: { currentTenantId: null },
		});
		throw new Error(`Tenant not found for membership: ${selectedMembership.id}`);
	}

	await ensureTenantBillingState(tenant.id);
	ensureTenantSecurityState(tenant);
	user.currentTenantId = tenant.id;
	await prisma.user.updateMany({
		where: { email: normalizedEmail },
		data: { currentTenantId: tenant.id },
	});

	return user;
}

async function ensureWorkspaceForUserProvisioned(user) {
	const personalScopeId = user.currentTenantId;
	if (!isDatabaseConfigured()) {
		return null;
	}

	let row = await prisma.workspace.findFirst({
		where: {
			ownerId: user.id,
			tenantId: personalScopeId,
		},
		orderBy: {
			createdAt: 'asc',
		},
	});
	if (!row) {
		row = await prisma.workspace.create({
			data: {
				id: uuidv4(),
				name: `${user.name}'s Workspace`,
				ownerId: user.id,
				memberIds: [user.id],
				tenantId: personalScopeId,
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
		select: { id: true, name: true, currentTenantId: true, email: true },
	});
	if (!dbUser) return null;

	const membershipEmail = dbUser.email;
	const activeMemberships = await prisma.tenantMembership.findMany({
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

		if(!user.currentTenantId){
			await prisma.user.updateMany({
						where: { email: normalizedEmail },
						data: { currentTenantId: activeMemberships[0].tenantId },
					});
			user.currentTenantId = activeMemberships[0].tenantId;
		}
		
		const tenant = await prisma.tenant.findUnique({ where: { id: activeMemberships[0].tenantId } });
		if (!tenant) return null;

		await ensureTenantBillingState(tenant.id);
		const security = ensureTenantSecurityState(tenant);
		await prisma.tenant.updateMany({
			where: { id: tenant.id },
			data: { security },
		});

		user.currentTenantId = tenant.id;
		await prisma.user.updateMany({
			where: { email: normalizedEmail },
			data: { currentTenantId: tenant.id },
		});

		if(activeMemberships[0].userId !== user.id){
			try{
				await prisma.tenantMembership.updateMany({
					where: { id: activeMemberships[0].id },
					data: { userId: user.id },
				});
			}catch(e){
				console.error('Error linking user to tenant membership:', e);
			}
		}
		if(tenant.ownerUserId !== user.id && tenant.ownerEmail === user.email){
			try{
				await prisma.tenant.updateMany({
					where: { ownerEmail: tenant.ownerEmail },
					data: { ownerUserId: user.id },
				});
			}catch(e){
				console.error('Error updating tenant membership email:', e);
			}
		}

		await prisma.document.updateMany({
			where: {
				userId: user.id,
				tenantId: null,
			},
			data: {
				tenantId: tenant.id,
			},
		});

		return tenant;
	}

	return  ensureDefaultTenantForUser(user) ;
}

module.exports = {
	nowIso,
	TRIAL_DAYS_BY_PLAN,
	getPlan,
	getAllPlans,
	getTenantBillingState,
	upsertTenantBillingState,
	ensureUserBillingState,
	getTenantSecurityState,
	findTenantByDomain,
	updateTenantSecurityState,
	refreshBillingStatus,
	isBillingWriteBlocked,
	getTenantEntitlements,
	getTenantUsageMetrics,
	canAssignResources,
	canConsumeAiRequests,
	consumeAiRequests,
	canCreateDocuments,
	canUpdateDocuments,
	consumeDocumentUpdates,
	canUseGrammar,
	getVersionHistoryRetentionDays,
	upsertInvoice,
	listInvoicesByTenant,
	enqueueWebhookJob,
	listWebhookJobs,
	markWebhookJobProcessing,
	markWebhookJobProcessed,
	ensureTenantBootstrapForUser,
	syncCurrentTenantFromMembership,
	ensureWorkspaceForUserProvisioned,
	getProfileTable,
};
