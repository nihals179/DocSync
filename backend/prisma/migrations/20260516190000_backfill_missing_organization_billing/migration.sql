INSERT INTO "organization_billing" (
  "organizationId",
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
  o."id" AS "organizationId",
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
FROM "organizations" o
LEFT JOIN "organization_billing" ob ON ob."organizationId" = o."id"
WHERE ob."organizationId" IS NULL;
