---
name: Imported database setup
description: Development database initialization needed after importing a database-backed app into the workspace.
---

After importing a database-backed app, confirm the development database schema matches the current Drizzle schema before debugging API failures. An imported workspace can have a valid DATABASE_URL and a passing build while tables are absent or still use an earlier column name; apply the existing Drizzle schema, preserving data when resolving rename conflicts.

**Why:** API requests otherwise fail with misleading PostgreSQL relation/column errors even though the server and connection are healthy. Non-interactive schema pushes can stop on rename prompts, so an explicit data-preserving rename may be needed before rerunning the normal push.

**How to apply:** Run the workspace database package's existing development schema push, then restart or recheck the managed API workflow and verify a representative public and protected route.