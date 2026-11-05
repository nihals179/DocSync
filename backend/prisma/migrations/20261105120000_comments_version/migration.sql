-- Pin each comment to the version it was written on.
--
-- versionId is the document's newest version when the comment was written. It is null for a
-- draft comment (the document had no versions yet); the document's first commit adopts those.
-- There is no foreign key: pruning or deleting a version must not delete review comments.
--
-- Existing comments are matched by time: each gets the newest version of its document saved
-- at or before the comment. Comments older than every version stay null.
-- IF NOT EXISTS because the shared dev database drifts from these migrations.
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "versionId" TEXT;
CREATE INDEX IF NOT EXISTS "comments_docId_versionId_idx" ON "comments"("docId", "versionId");

UPDATE "comments" AS c
SET "versionId" = (
  SELECT v."id"
  FROM "versions" AS v
  WHERE v."docId" = c."docId" AND v."savedAt" <= c."createdAt"
  ORDER BY v."savedAt" DESC
  LIMIT 1
)
WHERE c."versionId" IS NULL;
