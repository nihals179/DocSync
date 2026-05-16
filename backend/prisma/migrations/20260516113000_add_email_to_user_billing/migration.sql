ALTER TABLE "user_billing"
ADD COLUMN "email" TEXT;

UPDATE "user_billing" ub
SET "email" = lower(u."email")
FROM "users" u
WHERE u."id" = ub."userId";

CREATE UNIQUE INDEX "user_billing_email_key"
ON "user_billing"("email");
