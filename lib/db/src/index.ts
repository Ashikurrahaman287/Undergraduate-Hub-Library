import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set. Configure the Supabase Transaction Pooler URL for Vercel.",
  );
}

// Keep the pool small because this module runs inside a Vercel serverless function.
export const pool = new Pool({
  connectionString,
  max: 1,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true,
});

export const db = drizzle(pool, { schema });

export * from "./schema/index.js";
