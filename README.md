# KingxTech VTU Server

Node.js/Express API foundation for airtime and data vending, wallet accounting, and provider integrations.

## Current implementation

- PostgreSQL schema for accounts, journal entries/lines, wallet balances, idempotency, VTU products/transactions, webhooks, and audit logs.
- Double-entry journal validation in application code and a deferred database constraint trigger.
- Wallet funding, hold, settlement, and release operations designed to run inside a single database transaction.
- Idempotency acquisition with unique-key protection and lock-token ownership. Processing keys are not automatically stolen based on age.
- Sandbox-only mock funding and mock provider.
- Liveness and database-readiness endpoints.

## Local setup

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` and set a local PostgreSQL `DATABASE_URL`.
3. Keep `APP_ENV=sandbox` and `VTU_PROVIDER_DEFAULT=mock` for local development.
4. Install dependencies with `npm install`.
5. Apply `migrations/001_initial_schema.sql`, then `migrations/002_seed_accounts_and_products.sql` to a disposable local database.
6. Run `npm run build`, `npm test`, then `npm run dev`.

## Health endpoints

- `GET /health/live`: process liveness.
- `GET /health/ready`: database readiness.

## Financial transaction boundary

Every wallet mutation must be invoked inside `db.transaction(async client => ...)`. The journal posting and wallet balance cache update must use the same transaction. Never keep a database transaction or row lock open while waiting for an external VTU provider network call.

For provider requests, persist the transaction and commit the wallet hold before calling the provider. Treat timeouts and ambiguous provider responses as `UNKNOWN`, then reconcile using provider status checks or signed webhooks. Do not release a hold unless the provider has definitively confirmed failure.

## Safety

- Never use mock funding or the mock provider in production.
- Do not commit real credentials or `.env` files.
- Do not apply migrations to hosted staging or production without explicit review and approval.
- No real provider integration, payment gateway integration, customer transaction routes, or production deployment is enabled by this foundation yet.
