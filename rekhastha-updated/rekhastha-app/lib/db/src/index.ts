import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const connectionString = process.env.DATABASE_URL;
const isSupabase = /supabase\.(co|com)/.test(connectionString);
const isServerless = Boolean(process.env.VERCEL);

/**
 * Supabase: use the pooled connection string (Supavisor, transaction mode,
 * port 6543) on Vercel so every function instance does not hold its own
 * Postgres connections. node-postgres only uses unnamed prepared statements,
 * which transaction-mode pooling supports.
 *
 * Supabase presents a certificate signed by its own CA, so we encrypt the
 * connection but skip chain verification (same as the `sslmode=require`
 * behaviour of libpq).
 */
export const pool = new Pool({
  connectionString: connectionString.replace(/[?&]sslmode=[^&]*/g, ""),
  ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
  max: isServerless ? 3 : 10,
  idleTimeoutMillis: isServerless ? 10_000 : 30_000,
  connectionTimeoutMillis: 10_000,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
