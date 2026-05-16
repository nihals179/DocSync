ALTER TABLE "organization_memberships"
ADD COLUMN "email" TEXT;

UPDATE "organization_memberships" AS om
SET "email" = LOWER(u."email")
FROM "users" AS u
WHERE om."userId" = u."id"
  AND om."email" IS NULL;

CREATE INDEX IF NOT EXISTS "organization_memberships_email_idx"
ON "organization_memberships" ("email");

CREATE UNIQUE INDEX IF NOT EXISTS "organization_memberships_organizationId_email_key"
ON "organization_memberships" ("organizationId", "email");
