# PostgreSQL Setup and Migration

This backend now includes Prisma schema and migrations for PostgreSQL.

## 1. Configure environment

Create a local `.env` file in `backend` with:

DATABASE_URL="postgresql://docsync@localhost:5432/docsync_dev?schema=public"
PGSSLMODE="disable"

A template is available in `.env.example`.

## 2. Generate Prisma client

npm run db:generate

## 3. Run migrations (development)

npm run db:migrate -- --name init_postgres

## 4. Apply migrations (deploy/prod)

npm run db:deploy

## 5. Open DB inspector UI

npm run db:studio

## 5a. Seed test users with varied states

npm run db:seed:test-users

This creates/reuses multiple individual users for testing scenarios:

- Free verified user
- Pro verified user
- Unverified user
- Locked user
- Suspended-billing user

## 5b. Seed admin and all baseline data

npm run db:seed:admin
npm run db:seed:all

`db:seed:all` runs admin + plan catalog + test users.

## 6. Query from terminal

psql postgresql://docsync@localhost:5432/docsync_dev

Example SQL checks:

SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM user_billing;
SELECT email, "emailVerified", "failedLoginAttempts", "lockoutUntil" FROM users WHERE email LIKE 'test.%@docsync.local' ORDER BY email;

## Notes

- Current code still reads/writes in-memory store maps.
- Prisma schema and migrations are now in place for progressive migration of store functions to database-backed queries.
- Startup auto-seeding has been removed. Seeding is now DB-command driven via npm scripts.
