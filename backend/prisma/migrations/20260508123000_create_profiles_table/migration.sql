-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "activities" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_role_key" ON "public"."profiles"("role");

INSERT INTO "public"."profiles" ("id", "role", "activities", "createdAt", "updatedAt")
VALUES
    (
        'profile-platform-admin',
        'platform_admin',
        '["Access platform admin board", "Review system-level audit and security controls", "Manage global operational settings"]'::jsonb,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'profile-tenant-owner',
        'tenant_owner',
        '["Invite and remove tenant members", "Manage member billing admin status", "Manage tenant billing and entitlements", "Create, edit, and delete workspaces and documents"]'::jsonb,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'profile-tenant-member',
        'tenant_member',
        '["Read tenant resources", "Create, edit, and delete workspaces and documents", "Use AI and grammar features allowed by plan"]'::jsonb,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'profile-billing-admin',
        'billing_admin',
        '["Manage tenant billing settings", "View invoices and subscription status"]'::jsonb,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    )
ON CONFLICT ("role") DO NOTHING;
