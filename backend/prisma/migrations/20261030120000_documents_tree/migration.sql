-- Store the document tree: a parent document and an order among siblings.
--
-- The sidebar lets users nest chapters and reorder them, but documents had no columns
-- for either, so every drag was silently dropped. parentId points at another document
-- in the same tenant and workspace (enforced by the API); sortOrder orders the children
-- of one parent within a (tenant, workspace) group, and gaps or negative values are fine.
--
-- Existing documents become roots, numbered in today's visible order (newest first).
-- The foreign key is NO ACTION rather than CASCADE: deleting a document removes its
-- subtree together with the subtree's comments and versions in the API, and the
-- database refuses any delete that would leave a child pointing at a missing parent.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "parentId" TEXT;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

UPDATE "documents" AS d
SET "sortOrder" = r.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "tenantId", "workspaceId" ORDER BY "updatedAt" DESC) AS rn
  FROM "documents"
) AS r
WHERE r.id = d.id;

ALTER TABLE "documents" ADD CONSTRAINT "documents_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "documents"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_parentId_not_self"
  CHECK ("parentId" IS NULL OR "parentId" <> "id");

CREATE INDEX IF NOT EXISTS "documents_tenantId_workspaceId_parentId_sortOrder_idx"
  ON "documents"("tenantId", "workspaceId", "parentId", "sortOrder");
