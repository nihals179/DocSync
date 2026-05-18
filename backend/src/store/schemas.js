/**
 * In-memory store schemas and map instances.
 * Each Map is keyed by entity ID.
 */

const { initializePersistentMaps } = require('./persistence');

class NoMemoryMap extends Map {
	set(key, value) {
		return this;
	}

	delete(key) {
		return false;
	}

	clear() {}
}

function createNoMemoryMap() {
	return new NoMemoryMap();
}

/** @type {Map<string, { id: string, name: string, ownerUserId: string, createdAt: string, updatedAt: string, billing?: Record<string, unknown> }>} */
const organizations = createNoMemoryMap();

/** @type {Map<string, { id: string, organizationId: string, userId: string, billingAdmin: boolean, status: 'active' | 'removed', createdAt: string, updatedAt: string }>} */
const organizationMemberships = createNoMemoryMap();

/** @type {Map<string, { id: string, token: string, organizationId: string, email: string, billingAdmin: boolean, status: 'pending' | 'accepted' | 'expired' | 'cancelled', invitedByUserId: string, createdAt: string, updatedAt: string, expiresAt: string, acceptedAt: string | null }>} */
const organizationInvites = createNoMemoryMap();

/** @type {Map<string, { id: string, organizationId: string, provider: string, status: 'draft' | 'open' | 'paid' | 'failed' | 'void', amountCents: number, currency: string, periodStart: string | null, periodEnd: string | null, issuedAt: string, paidAt: string | null, hostedUrl: string | null }>} */
const invoices = createNoMemoryMap();

/** @type {Map<string, { organizationId: string, planId: string, status: string, purchasedSeats: number, trialEndsAt: string | null, trialUsed: boolean, subscriptionId: string | null, customerId: string | null, currentPeriodEndAt: string | null, graceEndsAt: string | null, updatedAt: string }>} */
const organizationBilling = createNoMemoryMap();

/** @type {Map<string, { userId: string, email?: string | null, planId: string, status: string, trialEndsAt: string | null, trialUsed: boolean, subscriptionId: string | null, customerId: string | null, currentPeriodEndAt: string | null, graceEndsAt: string | null, updatedAt: string }>} */
const userBilling = createNoMemoryMap();

/** @type {Map<string, { organizationId: string, monthKey: string, aiRequests: number }>} */
const organizationUsage = createNoMemoryMap();

/** @type {Map<string, { userId: string, monthKey: string, aiRequests: number, documentUpdates: number }>} */
const userUsage = createNoMemoryMap();

/** @type {Map<string, { id: string, eventId: string, provider: string, type: string, payload: Record<string, unknown>, status: 'queued' | 'processing' | 'processed' | 'failed', attempts: number, maxAttempts: number, nextAttemptAt: string, lastError: string | null, createdAt: string, updatedAt: string }>} */
const webhookJobs = createNoMemoryMap();

/** @type {Map<string, { eventId: string, provider: string, processedAt: string }>} */
const processedWebhookEvents = createNoMemoryMap();

/** @type {Map<string, { id: string, userId: string | null, action: string, status: 'success' | 'failure', ipAddress: string, userAgent: string, createdAt: string, metadata?: Record<string, unknown> }>} */
const auditLogs = createNoMemoryMap();

/** @type {Map<string, { id: string, title: string, content: string, userId: string, createdAt: string, updatedAt: string }>} */
const documents = createNoMemoryMap();

/** @type {Map<string, { id: string, role: string, canAccessAdminBoard: boolean, canReviewSecurityAudit: boolean, canManageGlobalSettings: boolean, canManageMembers: boolean, canManageMemberBillingAdmin: boolean, canManageOrganizationBilling: boolean, canManageWorkspacesDocuments: boolean, canReadOrganizationResources: boolean, canUseAiGrammarByPlan: boolean, canManageBillingSettings: boolean, canViewInvoicesSubscription: boolean, createdAt: string, updatedAt: string }>} */
const profiles = createNoMemoryMap();

/** @type {Map<string, Array<{ id: string, text: string, userId: string, createdAt: string }>>} */
const comments = createNoMemoryMap();

/** @type {Map<string, Array<{ id: string, preview: string, content: string, savedAt: string }>>} */
const versions = createNoMemoryMap();

/** @type {Map<string, Array<{ id: string, text: string, done: boolean }>>} */
const todos = createNoMemoryMap();

/** @type {Map<string, { id: string, name: string, ownerId: string, memberIds: string[], createdAt: string, updatedAt: string }>} */
const workspaces = createNoMemoryMap();

/** @type {Map<string, { id: string, name: string, email: string, passwordHash: string, createdAt: string, accountType?: string, emailVerified?: boolean, failedLoginAttempts?: number, lockoutUntil?: string | null, role?: string, twoFactorEnabled?: boolean, twoFactorSecret?: string | null, twoFactorTempSecret?: string | null, currentOrganizationId?: string | null, lastLoginAt?: string | null }>} */
const users = createNoMemoryMap();

module.exports = {
	users,
	organizations,
	organizationMemberships,
	organizationInvites,
	invoices,
	organizationBilling,
	userBilling,
	organizationUsage,
	userUsage,
	webhookJobs,
	processedWebhookEvents,
	auditLogs,
	documents,
	profiles,
	comments,
	versions,
	todos,
	workspaces,
	initializePersistentMaps,
};
