import "server-only";
import { Pool, PoolClient } from "pg";

/**
 * PostgreSQL connection pool (single global pool for the whole app).
 *
 * Connects via DATABASE_URL (standard PG connection string).
 * All TIMESTAMPTZ columns come back as JS Date objects — repos normalize
 * with toIso() → ISO strings.
 *
 * Advisory locks (pg_advisory_lock) replace MySQL's GET_LOCK().
 * They are session-scoped on the connection, so lock-using functions
 * must call withConnection() to pin to one client for their duration.
 */

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://smartdream:smartdream_dev_password@127.0.0.1:5432/smartdream",
  max: Number(process.env.PG_POOL_MAX ?? 20),
  idleTimeoutMillis: 60_000,
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 10_000),
});

pool.on("error", (err) => {
  console.error("[pg] pool error:", err.message);
});

/**
 * Runs `fn` on a single dedicated pooled client and always releases it.
 * Use for advisory-lock-based functions so the lock can't leak across calls.
 */
export async function withConnection<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

const PG_DEADLOCK_CODES = new Set(["40001", "40P01"]); // serialization failure, deadlock

/**
 * Calls a PostgreSQL function that returns a scalar result:
 *   SELECT func($1, $2, ...) AS result
 * Runs on a dedicated connection (required for advisory locks).
 * Retries on deadlock (max 3 attempts).
 */
export async function callOut<T = number>(
  sql: string,
  params: unknown[],
  retries = 3,
): Promise<T> {
  return withConnection(async (client) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const { rows } = await client.query(sql, params);
        return (rows[0]?.result ?? null) as T;
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code && PG_DEADLOCK_CODES.has(code) && attempt < retries - 1) {
          await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
  });
}

/**
 * Calls a PostgreSQL function that returns a result set:
 *   SELECT * FROM func($1, $2, ...)
 * Runs on a dedicated connection.
 */
export async function callRows<T = Record<string, unknown>>(
  sql: string,
  params: unknown[],
): Promise<T[]> {
  return withConnection(async (client) => {
    const { rows } = await client.query(sql, params);
    return rows as T[];
  });
}

/** Converts a TIMESTAMPTZ value (Date or string) to ISO string. */
export function toIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const s = String(value);
  if (!s) return null;
  const normalized = s.includes("T") ? s : s.replace(" ", "T");
  const hasFraction = /\.\d+/.test(normalized);
  const hasZ = normalized.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(normalized);
  if (hasZ) return hasFraction ? normalized : `${normalized}.000Z`;
  return hasFraction ? `${normalized}Z` : `${normalized}.000Z`;
}
