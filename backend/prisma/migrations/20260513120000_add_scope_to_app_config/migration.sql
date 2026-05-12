-- Add scope to app_config and switch to composite primary key (scope, key).
DO $$
BEGIN
  IF to_regclass('public.app_config') IS NOT NULL THEN
    ALTER TABLE "app_config"
      ADD COLUMN IF NOT EXISTS "scope" TEXT;

    UPDATE "app_config"
    SET "scope" = 'auth'
    WHERE "scope" IS NULL;

    ALTER TABLE "app_config"
      ALTER COLUMN "scope" SET DEFAULT 'auth',
      ALTER COLUMN "scope" SET NOT NULL;

    IF EXISTS (
      SELECT 1
      FROM information_schema.table_constraints tc
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'app_config'
        AND tc.constraint_type = 'PRIMARY KEY'
        AND tc.constraint_name = 'app_config_pkey'
    ) THEN
      ALTER TABLE "app_config" DROP CONSTRAINT "app_config_pkey";
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'app_config_pkey'
        AND conrelid = 'public.app_config'::regclass
    ) THEN
      ALTER TABLE "app_config"
        ADD CONSTRAINT "app_config_pkey" PRIMARY KEY ("scope", "key");
    END IF;
  END IF;
END $$;
