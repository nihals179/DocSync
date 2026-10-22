const { prisma } = require('./client');
const { PLAN_CATALOG } = require('../store/catalog');

function toFeatureFlags(plan) {
  const highlights = (plan.featureHighlights || []).map((item) => String(item || '').toLowerCase());
  const includesAny = (...tokens) => highlights.some((text) => tokens.some((token) => text.includes(token)));

  return {
    featureBasicEditor: includesAny('basic editor'),
    featureAiAssistant: includesAny('ai assistant'),
    featureGrammarChecker: includesAny('grammar checker', 'grammar access'),
    featurePrioritySupport: includesAny('priority support'),
    featureCommunitySupport: includesAny('community support'),
    featureSsoSaml: includesAny('sso', 'saml'),
    featureCustomRolesRbac: includesAny('rbac', 'custom roles'),
    featureAuditLogs: includesAny('audit logs'),
    featureSlaDedicatedSupport: includesAny('sla', 'dedicated support'),
    featureOnPremiseOption: includesAny('on-premise option', 'onprem'),
    featureSelfHostedDeployment: includesAny('self-hosted deployment'),
    featurePrivateNetworkOnly: includesAny('private network only'),
    featureCustomComplianceControls: includesAny('custom compliance controls'),
    featureDedicatedSuccessTeam: includesAny('dedicated success team'),
  };
}

function toLimitFields(plan) {
  const limits = plan.limits || {};
  return {
    limitSeats: Number(limits.seats || 0),
    limitStorageBytes: BigInt(limits.storageBytes || 0),
    limitAiRequestsPerMonth: Number(limits.aiRequestsPerMonth || 0),
    limitCollaborators: Number(limits.collaborators || 0),
    limitDocuments: limits.documents === null || limits.documents === undefined ? null : Number(limits.documents),
    limitDocumentUpdatesPerMonth:
      limits.documentUpdatesPerMonth === null || limits.documentUpdatesPerMonth === undefined
        ? null
        : Number(limits.documentUpdatesPerMonth),
    limitVersionHistoryDays:
      limits.versionHistoryDays === null || limits.versionHistoryDays === undefined
        ? null
        : Number(limits.versionHistoryDays),
    limitGrammarAccessDays:
      limits.grammarAccessDays === null || limits.grammarAccessDays === undefined
        ? null
        : Number(limits.grammarAccessDays),
    limitAiAccessDays:
      limits.aiAccessDays === null || limits.aiAccessDays === undefined
        ? null
        : Number(limits.aiAccessDays),
  };
}

async function seedPlanCatalog() {
  const plans = Object.values(PLAN_CATALOG || {});
  for (const plan of plans) {
    const featureFlags = toFeatureFlags(plan);
    const limitFields = toLimitFields(plan);

    const data = {
      name: plan.name,
      priceMonthlyCents: Number(plan.priceMonthlyCents || 0),
      displayPrice: String(plan.displayPrice || ''),
      ...featureFlags,
      ...limitFields,
    };

    const existing = await prisma.planCatalog.findUnique({
      where: { id: plan.id },
    });

    if (existing) {
      await prisma.planCatalog.update({
        where: { id: plan.id },
        data,
      });
      console.log(`✓ Updated plan: ${plan.name}`);
    } else {
      await prisma.planCatalog.create({
        data: {
          id: plan.id,
          ...data,
        },
      });
      console.log(`✓ Created plan: ${plan.name}`);
    }
  }
  const count = await prisma.planCatalog.count();
  console.log(`\nPlan catalog synced. Total plans: ${count}`);
}

seedPlanCatalog()
  .catch((error) => {
    console.error('Failed to seed plan catalog:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
