---
name: Supabase production boundary
description: Development uses the workspace PostgreSQL adapter while a Supabase migration defines the production auth, RLS, and library schema boundary.
---

Development can run against the workspace PostgreSQL database without Supabase credentials; when the development database is empty, apply the Drizzle schema before starting library API verification. The Supabase migration remains the source for hosted auth/RLS rollout.

**Why:** The initial workspace had no Supabase connection or project credentials, but the product needs a clear path to Supabase Auth and database-level authorization for production.

**How to apply:** Keep local development functional without external credentials, and align any future Supabase adapter with the migration tables, role model, and RLS policies before enabling production auth.