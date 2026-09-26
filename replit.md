# Undergraduate Hub

Book exchange and physical library management for students in Dhaka, with member borrowing flows and staff operations.

## Run & Operate

- First setup: `pnpm install --frozen-lockfile`, then `pnpm --filter @workspace/db run push` to apply the development schema.
- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/undergraduate-hub run dev` — run the member and staff web app
- `pnpm --filter @workspace/scripts run provision-admin` — provision the initial Supabase administrator once, using server-only environment variables
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required development env: `DATABASE_URL` — Postgres connection string
- Required production auth env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `SESSION_SECRET`
- Required production member OTP env: `SMS_API_BASE_URL`, `SMS_API_KEY`, and `SMS_API_LABEL`
- One-time admin env: `ADMIN_INITIAL_EMAIL` and `ADMIN_INITIAL_PASSWORD`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + TypeScript + Tailwind CSS + shadcn/ui
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/undergraduate-hub` — responsive member and admin app
- `artifacts/api-server/src/routes/library.ts` — library API and seeded development data
- `lib/db/src/schema/library.ts` — source-of-truth database tables
- `lib/api-spec/openapi.yaml` — source-of-truth API contract

## Architecture decisions

- Offline payments are recorded as cash, bKash, or Nagad entries; there is no online payment gateway.
- Development uses the workspace PostgreSQL database and keeps Supabase-compatible variables documented in `.env.example` for hosted production configuration.
- Supabase Auth is the identity source for both member phone OTP and administrator email/password authentication. The API issues only server-side, HttpOnly session cookies after Supabase verification.
- The initial administrator is provisioned through the server-only script. Never commit `.env` files or expose provisioning credentials to the browser. Remove or rotate the provisioning variables after the first successful run.

## Product

Members can browse and search books, request a pickup slot, track due dates and fees, view subscription/deposit status, and receive library notices. Staff can manage inventory, requests, members, offline payments, and analytics.

## User preferences

- Keep Bengali copy formal and use “আপনি”.
- Keep the experience mobile-first, fast, and clear for first-time users.

## Gotchas

- Run API codegen after changing `lib/api-spec/openapi.yaml`.
- Use `pnpm --filter @workspace/db run push` after changing the Drizzle schema.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
