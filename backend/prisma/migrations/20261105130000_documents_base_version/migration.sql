-- Record the version each document's content is based on.
--
-- Commit and publish set it to the new (or promoted) version, and restore to the restored one.
-- Comments treat it as the current version, so after a restore that version's comments show
-- as current. No foreign key: if the version is deleted, the newest version is used instead.
--
-- Past restores were never recorded, so existing documents start on their newest version.
-- IF NOT EXISTS because the shared dev database drifts from these migrations.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "baseVersionId" TEXT;

UPDATE "documents" AS d
SET "baseVersionId" = (
  SELECT v."id"
  FROM "versions" AS v
  WHERE v."docId" = d."id"
  ORDER BY v."savedAt" DESC
  LIMIT 1
)
WHERE d."baseVersionId" IS NULL;
