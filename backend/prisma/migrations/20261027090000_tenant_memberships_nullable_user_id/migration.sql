-- Allow tenant memberships for invited emails that have no DocSync account yet.
--
-- schema.prisma already declares tenantMembership.userId as optional (String?),
-- but the database column was never changed and is still NOT NULL. Accepting an
-- invite for an email without an account therefore fails with
-- "Null constraint violation on the fields: (userId)".
ALTER TABLE "tenant_memberships" ALTER COLUMN "userId" DROP NOT NULL;
