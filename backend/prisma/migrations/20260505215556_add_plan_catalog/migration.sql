-- CreateTable
CREATE TABLE "public"."plan_catalog" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceMonthlyCents" INTEGER NOT NULL,
    "displayPrice" TEXT NOT NULL,
    "featureHighlights" JSONB NOT NULL,
    "limits" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_catalog_pkey" PRIMARY KEY ("id")
);
