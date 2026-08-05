import "server-only";
import mysql from "mysql2/promise";

/**
 * MySQL connection pool (single global pool for the whole app).
 *
 * Conventions:
 *   - `timezone: "Z"` + `process.env.TZ=UTC` — all DATETIME(6) values are
 *     naive UTC; DATE objects returned here are interpreted as UTC and
 *     converted to ISO strings by the repo row mappers.
 *   - `dateStrings: false` (default) so DATETIME columns come back as JS
 *     Date objects — repos normalize with `.toISOString()`.
 *
 * IMPORTANT: the like/links write procedures use GET_LOCK(), which is
 * connection-scoped. Call them through `callOut()` / `withConnection()`
 * below so the lock, the CALL, and the OUT-param read share ONE connection.
 */

export const pool = mysql.createPool({
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? "smartdream",
  password: process.env.MYSQL_PASSWORD ?? "smartdream_dev_password",
  database: process.env.MYSQL_DATABASE ?? "smartdream",
  waitForConnections: true,
  // Pool sizing is per Node process. The like/links write procedures hold a
  // dedicated connection for their whole GET_LOCK-guarded run (see callOut /
  // withConnection below), so under heavy concurrent like-commit traffic the
  // pool is the natural throughput ceiling. Keep it env-tunable (e.g. raise
  // MYSQL_POOL_LIMIT for a single beefy instance, lower it when running many
  // instances behind a load balancer so the combined count stays under the
  // MySQL server's --max-connections).
  connectionLimit: Number(process.env.MYSQL_POOL_LIMIT ?? 20),
  maxIdle: 10,
  idleTimeout: 60_000,
  // Fail fast instead of blocking forever. `queueLimit: 0` (the previous value)
  // let an unbounded number of requests wait indefinitely for a free
  // connection — under pool exhaustion every pending request would just pile
  // up until the server timed out, masking the overload. Capping the queue at
  // 2× the pool size bounds memory + latency: once exceeded, mysql2 rejects
  // the getConnection() call immediately and the caller surfaces a 5xx (or
  // the deadlock-retry path in callOut handles it) rather than hanging.
  queueLimit: Number(process.env.MYSQL_POOL_LIMIT ?? 20) * 2,
  // How long to wait for the initial TCP handshake before giving up. Pairs
  // with the finite queueLimit above so a saturated/unreachable DB fails fast
  // instead of stalling the request. (mysql2 has no separate connection-
  // *acquire* timeout on the pool options — the finite queueLimit is the
  // acquire-side guard.)
  connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT_MS ?? 10_000),
  charset: "utf8mb4",
  timezone: "Z",
});

/**
 * Runs `fn` on a single dedicated pooled connection and always releases it.
 * Use for GET_LOCK-based procedures so the lock can't leak across calls.
 */
export async function withConnection<T>(
  fn: (conn: mysql.PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    return await fn(conn);
  } finally {
    conn.release();
  }
}

const DEADLOCK_ERRNOS = new Set([1205, 1213]); // lock wait timeout, deadlock

/**
 * Calls a stored procedure that returns its result through an OUT param:
 *   CALL proc(?, ?, ..., @r);  SELECT @r
 * Both statements run on the same connection (required for GET_LOCK).
 * Retries on InnoDB deadlock / lock-wait-timeout (max 3 attempts).
 */
export async function callOut<T = number>(
  callSql: string,
  params: unknown[],
  outName = "@r",
  retries = 3,
): Promise<T> {
  return withConnection(async (conn) => {
    for (let attempt = 0; ; attempt++) {
      try {
        await conn.query(callSql, params);
        const [rows] = await conn.query<mysql.RowDataPacket[]>(
          `SELECT ${outName} AS result`,
        );
        return (rows[0]?.result ?? null) as T;
      } catch (err) {
        const code = (err as { errno?: number })?.errno;
        if (code && DEADLOCK_ERRNOS.has(code) && attempt < retries - 1) {
          await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
  });
}

/**
 * Calls a stored procedure whose result is a single result set
 * (e.g. get_my_stats, get_eligible_feed_links — final SELECT).
 */
export async function callRows<T = Record<string, unknown>>(
  callSql: string,
  params: unknown[],
): Promise<T[]> {
  return withConnection(async (conn) => {
    const [rows] = await conn.query(callSql, params);
    return (Array.isArray(rows) ? rows : []) as T[];
  });
}

/** Converts a naive-UTC DATETIME (Date or "YYYY-MM-DD HH:MM:SS[.fff]") to an
 *  ISO string, mirroring what supabase-js returned for timestamptz columns. */
export function toIso(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const s = String(value);
  if (!s) return null;
  const normalized = s.includes("T") ? s : s.replace(" ", "T");
  const hasFraction = /\.\d+/.test(normalized);
  return hasFraction ? `${normalized}Z` : `${normalized}.000Z`;
}
