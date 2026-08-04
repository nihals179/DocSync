'use strict';

const {
  auditLogs,
  authSessions,
  authTokens,
  comments,
  documents,
  invoices,
  organizationUsage,
  organizationInvites,
  organizationMemberships,
  organizations,
  processedWebhookEvents,
  todos,
  users,
  versions,
  webhookJobs,
  workspaces,
} = require('../../src/store');

function clearInMemoryState() {
  auditLogs.clear();
  authSessions.clear();
  authTokens.clear();
  comments.clear();
  documents.clear();
  invoices.clear();
  organizationUsage.clear();
  organizationInvites.clear();
  organizationMemberships.clear();
  organizations.clear();
  processedWebhookEvents.clear();
  todos.clear();
  users.clear();
  versions.clear();
  webhookJobs.clear();
  workspaces.clear();
}

async function resetTestState() {
  clearInMemoryState();
}

module.exports = {
  resetTestState,
};
