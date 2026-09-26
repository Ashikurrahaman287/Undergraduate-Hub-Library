# Undergraduate Hub

A library membership and book-borrowing web app for undergraduate readers in Dhaka, with member accounts and an operations admin portal.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Authentication production env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `ADMIN_PHONE_NUMBER`, and `SMS_API_KEY`
- Optional email reset/setup env: `ADMIN_INITIAL_EMAIL`, `ADMIN_PASSWORD_RESET_REDIRECT_URL`
- Supabase email OTP delivery is configured in the Supabase Auth SMTP settings. This project uses Yahoo SMTP: `smtp.mail.yahoo.com:587`, sender `undergraduate_hub@yahoo.com`, sender name `Undergraduate Hub`. Store the Yahoo app password only as the Supabase SMTP password/secret.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- Frontend: `artifacts/undergraduate-hub/src`
- API: `artifacts/api-server/src`
- Database schema and migrations: `lib/db/src/schema` and `supabase/migrations`
- Vercel function entrypoint: `api/index.ts`
- Vercel deployment settings: `vercel.json`

## Architecture decisions

- The browser talks to the API under `/api`; the same Express app runs as a Replit service and as a Vercel serverless function.
- Member phone identifiers are normalized to E.164-style `+8801XXXXXXXXX` values before database or Supabase operations.
- Phone OTPs are delivered by the configured SMS provider; email OTPs and password recovery are delivered by Supabase Auth SMTP.

## Product

- Public book browsing and book details
- Member signup/login by Bangladeshi phone or email
- Wishlist, borrow requests, account dashboard, and notifications
- Protected admin operations for inventory, members, payments, requests, and analytics

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
