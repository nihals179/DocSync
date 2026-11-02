-- Restore tenants.security, which was dropped from the database outside of migrations.
--
-- schema.prisma and the init migration both declare "security" JSONB on tenants, and
-- auth reads it on every login (tenant security settings). With the column missing,
-- every prisma.tenant query fails with "The column tenants.security does not exist",
-- so sign-in returns HTTP 500. The column is nullable and the code treats null as
-- "no tenant security overrides".
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "security" JSONB;
