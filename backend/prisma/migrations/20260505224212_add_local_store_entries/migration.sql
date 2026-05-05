-- CreateTable
CREATE TABLE "public"."local_store_entries" (
    "mapName" TEXT NOT NULL,
    "entryKey" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_store_entries_pkey" PRIMARY KEY ("mapName","entryKey")
);
