CREATE TABLE IF NOT EXISTS "organization_billing" (
  "organizationId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "purchasedSeats" INTEGER NOT NULL,
  "trialEndsAt" TIMESTAMP(3),
  "trialUsed" BOOLEAN NOT NULL DEFAULT false,
  "subscriptionId" TEXT,
  "customerId" TEXT,
  "currentPeriodEndAt" TIMESTAMP(3),
  "graceEndsAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_billing_pkey" PRIMARY KEY ("organizationId")
);

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
  COALESCE(NULLIF(o."billing"->>'planId', ''), 'free') AS "planId",
  COALESCE(NULLIF(o."billing"->>'status', ''), 'active') AS "status",
  COALESCE(NULLIF(o."billing"->>'purchasedSeats', '')::INTEGER, 1) AS "purchasedSeats",
  CASE
    WHEN NULLIF(o."billing"->>'trialEndsAt', '') IS NULL THEN NULL
    ELSE (o."billing"->>'trialEndsAt')::TIMESTAMP(3)
  END AS "trialEndsAt",
  COALESCE(NULLIF(o."billing"->>'trialUsed', '')::BOOLEAN, false) AS "trialUsed",
  NULLIF(o."billing"->>'subscriptionId', '') AS "subscriptionId",
  NULLIF(o."billing"->>'customerId', '') AS "customerId",
  CASE
    WHEN NULLIF(o."billing"->>'currentPeriodEndAt', '') IS NULL THEN NULL
    ELSE (o."billing"->>'currentPeriodEndAt')::TIMESTAMP(3)
  END AS "currentPeriodEndAt",
  CASE
    WHEN NULLIF(o."billing"->>'graceEndsAt', '') IS NULL THEN NULL
    ELSE (o."billing"->>'graceEndsAt')::TIMESTAMP(3)
  END AS "graceEndsAt",
  CASE
    WHEN NULLIF(o."billing"->>'updatedAt', '') IS NULL THEN CURRENT_TIMESTAMP
    ELSE (o."billing"->>'updatedAt')::TIMESTAMP(3)
  END AS "updatedAt"
FROM "organizations" o
WHERE o."billing" IS NOT NULL
  AND jsonb_typeof(o."billing") = 'object'
ON CONFLICT ("organizationId") DO UPDATE
SET
  "planId" = EXCLUDED."planId",
  "status" = EXCLUDED."status",
  "purchasedSeats" = EXCLUDED."purchasedSeats",
  "trialEndsAt" = EXCLUDED."trialEndsAt",
  "trialUsed" = EXCLUDED."trialUsed",
  "subscriptionId" = EXCLUDED."subscriptionId",
  "customerId" = EXCLUDED."customerId",
  "currentPeriodEndAt" = EXCLUDED."currentPeriodEndAt",
  "graceEndsAt" = EXCLUDED."graceEndsAt",
  "updatedAt" = EXCLUDED."updatedAt";

ALTER TABLE "organizations"
DROP COLUMN IF EXISTS "billing";
