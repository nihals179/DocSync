const { prisma } = require('../db/client');
const { isDatabaseConfigured } = require('../lib/runtime-utils');

const DEFAULT_PLAN_CATALOG = {
  free: {
    id: 'free',
    name: 'Free',
    priceMonthlyCents: 0,
    displayPrice: '$0',
    features: {
      basicEditor: true,
      aiAssistant: false,
      grammarChecker: false,
      prioritySupport: false,
      communitySupport: true,
      ssoSaml: false,
      customRolesRbac: false,
      auditLogs: false,
      slaDedicatedSupport: false,
      onPremiseOption: false,
      selfHostedDeployment: false,
      privateNetworkOnly: false,
      customComplianceControls: false,
      dedicatedSuccessTeam: false,
    },
    limits: {
      seats: 1,
      storageBytes: 2147483648,
      aiRequestsPerMonth: 50,
      collaborators: 1,
      documents: 25,
      documentUpdatesPerMonth: 100,
      versionHistoryDays: 7,
      grammarAccessDays: null,
      aiAccessDays: null,
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceMonthlyCents: 1900,
    displayPrice: '$19',
    features: {
      basicEditor: true,
      aiAssistant: true,
      grammarChecker: true,
      prioritySupport: true,
      communitySupport: true,
      ssoSaml: false,
      customRolesRbac: false,
      auditLogs: false,
      slaDedicatedSupport: false,
      onPremiseOption: false,
      selfHostedDeployment: false,
      privateNetworkOnly: false,
      customComplianceControls: false,
      dedicatedSuccessTeam: false,
    },
    limits: {
      seats: 10,
      storageBytes: 107374182400,
      aiRequestsPerMonth: 5000,
      collaborators: 50,
      documents: null,
      documentUpdatesPerMonth: null,
      versionHistoryDays: 365,
      grammarAccessDays: null,
      aiAccessDays: null,
    },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    priceMonthlyCents: 9900,
    displayPrice: '$99',
    features: {
      basicEditor: true,
      aiAssistant: true,
      grammarChecker: true,
      prioritySupport: true,
      communitySupport: true,
      ssoSaml: true,
      customRolesRbac: true,
      auditLogs: true,
      slaDedicatedSupport: true,
      onPremiseOption: false,
      selfHostedDeployment: false,
      privateNetworkOnly: false,
      customComplianceControls: true,
      dedicatedSuccessTeam: true,
    },
    limits: {
      seats: 100,
      storageBytes: 1099511627776,
      aiRequestsPerMonth: 100000,
      collaborators: 500,
      documents: null,
      documentUpdatesPerMonth: null,
      versionHistoryDays: null,
      grammarAccessDays: null,
      aiAccessDays: null,
    },
  },
  onprem: {
    id: 'onprem',
    name: 'On-Prem',
    priceMonthlyCents: 0,
    displayPrice: 'Custom',
    features: {
      basicEditor: true,
      aiAssistant: true,
      grammarChecker: true,
      prioritySupport: true,
      communitySupport: false,
      ssoSaml: true,
      customRolesRbac: true,
      auditLogs: true,
      slaDedicatedSupport: true,
      onPremiseOption: true,
      selfHostedDeployment: true,
      privateNetworkOnly: true,
      customComplianceControls: true,
      dedicatedSuccessTeam: true,
    },
    limits: {
      seats: 1000,
      storageBytes: 10995116277760,
      aiRequestsPerMonth: 1000000,
      collaborators: 5000,
      documents: null,
      documentUpdatesPerMonth: null,
      versionHistoryDays: null,
      grammarAccessDays: null,
      aiAccessDays: null,
    },
  },
};

const PLAN_CATALOG = JSON.parse(JSON.stringify(DEFAULT_PLAN_CATALOG));

const TRIAL_DAYS_BY_PLAN = {
  free: 0,
  starter: 7,
  pro: 14,
  team: 14,
  enterprise: 30,
};

let lastRefreshAtMs = 0;
let refreshInFlight = null;
const PLAN_CATALOG_REFRESH_MS = 60 * 1000;

function toNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function mapDbPlanToCatalogRecord(row) {
  return {
    id: row.id,
    name: row.name,
    priceMonthlyCents: Number(row.priceMonthlyCents || 0),
    displayPrice: row.displayPrice,
    features: {
      basicEditor: Boolean(row.featureBasicEditor),
      aiAssistant: Boolean(row.featureAiAssistant),
      grammarChecker: Boolean(row.featureGrammarChecker),
      prioritySupport: Boolean(row.featurePrioritySupport),
      communitySupport: Boolean(row.featureCommunitySupport),
      ssoSaml: Boolean(row.featureSsoSaml),
      customRolesRbac: Boolean(row.featureCustomRolesRbac),
      auditLogs: Boolean(row.featureAuditLogs),
      slaDedicatedSupport: Boolean(row.featureSlaDedicatedSupport),
      onPremiseOption: Boolean(row.featureOnPremiseOption),
      selfHostedDeployment: Boolean(row.featureSelfHostedDeployment),
      privateNetworkOnly: Boolean(row.featurePrivateNetworkOnly),
      customComplianceControls: Boolean(row.featureCustomComplianceControls),
      dedicatedSuccessTeam: Boolean(row.featureDedicatedSuccessTeam),
    },
    limits: {
      seats: Number(row.limitSeats || 0),
      storageBytes: Number(row.limitStorageBytes || 0),
      aiRequestsPerMonth: Number(row.limitAiRequestsPerMonth || 0),
      collaborators: Number(row.limitCollaborators || 0),
      documents: toNumberOrNull(row.limitDocuments),
      documentUpdatesPerMonth: toNumberOrNull(row.limitDocumentUpdatesPerMonth),
      versionHistoryDays: toNumberOrNull(row.limitVersionHistoryDays),
      grammarAccessDays: toNumberOrNull(row.limitGrammarAccessDays),
      aiAccessDays: toNumberOrNull(row.limitAiAccessDays),
    },
  };
}

function replaceCatalogRecords(plans) {
  const next = JSON.parse(JSON.stringify(DEFAULT_PLAN_CATALOG));
  for (const plan of plans) {
    next[plan.id] = plan;
  }

  for (const key of Object.keys(PLAN_CATALOG)) {
    delete PLAN_CATALOG[key];
  }

  for (const [id, plan] of Object.entries(next)) {
    PLAN_CATALOG[id] = plan;
  }
}

async function refreshPlanCatalogFromDb({ force = false } = {}) {
  if (!isDatabaseConfigured()) return PLAN_CATALOG;

  const now = Date.now();
  if (!force && now - lastRefreshAtMs < PLAN_CATALOG_REFRESH_MS) {
    return PLAN_CATALOG;
  }

  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = prisma.planCatalog
    .findMany({ orderBy: { createdAt: 'asc' } })
    .then((rows) => {
      if (rows.length) {
        replaceCatalogRecords(rows.map(mapDbPlanToCatalogRecord));
      }
      lastRefreshAtMs = Date.now();
      return PLAN_CATALOG;
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

void refreshPlanCatalogFromDb({ force: true }).catch(() => {});

module.exports = {
  PLAN_CATALOG,
  TRIAL_DAYS_BY_PLAN,
  mapDbPlanToCatalogRecord,
  refreshPlanCatalogFromDb,
};
