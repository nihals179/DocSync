ALTER TABLE "public"."profiles"
ADD COLUMN IF NOT EXISTS "canAccessAdminBoard" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "canReviewSecurityAudit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "canManageGlobalSettings" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "canManageMembers" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "canManageMemberBillingAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "canManageTenantBilling" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "canManageWorkspacesDocuments" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "canReadTenantResources" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "canUseAiGrammarByPlan" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "canManageBillingSettings" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "canViewInvoicesSubscription" BOOLEAN NOT NULL DEFAULT false;

UPDATE "public"."profiles"
SET
  "canAccessAdminBoard" = CASE WHEN "role" = 'platform_admin' THEN true ELSE "canAccessAdminBoard" END,
  "canReviewSecurityAudit" = CASE WHEN "role" = 'platform_admin' THEN true ELSE "canReviewSecurityAudit" END,
  "canManageGlobalSettings" = CASE WHEN "role" = 'platform_admin' THEN true ELSE "canManageGlobalSettings" END,
  "canManageMembers" = CASE WHEN "role" = 'tenant_owner' THEN true ELSE "canManageMembers" END,
  "canManageMemberBillingAdmin" = CASE WHEN "role" = 'tenant_owner' THEN true ELSE "canManageMemberBillingAdmin" END,
  "canManageTenantBilling" = CASE WHEN "role" IN ('tenant_owner', 'billing_admin') THEN true ELSE "canManageTenantBilling" END,
  "canManageWorkspacesDocuments" = CASE WHEN "role" IN ('tenant_owner', 'tenant_member') THEN true ELSE "canManageWorkspacesDocuments" END,
  "canReadTenantResources" = CASE WHEN "role" IN ('platform_admin', 'tenant_owner', 'tenant_member', 'billing_admin') THEN true ELSE "canReadTenantResources" END,
  "canUseAiGrammarByPlan" = CASE WHEN "role" IN ('platform_admin', 'tenant_owner', 'tenant_member') THEN true ELSE "canUseAiGrammarByPlan" END,
  "canManageBillingSettings" = CASE WHEN "role" IN ('tenant_owner', 'billing_admin') THEN true ELSE "canManageBillingSettings" END,
  "canViewInvoicesSubscription" = CASE WHEN "role" IN ('platform_admin', 'tenant_owner', 'billing_admin') THEN true ELSE "canViewInvoicesSubscription" END;

ALTER TABLE "public"."profiles"
DROP COLUMN IF EXISTS "activities";
