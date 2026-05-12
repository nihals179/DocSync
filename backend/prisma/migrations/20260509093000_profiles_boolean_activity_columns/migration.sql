ALTER TABLE "public"."profiles"
ADD COLUMN IF NOT EXISTS "canAccessAdminBoard" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "canReviewSecurityAudit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "canManageGlobalSettings" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "canManageMembers" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "canManageMemberBillingAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "canManageOrganizationBilling" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "canManageWorkspacesDocuments" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "canReadOrganizationResources" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "canUseAiGrammarByPlan" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "canManageBillingSettings" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "canViewInvoicesSubscription" BOOLEAN NOT NULL DEFAULT false;

UPDATE "public"."profiles"
SET
  "canAccessAdminBoard" = CASE WHEN "role" = 'platform_admin' THEN true ELSE "canAccessAdminBoard" END,
  "canReviewSecurityAudit" = CASE WHEN "role" = 'platform_admin' THEN true ELSE "canReviewSecurityAudit" END,
  "canManageGlobalSettings" = CASE WHEN "role" = 'platform_admin' THEN true ELSE "canManageGlobalSettings" END,
  "canManageMembers" = CASE WHEN "role" = 'organization_owner' THEN true ELSE "canManageMembers" END,
  "canManageMemberBillingAdmin" = CASE WHEN "role" = 'organization_owner' THEN true ELSE "canManageMemberBillingAdmin" END,
  "canManageOrganizationBilling" = CASE WHEN "role" IN ('organization_owner', 'billing_admin') THEN true ELSE "canManageOrganizationBilling" END,
  "canManageWorkspacesDocuments" = CASE WHEN "role" IN ('organization_owner', 'organization_member') THEN true ELSE "canManageWorkspacesDocuments" END,
  "canReadOrganizationResources" = CASE WHEN "role" IN ('platform_admin', 'organization_owner', 'organization_member', 'billing_admin') THEN true ELSE "canReadOrganizationResources" END,
  "canUseAiGrammarByPlan" = CASE WHEN "role" IN ('platform_admin', 'organization_owner', 'organization_member') THEN true ELSE "canUseAiGrammarByPlan" END,
  "canManageBillingSettings" = CASE WHEN "role" IN ('organization_owner', 'billing_admin') THEN true ELSE "canManageBillingSettings" END,
  "canViewInvoicesSubscription" = CASE WHEN "role" IN ('platform_admin', 'organization_owner', 'billing_admin') THEN true ELSE "canViewInvoicesSubscription" END;

ALTER TABLE "public"."profiles"
DROP COLUMN IF EXISTS "activities";
