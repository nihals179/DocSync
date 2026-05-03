/**
 * In-memory store schemas and map instances.
 * Each Map is keyed by entity ID.
 */

/** @type {Map<string, { id: string, name: string, username?: string, email: string, passwordHash: string, createdAt: string, emailVerified: boolean, failedLoginAttempts: number, lockoutUntil: string | null, role?: string, twoFactorEnabled: boolean, twoFactorSecret: string | null, twoFactorTempSecret: string | null }>} */
const users = new Map();

/** @type {Map<string, { id: string, name: string, ownerUserId: string, createdAt: string, updatedAt: string, billing?: Record<string, unknown> }>} */
const organizations = new Map();

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

module.exports = {
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
};
