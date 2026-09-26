---
name: Supabase production boundary
description: Development uses the workspace PostgreSQL adapter while a Supabase migration defines the production auth, RLS, and library schema boundary.
---

Development can run against the workspace PostgreSQL database without Supabase credentials; when the development database is empty, apply the Drizzle schema before starting library API verification. The managed Supabase connector can provide server-side Auth access without exposing keys, but its project settings still control which providers are available.

**Why:** The connected project was reachable with privileged Auth access while phone login remained disabled, so connector availability alone does not prove that phone/password authentication is ready.

**How to apply:** Keep local development functional without external credentials, use the connector as the server-side Supabase transport when available, and confirm the required Auth providers plus migration/RLS state before enabling hosted auth.