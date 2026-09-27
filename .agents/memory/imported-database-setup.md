---
name: Imported database setup
description: Development database initialization needed after importing a database-backed app into the workspace.
---

After importing a database-backed app, confirm the development database schema exists before debugging API failures. An imported workspace can have a valid DATABASE_URL and a passing build while tables are still absent; applying the existing Drizzle schema is the appropriate development setup step.

**Why:** API requests otherwise fail with misleading PostgreSQL relation-not-found errors even though the server and connection are healthy.

**How to apply:** Run the workspace database package's existing development schema push, then restart or recheck the managed API workflow and verify a representative public and protected route.