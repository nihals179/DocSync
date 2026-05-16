# Backend Prerequisites

This document lists everything required to run the backend locally or on a Linux/Windows server.

## 1) Required Software

Install the following before starting the backend:

1. Node.js 20+ (recommended LTS)
2. npm 10+
3. PostgreSQL 14+ (16 recommended)
4. Redis 7+

Optional but useful:

1. Prisma CLI (already available through project dependencies)
2. Docker (alternative way to run Redis/PostgreSQL)

## 2) Verify Installations

Run these commands and confirm they return versions:

```bash
node -v
npm -v
psql --version
redis-cli --version
```

Check services are reachable:

```bash
pg_isready -h 127.0.0.1 -p 5432
redis-cli -u redis://127.0.0.1:6379 ping
```

Expected Redis response: `PONG`

## 3) Environment Configuration

Create or update `backend/.env`.

Minimum required settings:

```env
DOCSYNC_ENV="DEV"
DEV.DATABASE_URL="postgresql://docsync@localhost:5432/docsync_prod?schema=public"
DEV.REDIS_URL="redis://localhost:6379"
DATABASE_URL="postgresql://docsync@localhost:5432/docsync_prod?schema=public"
REDIS_URL="redis://localhost:6379"
PGSSLMODE="disable"
```

Notes:

1. `DATABASE_URL` and `REDIS_URL` act as direct fallbacks.
2. `DEV.DATABASE_URL` and `DEV.REDIS_URL` are used when `DOCSYNC_ENV="DEV"`.
3. Keep `DOCSYNC_ENV` in uppercase values: `DEV`, `ITT`, `UAT`, `PROD`.

## 4) Service Startup (Linux/Windows)

Project scripts are available to install missing tools (best effort), start services, and check health:

1. Linux: `backend/scripts/start-services.sh`
2. Windows: `backend/scripts/start-services.bat`

Run Linux script:

```bash
bash backend/scripts/start-services.sh
```

Run Windows script:

```bat
backend\scripts\start-services.bat
```

If you want to skip install attempts and only start/check services:

- Linux:

```bash
INSTALL_MISSING=false bash backend/scripts/start-services.sh
```

- Windows:

```bat
set INSTALL_MISSING=false
backend\scripts\start-services.bat
```

## 5) Project Setup Steps

From the `backend` folder:

```bash
npm install
npm run db:generate
npm run db:deploy
```

Optional seed data:

```bash
npm run db:seed:all
```

## 6) Backend Health Checks

Redis health check (project-level):

```bash
npm run redis:ping
```

Start backend:

```bash
npm run dev:debug
```

Verify backend is listening on port 4000:

```bash
lsof -nP -iTCP:4000 -sTCP:LISTEN
```

## 7) Common Issues

1. `Auth config unavailable from Redis/DB.`
- Ensure PostgreSQL is running and `app_config` has required keys for scope `auth`.
- Ensure Redis is reachable, or at least DB is reachable as fallback.

2. `Redis is not configured or unreachable.`
- Verify `REDIS_URL`/`DEV.REDIS_URL` in `.env`.
- Verify Redis service is running and port 6379 is open.

3. Database connection failures
- Verify `DATABASE_URL`/`DEV.DATABASE_URL`.
- Verify PostgreSQL service is running and user/database exists.
