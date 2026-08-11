# DocSync Billing Service

This service runs billing APIs as a separate process from the main backend.

## What it does

- Exposes billing endpoints on its own port (`4010` by default)
- Uses the same database as backend billing tables
- Owns billing domain logic in `src/billing/service.js`

## Setup

1. Install dependencies:

```bash
cd billing-service
npm install
```

2. Create environment file:

```bash
cp .env.example .env
```

3. Set required values in `.env`:

- `BILLING_SERVICE_TOKEN` for internal API auth
- `BILLING_BACKEND_PATH` only if backend is not located at `../backend`
- `DATABASE_URL` if not already available through shared backend env setup

## Run

Development:

```bash
npm run dev
```

Production:

```bash
npm start
```

## Endpoints

- `GET /health`
- `GET /api/billing/plans`
- `GET /api/billing/organizations/:organizationId/current`
- `GET /api/billing/organizations/:organizationId/invoices`
- `POST /api/billing/organizations/:organizationId/checkout`
- `POST /api/billing/organizations/:organizationId/subscription/change`
- `PATCH /api/billing/organizations/:organizationId/seats`
- `GET /api/billing/webhooks/jobs?organizationId=<id>`
- `POST /api/billing/webhooks/provider`

## Authentication

When `BILLING_SERVICE_TOKEN` is set, pass one of:

- Header `x-service-token: <token>`
- Header `Authorization: Bearer <token>`

If `BILLING_SERVICE_TOKEN` is empty, auth is bypassed for local development.
