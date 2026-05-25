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

module.exports = {
	users: createNoMemoryMap(),
	organizations: createNoMemoryMap(),
	organizationMemberships: createNoMemoryMap(),
	organizationInvites: createNoMemoryMap(),
	invoices: createNoMemoryMap(),
	organizationBilling: createNoMemoryMap(),
	userBilling: createNoMemoryMap(),
	organizationUsage: createNoMemoryMap(),
	userUsage: createNoMemoryMap(),
	webhookJobs: createNoMemoryMap(),
	processedWebhookEvents: createNoMemoryMap(),
	auditLogs: createNoMemoryMap(),
	authSessions: createNoMemoryMap(),
	authTokens: createNoMemoryMap(),
	documents: createNoMemoryMap(),
	profiles: createNoMemoryMap(),
	comments: createNoMemoryMap(),
	versions: createNoMemoryMap(),
	todos: createNoMemoryMap(),
	workspaces: createNoMemoryMap(),
	initializePersistentMaps,
};
