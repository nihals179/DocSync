-- Baseline for the whole schema, generated from schema.prisma with prisma migrate diff.
-- Replaces the earlier migration history, which was squashed into this file.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "public"."plan_catalog" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceMonthlyCents" INTEGER NOT NULL,
    "displayPrice" TEXT NOT NULL,
    "featureBasicEditor" BOOLEAN NOT NULL DEFAULT false,
    "featureAiAssistant" BOOLEAN NOT NULL DEFAULT false,
    "featureGrammarChecker" BOOLEAN NOT NULL DEFAULT false,
    "featurePrioritySupport" BOOLEAN NOT NULL DEFAULT false,
    "featureCommunitySupport" BOOLEAN NOT NULL DEFAULT false,
    "featureSsoSaml" BOOLEAN NOT NULL DEFAULT false,
    "featureCustomRolesRbac" BOOLEAN NOT NULL DEFAULT false,
    "featureAuditLogs" BOOLEAN NOT NULL DEFAULT false,
    "featureSlaDedicatedSupport" BOOLEAN NOT NULL DEFAULT false,
    "featureOnPremiseOption" BOOLEAN NOT NULL DEFAULT false,
    "featureSelfHostedDeployment" BOOLEAN NOT NULL DEFAULT false,
    "featurePrivateNetworkOnly" BOOLEAN NOT NULL DEFAULT false,
    "featureCustomComplianceControls" BOOLEAN NOT NULL DEFAULT false,
    "featureDedicatedSuccessTeam" BOOLEAN NOT NULL DEFAULT false,
    "limitSeats" INTEGER NOT NULL DEFAULT 0,
    "limitStorageBytes" BIGINT NOT NULL DEFAULT 0,
    "limitAiRequestsPerMonth" INTEGER NOT NULL DEFAULT 0,
    "limitCollaborators" INTEGER NOT NULL DEFAULT 0,
    "limitDocuments" INTEGER,
    "limitDocumentUpdatesPerMonth" INTEGER,
    "limitVersionHistoryDays" INTEGER,
    "limitGrammarAccessDays" INTEGER,
    "limitAiAccessDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountType" TEXT NOT NULL DEFAULT 'individual',
    "isSubscribed" BOOLEAN NOT NULL DEFAULT false,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockoutUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "role" TEXT NOT NULL DEFAULT 'user',
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "twoFactorTempSecret" TEXT,
    "currentTenantId" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "ownerEmail" TEXT,
    "databaseMode" TEXT NOT NULL DEFAULT 'shared',
    "databaseStatus" TEXT NOT NULL DEFAULT 'shared',
    "databaseSecretName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tenant_billing" (
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "purchasedSeats" INTEGER NOT NULL,
    "trialEndsAt" TIMESTAMP(3),
    "trialUsed" BOOLEAN NOT NULL DEFAULT false,
    "subscriptionId" TEXT,
    "customerId" TEXT,
    "currentPeriodEndAt" TIMESTAMP(3),
    "graceEndsAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_billing_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "public"."tenant_memberships" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "billingAdmin" BOOLEAN NOT NULL DEFAULT false,
    "role" TEXT NOT NULL DEFAULT 'user',
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."profiles" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "canAccessAdminBoard" BOOLEAN NOT NULL DEFAULT false,
    "canReviewSecurityAudit" BOOLEAN NOT NULL DEFAULT false,
    "canManageGlobalSettings" BOOLEAN NOT NULL DEFAULT false,
    "canManageMembers" BOOLEAN NOT NULL DEFAULT false,
    "canManageMemberBillingAdmin" BOOLEAN NOT NULL DEFAULT false,
    "canManageTenantBilling" BOOLEAN NOT NULL DEFAULT false,
    "canManageWorkspacesDocuments" BOOLEAN NOT NULL DEFAULT false,
    "canReadTenantResources" BOOLEAN NOT NULL DEFAULT false,
    "canUseAiGrammarByPlan" BOOLEAN NOT NULL DEFAULT false,
    "canManageBillingSettings" BOOLEAN NOT NULL DEFAULT false,
    "canViewInvoicesSubscription" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."templates" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tenant_invites" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "billingAdmin" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "invitedByUserId" TEXT,
    "inviteLink" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "tenant_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."auth_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "remember" BOOLEAN NOT NULL DEFAULT false,
    "userAgent" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "tenantId" TEXT,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "provider" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_billing" (
    "userId" TEXT NOT NULL,
    "email" TEXT,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trialEndsAt" TIMESTAMP(3),
    "trialUsed" BOOLEAN NOT NULL DEFAULT false,
    "subscriptionId" TEXT,
    "customerId" TEXT,
    "currentPeriodEndAt" TIMESTAMP(3),
    "graceEndsAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_billing_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "public"."tenant_usage" (
    "tenantId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "aiRequests" INTEGER NOT NULL DEFAULT 0,
    "documentUpdates" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_usage_pkey" PRIMARY KEY ("tenantId","monthKey")
);

-- CreateTable
CREATE TABLE "public"."user_usage" (
    "userId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "aiRequests" INTEGER NOT NULL DEFAULT 0,
    "documentUpdates" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT,

    CONSTRAINT "user_usage_pkey" PRIMARY KEY ("userId","monthKey")
);

-- CreateTable
CREATE TABLE "public"."webhook_jobs" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."processed_webhook_events" (
    "eventId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_webhook_events_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "public"."auth_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."app_config" (
    "scope" TEXT NOT NULL DEFAULT 'auth',
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_config_pkey" PRIMARY KEY ("scope","key")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "tenantId" TEXT,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'success',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."documents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "workspaceId" TEXT,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "baseVersionId" TEXT,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."comments" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantid" TEXT,
    "versionId" TEXT,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."versions" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "docTitle" TEXT,

    CONSTRAINT "versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."todos" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "tenantId" TEXT,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "todos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "memberIds" JSONB,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tenant_security_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT,
    "requireMfa" BOOLEAN NOT NULL DEFAULT false,
    "allowSignInWithoutSlug" BOOLEAN NOT NULL DEFAULT true,
    "signInAddressUsesSso" BOOLEAN NOT NULL DEFAULT true,
    "sessionDurationHours" INTEGER NOT NULL DEFAULT 8,
    "ipAllowlistEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ipAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "domainMappings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ssoProviders" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_security_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE INDEX "tenant_billing_planId_idx" ON "public"."tenant_billing"("planId");

-- CreateIndex
CREATE INDEX "tenant_memberships_email_idx" ON "public"."tenant_memberships"("email");

-- CreateIndex
CREATE INDEX "tenant_memberships_userId_idx" ON "public"."tenant_memberships"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_memberships_tenantId_userId_key" ON "public"."tenant_memberships"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_memberships_tenantId_email_key" ON "public"."tenant_memberships"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_role_key" ON "public"."profiles"("role");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_invites_token_key" ON "public"."tenant_invites"("token");

-- CreateIndex
CREATE INDEX "auth_sessions_userId_idx" ON "public"."auth_sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_billing_email_key" ON "public"."user_billing"("email");

-- CreateIndex
CREATE INDEX "webhook_jobs_eventId_idx" ON "public"."webhook_jobs"("eventId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "public"."audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_idx" ON "public"."audit_logs"("tenantId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "public"."audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "public"."audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "documents_userId_idx" ON "public"."documents"("userId");

-- CreateIndex
CREATE INDEX "documents_tenantId_updatedAt_idx" ON "public"."documents"("tenantId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "documents_tenantId_workspaceId_parentId_sortOrder_idx" ON "public"."documents"("tenantId", "workspaceId", "parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "comments_docId_idx" ON "public"."comments"("docId");

-- CreateIndex
CREATE INDEX "comments_docId_versionId_idx" ON "public"."comments"("docId", "versionId");

-- CreateIndex
CREATE INDEX "versions_docId_idx" ON "public"."versions"("docId");

-- CreateIndex
CREATE INDEX "todos_workspaceId_idx" ON "public"."todos"("workspaceId");

-- CreateIndex
CREATE INDEX "todos_tenantId_idx" ON "public"."todos"("tenantId");

-- CreateIndex
CREATE INDEX "workspaces_ownerId_updatedAt_idx" ON "public"."workspaces"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "workspaces_tenantId_updatedAt_idx" ON "public"."workspaces"("tenantId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_security_policies_tenantId_key" ON "public"."tenant_security_policies"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_security_policies_slug_key" ON "public"."tenant_security_policies"("slug");

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_currentTenantId_fkey" FOREIGN KEY ("currentTenantId") REFERENCES "public"."tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tenant_billing" ADD CONSTRAINT "tenant_billing_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tenant_billing" ADD CONSTRAINT "tenant_billing_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."plan_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tenant_memberships" ADD CONSTRAINT "tenant_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tenant_invites" ADD CONSTRAINT "tenant_invites_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_billing" ADD CONSTRAINT "user_billing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tenant_usage" ADD CONSTRAINT "tenant_usage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_usage" ADD CONSTRAINT "user_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."documents" ADD CONSTRAINT "documents_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."documents"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tenant_security_policies" ADD CONSTRAINT "tenant_security_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

