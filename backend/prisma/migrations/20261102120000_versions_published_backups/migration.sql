-- Mark published versions so they can serve as backups.
--
-- Commit and Publish used to save identical rows, so nothing told a published version
-- apart. isPublished records it: deleting a document keeps its published versions, and
-- the per-document version cap never prunes them. docTitle holds the document's title
-- (captured at publish time and refreshed when the document is deleted), so a backup
-- whose document is gone can still be identified.
--
-- Existing versions become unpublished; there is no way to tell which were published.
-- IF NOT EXISTS because the shared dev database already has these columns.
ALTER TABLE "versions" ADD COLUMN IF NOT EXISTS "isPublished" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "versions" ADD COLUMN IF NOT EXISTS "docTitle" TEXT;
