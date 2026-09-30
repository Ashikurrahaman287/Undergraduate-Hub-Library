---
name: Vercel ESM imports
description: Keep the Vercel API's imported TypeScript graph compatible with NodeNext resolution.
---

Use explicit `.js` extensions for relative imports and exports throughout files reachable from the Vercel function entry point, including shared package barrels and generated type modules.

**Why:** Vercel reported TS2834 for an extensionless API-router import even though the workspace's regular typecheck uses different resolution settings.

**How to apply:** When changing the API route graph or regenerating shared API types, check the imports reachable from `api/index.ts` and rerun the production typecheck/build.