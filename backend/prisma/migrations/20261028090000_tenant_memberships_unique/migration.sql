-- Prevent duplicate tenant memberships.
--
-- schema.prisma declares @@unique([tenantId, userId]) and @@unique([tenantId, email]) on
-- tenantMembership, but the database never got the primary key or the unique indexes, so
-- concurrent invite accepts inserted the same member twice.

-- 1. Remove duplicate memberships so the unique indexes can be created.
--    Keep one row per group: an 'active' row first, then one linked to a user, then the
--    most recently updated.
DELETE FROM "tenant_memberships"
WHERE ctid IN (
  SELECT ctid FROM (
    SELECT ctid, ROW_NUMBER() OVER (
      PARTITION BY "tenantId", "email"
      ORDER BY ("status" = 'active') DESC, ("userId" IS NOT NULL) DESC, "updatedAt" DESC, "createdAt" DESC
    ) AS rn
    FROM "tenant_memberships"
    WHERE "email" IS NOT NULL
  ) ranked
  WHERE rn > 1
);

DELETE FROM "tenant_memberships"
WHERE ctid IN (
  SELECT ctid FROM (
    SELECT ctid, ROW_NUMBER() OVER (
      PARTITION BY "tenantId", "userId"
      ORDER BY ("status" = 'active') DESC, "updatedAt" DESC, "createdAt" DESC
    ) AS rn
    FROM "tenant_memberships"
    WHERE "userId" IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- 2. Primary key and indexes declared in schema.prisma.
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id");

CREATE UNIQUE INDEX "tenant_memberships_tenantId_userId_key" ON "tenant_memberships"("tenantId", "userId");

CREATE UNIQUE INDEX "tenant_memberships_tenantId_email_key" ON "tenant_memberships"("tenantId", "email");

CREATE INDEX "tenant_memberships_email_idx" ON "tenant_memberships"("email");
