INSERT INTO "tenant_billing" (
  "tenantId",
  "planId",
  "status",
  "purchasedSeats",
  "trialEndsAt",
  "trialUsed",
  "subscriptionId",
  "customerId",
  "currentPeriodEndAt",
  "graceEndsAt",
  "updatedAt"
)
SELECT
  o."id" AS "tenantId",
  'free' AS "planId",
  'active' AS "status",
  1 AS "purchasedSeats",
  NULL AS "trialEndsAt",
  false AS "trialUsed",
  NULL AS "subscriptionId",
  NULL AS "customerId",
  NULL AS "currentPeriodEndAt",
  NULL AS "graceEndsAt",
  CURRENT_TIMESTAMP AS "updatedAt"
FROM "tenants" o
LEFT JOIN "tenant_billing" ob ON ob."tenantId" = o."id"
WHERE ob."tenantId" IS NULL;
