-- Create singleton auth runtime configuration table.
CREATE TABLE "auth_config" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "appName" TEXT NOT NULL DEFAULT 'DocSync',
  "devMode" BOOLEAN NOT NULL DEFAULT true,
  "emailVerificationBypass" BOOLEAN NOT NULL DEFAULT false,
  "emailTokenTtlMs" INTEGER NOT NULL DEFAULT 86400000,
  "resetTokenTtlMs" INTEGER NOT NULL DEFAULT 3600000,
  "lockoutThreshold" INTEGER NOT NULL DEFAULT 5,
  "lockoutMs" INTEGER NOT NULL DEFAULT 1800000,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auth_config_pkey" PRIMARY KEY ("id")
);

INSERT INTO "auth_config" (
  "id",
  "appName",
  "devMode",
  "emailVerificationBypass",
  "emailTokenTtlMs",
  "resetTokenTtlMs",
  "lockoutThreshold",
  "lockoutMs",
  "updatedAt"
)
VALUES (
  'default',
  'DocSync',
  true,
  false,
  86400000,
  3600000,
  5,
  1800000,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
