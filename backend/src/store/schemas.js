/**
 * In-memory store schemas and map instances.
 * Each Map is keyed by entity ID.
 */

const { createPersistentMap, initializePersistentMaps } = require('./persistence');

/** @type {Map<string, { id: string, name: string, ownerUserId: string, createdAt: string, updatedAt: string, billing?: Record<string, unknown> }>} */
const organizations = createPersistentMap('organizations');

/** @type {Map<string, { id: string, organizationId: string, userId: string, billingAdmin: boolean, status: 'active' | 'removed', createdAt: string, updatedAt: string }>} */
const organizationMemberships = createPersistentMap('organizationMemberships');

/** @type {Map<string, { id: string, token: string, organizationId: string, email: string, billingAdmin: boolean, status: 'pending' | 'accepted' | 'expired' | 'cancelled', invitedByUserId: string, createdAt: string, updatedAt: string, expiresAt: string, acceptedAt: string | null }>} */
const organizationInvites = createPersistentMap('organizationInvites');

/** @type {Map<string, { id: string, userId: string, refreshTokenHash: string, csrfToken: string, createdAt: string, lastUsedAt: string, expiresAt: string, revokedAt: string | null, remember: boolean, userAgent: string, ipAddress: string }>} */
const authSessions = createPersistentMap('authSessions');

/** @type {Map<string, { id: string, organizationId: string, provider: string, status: 'draft' | 'open' | 'paid' | 'failed' | 'void', amountCents: number, currency: string, periodStart: string | null, periodEnd: string | null, issuedAt: string, paidAt: string | null, hostedUrl: string | null }>} */
const invoices = createPersistentMap('invoices');

/** @type {Map<string, { organizationId: string, planId: string, status: string, purchasedSeats: number, trialEndsAt: string | null, trialUsed: boolean, subscriptionId: string | null, customerId: string | null, currentPeriodEndAt: string | null, graceEndsAt: string | null, updatedAt: string }>} */
const organizationBilling = createPersistentMap('organizationBilling');

/** @type {Map<string, { userId: string, email?: string | null, planId: string, status: string, trialEndsAt: string | null, trialUsed: boolean, subscriptionId: string | null, customerId: string | null, currentPeriodEndAt: string | null, graceEndsAt: string | null, updatedAt: string }>} */
const userBilling = createPersistentMap('userBilling');

/** @type {Map<string, { organizationId: string, monthKey: string, aiRequests: number }>} */
const organizationUsage = createPersistentMap('organizationUsage');

/** @type {Map<string, { userId: string, monthKey: string, aiRequests: number, documentUpdates: number }>} */
const userUsage = createPersistentMap('userUsage');

/** @type {Map<string, { id: string, eventId: string, provider: string, type: string, payload: Record<string, unknown>, status: 'queued' | 'processing' | 'processed' | 'failed', attempts: number, maxAttempts: number, nextAttemptAt: string, lastError: string | null, createdAt: string, updatedAt: string }>} */
const webhookJobs = createPersistentMap('webhookJobs');

/** @type {Map<string, { eventId: string, provider: string, processedAt: string }>} */
const processedWebhookEvents = createPersistentMap('processedWebhookEvents');

/** @type {Map<string, { id: string, userId: string, type: 'email-verification' | 'password-reset', expiresAt: string, createdAt: string }>} */
const authTokens = createPersistentMap('authTokens');

/** @type {Map<string, { id: string, userId: string | null, action: string, status: 'success' | 'failure', ipAddress: string, userAgent: string, createdAt: string, metadata?: Record<string, unknown> }>} */
const auditLogs = createPersistentMap('auditLogs');

/** @type {Map<string, { id: string, title: string, content: string, userId: string, createdAt: string, updatedAt: string }>} */
const documents = createPersistentMap('documents');

/** @type {Map<string, { id: string, role: string, canAccessAdminBoard: boolean, canReviewSecurityAudit: boolean, canManageGlobalSettings: boolean, canManageMembers: boolean, canManageMemberBillingAdmin: boolean, canManageOrganizationBilling: boolean, canManageWorkspacesDocuments: boolean, canReadOrganizationResources: boolean, canUseAiGrammarByPlan: boolean, canManageBillingSettings: boolean, canViewInvoicesSubscription: boolean, createdAt: string, updatedAt: string }>} */
const profiles = createPersistentMap('profiles');

/** @type {Map<string, Array<{ id: string, text: string, userId: string, createdAt: string }>>} */
const comments = createPersistentMap('comments');

/** @type {Map<string, Array<{ id: string, preview: string, content: string, savedAt: string }>>} */
const versions = createPersistentMap('versions');

/** @type {Map<string, Array<{ id: string, text: string, done: boolean }>>} */
const todos = createPersistentMap('todos');

/** @type {Map<string, { id: string, name: string, ownerId: string, memberIds: string[], createdAt: string, updatedAt: string }>} */
const workspaces = createPersistentMap('workspaces');

/** @type {Map<string, { id: string, name: string, email: string, passwordHash: string, createdAt: string, accountType?: string, emailVerified?: boolean, failedLoginAttempts?: number, lockoutUntil?: string | null, role?: string, twoFactorEnabled?: boolean, twoFactorSecret?: string | null, twoFactorTempSecret?: string | null, currentOrganizationId?: string | null, lastLoginAt?: string | null }>} */
const users = createPersistentMap('users');

module.exports = {
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
	initializePersistentMaps,
};
