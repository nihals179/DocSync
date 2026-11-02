-- Create the document-module indexes that schema.prisma declares but the database never got.
--
-- documents, comments and versions only had their primary keys, so listing a tenant's
-- documents (WHERE "tenantId" = ? ORDER BY "updatedAt" DESC) and loading or cleaning up a
-- document's comments and versions (WHERE "docId" = ?) scanned the whole table.
-- IF NOT EXISTS keeps this safe on databases where some of them were created by hand.
DROP INDEX IF EXISTS "documents_tenantId_idx";
CREATE INDEX IF NOT EXISTS "documents_tenantId_updatedAt_idx" ON "documents"("tenantId", "updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "documents_userId_idx" ON "documents"("userId");
CREATE INDEX IF NOT EXISTS "comments_docId_idx" ON "comments"("docId");
CREATE INDEX IF NOT EXISTS "versions_docId_idx" ON "versions"("docId");
