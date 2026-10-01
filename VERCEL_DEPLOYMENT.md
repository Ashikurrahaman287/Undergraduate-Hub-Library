# Deploying Undergraduate Hub to Vercel

This repository is a pnpm workspace with:

- A Vite + React frontend in `artifacts/undergraduate-hub`
- An Express API in `artifacts/api-server`
- A Drizzle/Postgres database package in `lib/db`
- A Vercel function entry point in `api/index.ts`
- Vercel routing already configured in `vercel.json`

The frontend and API can be served from one Vercel project. The database and external authentication/SMS services must be reachable from Vercel.

## 1. Prepare production services

Before deploying, prepare:

1. A Supabase project for PostgreSQL, Auth, and Storage. Use its transaction pooler connection string for the serverless API.
2. Google enabled under **Supabase → Authentication → Providers → Google**, with valid OAuth client credentials configured there.
3. An SMS provider compatible with `artifacts/api-server/src/services/sms.ts`.
4. A private Supabase Storage bucket for payment screenshots.

Do not use the Replit development database hostname or Replit object-storage sidecar from Vercel. The application uses Supabase Storage when the direct Supabase variables are present and keeps the Replit sidecar only for local development.

The browser uses Supabase Auth for Google OAuth. The API validates the returned Supabase access token and then issues the application's existing secure member-session cookie. The Google client secret stays in Supabase and must not be added to Vercel.

## 2. Import the repository into Vercel

1. Open Vercel and choose **Add New → Project**.
2. Import the Git repository containing this workspace.
3. Set **Root Directory** to the repository root (`.`).
4. Use Node.js 20.x or newer.
5. Keep the framework preset as **Other** or **Vite**.
6. Keep the build settings from `vercel.json`:

```text
Install Command: pnpm install --frozen-lockfile
Build Command: pnpm --filter @workspace/undergraduate-hub run build
Output Directory: artifacts/undergraduate-hub/dist/public
```

Do not set `artifacts/undergraduate-hub` as the Vercel root directory. The API function and shared workspace packages are at the repository root.

## 3. Add environment variables

Add these variables in the Vercel project under **Settings → Environment Variables**. Add them for **Production** and **Preview** when both environments should work.

### Required database and session variables

```text
DATABASE_URL
SESSION_SECRET
```

Set `DATABASE_URL` to the production Supabase Postgres transaction-pooler URL. Do not use the Replit database URL. Apply the production schema once using the instructions below; Vercel builds do not run database migrations.

Use a separate production database connection string. Generate a new production-only session secret, for example:

```bash
openssl rand -base64 32
```

Never commit either value to Git.

### Administrator identity

Set the initial administrator email. This address is the allowlisted identity for email/password login, first-time email OTP setup, and password recovery:

```text
ADMIN_INITIAL_EMAIL=admin@example.com
```

The phone-based admin allowlist remains supported for existing accounts, but the admin UI uses email and password. These variables must be present in Vercel when phone admin access is used; the `.replit` values are not copied automatically:

```text
ADMIN_PHONE_NUMBERS=01619617036,01845278579
```

### Supabase authentication

The API uses Supabase's REST authentication endpoints when these variables are present:

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon-or-publishable-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_STORAGE_BUCKET=payment-screenshots
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only. Never prefix it with `VITE_` and never expose it in frontend code.

Create a private bucket with the same name in Supabase Storage. The API uploads and serves payment screenshots through the server using the service-role key; the bucket is never public.

### Browser Supabase Auth and Google redirect URLs

These two values are public and are embedded in the frontend during its Vercel build:

```text
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-or-publishable-key>
```

Use the same Supabase project and public key as above. Never place `SUPABASE_SERVICE_ROLE_KEY` in a `VITE_` variable.

In **Supabase → Authentication → URL Configuration**:

1. Set the Site URL to `https://undergraduate-hub-library-v1-mr0mrxigz.vercel.app`.
2. Add `https://undergraduate-hub-library-v1-mr0mrxigz.vercel.app/auth/callback` and `https://undergraduate-hub-library-v1-mr0mrxigz.vercel.app/admin/reset-password` to the allowed redirect URLs.
3. Add each Vercel Preview callback URL that should support OAuth, plus `http://localhost:5173/auth/callback` for local development.

In **Supabase → Authentication → Providers → Google**, enable Google and configure the OAuth client credentials. Copy the callback URL shown by Supabase into the authorized redirect URIs in the Google OAuth client. Supabase, not Vercel, stores the Google client secret.

Member login, account creation, and OTP password recovery support Google, phone, or email. Administrator access requires the configured admin email and assigned admin role; existing phone-allowlisted admin identities remain supported.

### SMS verification

```text
SMS_API_KEY=<provider-api-key>
SMS_API_BASE_URL=https://swiftsms.astgd.com/api/sms/send
SMS_API_LABEL=transactional
```

`SMS_API_BASE_URL` and `SMS_API_LABEL` are optional if the defaults are correct. `SMS_API_KEY` is required for administrator and member phone OTP delivery.

### Application origin

Set this to the deployed Vercel origin:

```text
APP_ORIGIN=https://undergraduate-hub-library-v1-mr0mrxigz.vercel.app
```

After adding a custom domain, update this value to the final HTTPS domain and redeploy. The frontend and API normally share the same origin, so no frontend API URL variable is required.

### Password recovery

If administrator password recovery is used, set:

```text
ADMIN_PASSWORD_RESET_REDIRECT_URL=https://undergraduate-hub-library-v1-mr0mrxigz.vercel.app/admin/reset-password
```

Configure the same URL in the Supabase authentication settings if Supabase requires an allowlisted redirect URL.

### Storage variables

`SUPABASE_STORAGE_BUCKET` is optional and defaults to `payment-screenshots`. `PRIVATE_OBJECT_DIR` is only used by the Replit development sidecar fallback and should not be used as a Vercel storage configuration.

## 4. Apply the production database schema

Do this once against the production database before using the deployed API. Do not run schema changes from the Vercel build command.

A safe local workflow is:

```bash
vercel env pull .env.production.local
pnpm install
pnpm --filter @workspace/db run push
rm .env.production.local
```

Check that the production database contains the tables used by the API, including:

- `members`
- `books`
- `borrow_requests`
- `transactions`
- `payments`
- `subscription_plans`
- `notifications`
- `audit_logs`
- `admin_sessions`
- `member_sessions`
- `otp_challenges`
- `user_roles`

Do not commit `.env.production.local`.

## 5. Deploy

### Dashboard deployment

Click **Deploy** in the Vercel project after adding the environment variables.

### CLI deployment

From the repository root:

```bash
vercel login
vercel
vercel --prod
```

The existing `vercel.json` will:

- Build the Vite frontend
- Serve `artifacts/undergraduate-hub/dist/public`
- Route `/api/*` to `api/index.ts`
- Route client-side application paths to `/index.html`
- Cache built assets for one year

## 6. Verify the deployment

Replace `https://your-project.vercel.app` with the deployed URL:

```bash
curl -i https://your-project.vercel.app/api/healthz
curl -i https://your-project.vercel.app/api/books
```

Expected results:

- `/api/healthz` returns `200` and `{"status":"ok"}`
- `/api/books` returns `200` with the catalog
- Member-only routes return `401` when no member session cookie is present
- Admin-only routes return `401` when no admin session cookie is present

Then test in the browser:

1. Browse the homepage and book detail page.
2. Create a member account with Google, then sign out and sign in with Google again.
3. Verify that a new Google member can reach the member dashboard without having a phone number.
4. Create and sign in to a member account using phone OTP.
5. Confirm that email-based member login and signup are unavailable.
6. Open membership status and verify OTP delivery.
7. Submit a payment with a unique TXID.
8. Sign in to the Admin Portal using an allowlisted phone number.
9. Confirm an unlisted number and admin email login are rejected.
10. Test payment screenshot upload with a private Supabase Storage bucket.
11. Test borrowing approval, delivery scheduling, and notifications.

Check **Vercel → Deployments → Functions** logs if `/api/*` returns a 500.

## 7. Vercel-specific limitations in the current code

### Development seeding

The API seed routine runs only when `NODE_ENV` is not `production`. Production data must be inserted through the production database setup process or the protected admin workflows; Vercel will not seed the demo catalog.

### Serverless execution

`api/index.ts` exports the Express app and does not call `listen()`, which is correct for Vercel Functions. Do not use `artifacts/api-server/src/index.ts` as the Vercel entry point because that file starts a long-running server and expects `PORT`.

### Replit-only integrations

The following are not available automatically on Vercel and must be replaced with ordinary environment variables or external services:

- `REPLIT_CONNECTORS_HOSTNAME`
- Replit object-storage sidecar (used only when direct Supabase Storage variables are absent)
- Replit-managed connector authentication
- Replit development database hostname
