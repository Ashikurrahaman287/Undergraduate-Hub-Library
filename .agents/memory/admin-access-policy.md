---
name: Admin access policy
description: The authentication boundary for administrator access in Undergraduate Hub.
---

Administrator access is phone-only and must be restricted to the configured administrator phone allowlist. Member signup and member login are separate paths and must not grant administrator access.

**Why:** The owner explicitly requires that no other phone number or email address can log in or complete administrator setup.

**How to apply:** Keep the allowlist enforced in server-side login, OTP request/verification, password setup, and existing-session identity checks. Keep the actual phone values in environment configuration rather than project memory.