-- Convert app_config from wide singleton row to key-value rows.
DO $$
BEGIN
  IF to_regclass('public.app_config') IS NULL THEN
    CREATE TABLE "app_config" (
      "key" TEXT NOT NULL,
      "value" JSONB NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "app_config_pkey" PRIMARY KEY ("key")
    );
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'app_config'
      AND column_name = 'id'
  ) THEN
    CREATE TABLE "app_config_kv" (
      "key" TEXT NOT NULL,
      "value" JSONB NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "app_config_kv_pkey" PRIMARY KEY ("key")
    );

    INSERT INTO "app_config_kv" ("key", "value", "updatedAt")
    SELECT 'appName', to_jsonb("appName"), CURRENT_TIMESTAMP FROM "app_config" WHERE "id" = 'default'
    ON CONFLICT ("key") DO NOTHING;

    INSERT INTO "app_config_kv" ("key", "value", "updatedAt")
    SELECT 'devMode', to_jsonb("devMode"), CURRENT_TIMESTAMP FROM "app_config" WHERE "id" = 'default'
    ON CONFLICT ("key") DO NOTHING;

    INSERT INTO "app_config_kv" ("key", "value", "updatedAt")
    SELECT 'emailVerificationBypass', to_jsonb("emailVerificationBypass"), CURRENT_TIMESTAMP FROM "app_config" WHERE "id" = 'default'
    ON CONFLICT ("key") DO NOTHING;

    INSERT INTO "app_config_kv" ("key", "value", "updatedAt")
    SELECT 'emailTokenTtlMs', to_jsonb("emailTokenTtlMs"), CURRENT_TIMESTAMP FROM "app_config" WHERE "id" = 'default'
    ON CONFLICT ("key") DO NOTHING;

    INSERT INTO "app_config_kv" ("key", "value", "updatedAt")
    SELECT 'resetTokenTtlMs', to_jsonb("resetTokenTtlMs"), CURRENT_TIMESTAMP FROM "app_config" WHERE "id" = 'default'
    ON CONFLICT ("key") DO NOTHING;

    INSERT INTO "app_config_kv" ("key", "value", "updatedAt")
    SELECT 'lockoutThreshold', to_jsonb("lockoutThreshold"), CURRENT_TIMESTAMP FROM "app_config" WHERE "id" = 'default'
    ON CONFLICT ("key") DO NOTHING;

    INSERT INTO "app_config_kv" ("key", "value", "updatedAt")
    SELECT 'lockoutMs', to_jsonb("lockoutMs"), CURRENT_TIMESTAMP FROM "app_config" WHERE "id" = 'default'
    ON CONFLICT ("key") DO NOTHING;

    DROP TABLE "app_config";
    ALTER TABLE "app_config_kv" RENAME TO "app_config";
    ALTER INDEX "app_config_kv_pkey" RENAME TO "app_config_pkey";
  END IF;
END $$;

INSERT INTO "app_config" ("key", "value", "updatedAt")
VALUES
  ('appName', to_jsonb('DocSync'::text), CURRENT_TIMESTAMP),
  ('devMode', to_jsonb(true), CURRENT_TIMESTAMP),
  ('emailVerificationBypass', to_jsonb(false), CURRENT_TIMESTAMP),
  ('emailTokenTtlMs', to_jsonb(86400000), CURRENT_TIMESTAMP),
  ('resetTokenTtlMs', to_jsonb(3600000), CURRENT_TIMESTAMP),
  ('lockoutThreshold', to_jsonb(5), CURRENT_TIMESTAMP),
  ('lockoutMs', to_jsonb(1800000), CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
