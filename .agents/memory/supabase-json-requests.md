---
name: Supabase JSON requests
description: Transport requirement for Supabase Auth requests in this workspace.
---

Supabase Auth requests with JSON bodies must send an explicit `Content-Type: application/json` header through both the direct REST path and the Replit connector proxy.

**Why:** A missing header can let user provisioning appear successful while password-token authentication rejects valid credentials as invalid.

**How to apply:** Keep the shared Supabase request helper responsible for adding the header whenever a request has a body; do not rely on fetch or connector defaults.