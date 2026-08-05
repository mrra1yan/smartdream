import "server-only";
import { pool, toIso } from "@/lib/db";
import { cacheGet, cacheSet } from "@/lib/redis";

/**
 * profiles table repository. All functions return rows shaped exactly like
 * the old supabase-js `Profile` type (snake_case columns, ISO timestamps,
 * booleans as real booleans) so existing mappers (profileRowToAdmin,
 * getCurrentUser) work unchanged.
 */

const COLS = `
  id, public_id, first_name, last_name, phone, email, password_hash,
  role, status, is_elite, is_boosted, boost_order, boost_model,
  boost_expiry, boost_quota, boost_used, auto_like_enabled,
  auto_like_model, auto_like_expiry, auto_like_quota, auto_like_used,
  free_autolike_until, auto_like_paused, auto_like_paused_remaining_minutes,
  free_autolike_paused_remaining_minutes, boosted_offer_count,
  referred_by, approved_by, created_at
`;

export type ProfileRow = {
  id: string;
  public_id: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  password_hash: string | null;
  role: string;
  status: string;
  is_elite: boolean;
  is_boosted: boolean;
  boost_order: number | null;
  boost_model: string;
  boost_expiry: string | null;
  boost_quota: number | null;
  boost_used: number;
  auto_like_enabled: boolean;
  auto_like_model: string;
  auto_like_expiry: string | null;
  auto_like_quota: number | null;
  auto_like_used: number;
  free_autolike_until: string | null;
  auto_like_paused: boolean;
  auto_like_paused_remaining_minutes: number | null;
  free_autolike_paused_remaining_minutes: number | null;
  boosted_offer_count: number;
  referred_by: string | null;
  approved_by: string | null;
  created_at: string;
};

export function mapProfileRow(row: Record<string, unknown>): ProfileRow {
  return {
    id: String(row.id),
    public_id: (row.public_id as string | null) ?? null,
    first_name: (row.first_name as string | null) ?? null,
    last_name: (row.last_name as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    password_hash: (row.password_hash as string | null) ?? null,
    role: String(row.role ?? "user"),
    status: String(row.status ?? "pending"),
    is_elite: Boolean(row.is_elite),
    is_boosted: Boolean(row.is_boosted),
    boost_order: row.boost_order == null ? null : Number(row.boost_order),
    boost_model: String(row.boost_model ?? "none"),
    boost_expiry: toIso(row.boost_expiry),
    boost_quota: row.boost_quota == null ? null : Number(row.boost_quota),
    boost_used: Number(row.boost_used ?? 0),
    auto_like_enabled: Boolean(row.auto_like_enabled),
    auto_like_model: String(row.auto_like_model ?? "none"),
    auto_like_expiry: toIso(row.auto_like_expiry),
    auto_like_quota: row.auto_like_quota == null ? null : Number(row.auto_like_quota),
    auto_like_used: Number(row.auto_like_used ?? 0),
    free_autolike_until: toIso(row.free_autolike_until),
    auto_like_paused: Boolean(row.auto_like_paused),
    auto_like_paused_remaining_minutes:
      row.auto_like_paused_remaining_minutes == null ? null : Number(row.auto_like_paused_remaining_minutes),
    free_autolike_paused_remaining_minutes:
      row.free_autolike_paused_remaining_minutes == null ? null : Number(row.free_autolike_paused_remaining_minutes),
    boosted_offer_count: Number(row.boosted_offer_count ?? 0),
    referred_by: (row.referred_by as string | null) ?? null,
    approved_by: (row.approved_by as string | null) ?? null,
    created_at: toIso(row.created_at) ?? "",
  };
}

export async function getProfile(id: string): Promise<ProfileRow | null> {
  const [rows] = await pool.query(`SELECT ${COLS} FROM profiles WHERE id = ?`, [id]);
  const row = (rows as Record<string, unknown>[])[0];
  return row ? mapProfileRow(row) : null;
}

export async function findProfileByEmail(email: string): Promise<ProfileRow | null> {
  return cachedLookup(`profile:email:${email.toLowerCase()}`, async () => {
    const [rows] = await pool.query(`SELECT ${COLS} FROM profiles WHERE email = ? LIMIT 1`, [email]);
    const row = (rows as Record<string, unknown>[])[0];
    return row ? mapProfileRow(row) : null;
  });
}

export async function findProfileByPhone(phone: string): Promise<ProfileRow | null> {
  return cachedLookup(`profile:phone:${phone}`, async () => {
    const [rows] = await pool.query(`SELECT ${COLS} FROM profiles WHERE phone = ? LIMIT 1`, [phone]);
    const row = (rows as Record<string, unknown>[])[0];
    return row ? mapProfileRow(row) : null;
  });
}

export async function findProfileByPublicId(publicId: string): Promise<ProfileRow | null> {
  return cachedLookup(`profile:pub:${publicId}`, async () => {
    const [rows] = await pool.query(`SELECT ${COLS} FROM profiles WHERE public_id = ? LIMIT 1`, [publicId]);
    const row = (rows as Record<string, unknown>[])[0];
    return row ? mapProfileRow(row) : null;
  });
}

/**
 * Cache-aside for the login/signup identifier lookups (email/phone/public_id
 * → profile row). 300s TTL; misses are NOT cached (a brand-new account must
 * be visible immediately after signup). Invalidated via
 * invalidateProfileLookups() (src/lib/profile-cache.ts) when those fields
 * change — currently only profile.phone can change post-signup, so phone
 * invalidation covers the writes that exist.
 */
const LOOKUP_CACHE_TTL_SECONDS = 300;

async function cachedLookup<T>(
  key: string,
  loader: () => Promise<T | null>,
): Promise<T | null> {
  const cached = await cacheGet<T>(key);
  if (cached) return cached;
  const row = await loader();
  if (row) await cacheSet(key, row, LOOKUP_CACHE_TTL_SECONDS);
  return row;
}

/** Login lookup: email or phone identifier (auth.ts semantics — two separate
 *  parameterized lookups, never an interpolated OR filter). */
export async function getLoginProfile(
  identifier: string,
): Promise<ProfileRow | null> {
  const byEmail = await findProfileByEmail(identifier);
  if (byEmail) return byEmail;
  return findProfileByPhone(identifier);
}

/** Scope guard meta (failIfElite): is_elite + role only. */
export async function getProfileMeta(
  id: string,
): Promise<{ is_elite: boolean; role: string } | null> {
  const [rows] = await pool.query(
    "SELECT is_elite, role FROM profiles WHERE id = ? LIMIT 1",
    [id],
  );
  const row = (rows as Record<string, unknown>[])[0];
  if (!row) return null;
  return { is_elite: Boolean(row.is_elite), role: String(row.role) };
}

export type NewProfile = {
  id: string;
  public_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  password_hash: string;
  role?: string;
  status?: string;
  referred_by?: string | null;
};

export async function insertProfile(data: NewProfile): Promise<void> {
  await pool.query(
    `INSERT INTO profiles (id, public_id, first_name, last_name, phone, email, password_hash, role, status, referred_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.id,
      data.public_id,
      data.first_name,
      data.last_name,
      data.phone,
      data.email,
      data.password_hash,
      data.role ?? "user",
      data.status ?? "pending",
      data.referred_by ?? null,
    ],
  );
}

/** Whitelisted writable columns — dynamic UPDATE built from a fixed map, so
 *  callers can never inject column names. */
const WRITABLE_COLS: Record<string, string> = {
  public_id: "public_id",
  first_name: "first_name",
  last_name: "last_name",
  phone: "phone",
  email: "email",
  password_hash: "password_hash",
  role: "role",
  status: "status",
  is_elite: "is_elite",
  is_boosted: "is_boosted",
  boost_order: "boost_order",
  boost_model: "boost_model",
  boost_expiry: "boost_expiry",
  boost_quota: "boost_quota",
  boost_used: "boost_used",
  auto_like_enabled: "auto_like_enabled",
  auto_like_model: "auto_like_model",
  auto_like_expiry: "auto_like_expiry",
  auto_like_quota: "auto_like_quota",
  auto_like_used: "auto_like_used",
  free_autolike_until: "free_autolike_until",
  auto_like_paused: "auto_like_paused",
  auto_like_paused_remaining_minutes: "auto_like_paused_remaining_minutes",
  free_autolike_paused_remaining_minutes: "free_autolike_paused_remaining_minutes",
  boosted_offer_count: "boosted_offer_count",
  referred_by: "referred_by",
  approved_by: "approved_by",
};

export type ProfilePatch = Partial<Record<keyof typeof WRITABLE_COLS, unknown>>;

export async function updateProfile(id: string, patch: ProfilePatch): Promise<void> {
  const entries = Object.entries(patch).filter(
    ([key]) => key in WRITABLE_COLS,
  );
  if (entries.length === 0) return;
  const sets = entries.map(([key]) => `${WRITABLE_COLS[key]} = ?`);
  const values = entries.map(([, value]) => value ?? null);
  await pool.query(
    `UPDATE profiles SET ${sets.join(", ")} WHERE id = ?`,
    [...values, id],
  );
}

export type ProfileListFilters = {
  roleIn?: string[];
  roleNotIn?: string[];
  status?: string;
  isElite?: boolean;
  isBoosted?: boolean;
  search?: string; // LIKE on public_id / email / phone
  orderBy?: string; // whitelisted: created_at
  limit?: number;
};

export async function listProfiles(
  filters: ProfileListFilters = {},
): Promise<ProfileRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.roleIn) {
    where.push(`role IN (${filters.roleIn.map(() => "?").join(", ")})`);
    params.push(...filters.roleIn);
  }
  if (filters.roleNotIn) {
    where.push(`role NOT IN (${filters.roleNotIn.map(() => "?").join(", ")})`);
    params.push(...filters.roleNotIn);
  }
  if (filters.status) {
    where.push("status = ?");
    params.push(filters.status);
  }
  if (filters.isElite !== undefined) {
    where.push("is_elite = ?");
    params.push(filters.isElite ? 1 : 0);
  }
  if (filters.isBoosted !== undefined) {
    where.push("is_boosted = ?");
    params.push(filters.isBoosted ? 1 : 0);
  }
  if (filters.search) {
    where.push("(public_id LIKE ? OR email LIKE ? OR phone LIKE ?)");
    const term = `%${filters.search}%`;
    params.push(term, term, term);
  }

  const orderBy = filters.orderBy === "created_at" ? "created_at DESC" : "created_at DESC";
  const limitClause = filters.limit ? ` LIMIT ${Math.min(filters.limit, 1000)}` : "";

  const sql = `SELECT ${COLS} FROM profiles
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ${orderBy}${limitClause}`;

  const [rows] = await pool.query(sql, params);
  return (rows as Record<string, unknown>[]).map(mapProfileRow);
}

export async function countProfiles(filters: ProfileListFilters = {}): Promise<number> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.roleIn) {
    where.push(`role IN (${filters.roleIn.map(() => "?").join(", ")})`);
    params.push(...filters.roleIn);
  }
  if (filters.roleNotIn) {
    where.push(`role NOT IN (${filters.roleNotIn.map(() => "?").join(", ")})`);
    params.push(...filters.roleNotIn);
  }
  if (filters.status) {
    where.push("status = ?");
    params.push(filters.status);
  }
  if (filters.isElite !== undefined) {
    where.push("is_elite = ?");
    params.push(filters.isElite ? 1 : 0);
  }

  const sql = `SELECT COUNT(*) AS cnt FROM profiles
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`;
  const [rows] = await pool.query(sql, params);
  return Number((rows as Record<string, unknown>[])[0]?.cnt ?? 0);
}

export async function countProfilesByReferredBy(userId: string): Promise<number> {
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS cnt FROM profiles WHERE referred_by = ?",
    [userId],
  );
  return Number((rows as Record<string, unknown>[])[0]?.cnt ?? 0);
}

/** Profile rows by id list (referral/approver lookups). */
export async function getProfilesByIds(
  ids: string[],
): Promise<ProfileRow[]> {
  if (ids.length === 0) return [];
  const [rows] = await pool.query(
    `SELECT ${COLS} FROM profiles WHERE id IN (${ids.map(() => "?").join(", ")})`,
    ids,
  );
  return (rows as Record<string, unknown>[]).map(mapProfileRow);
}

/** Highest boost_order among boosted profiles (nextBoostOrder fallback). */
export async function getMaxBoostOrder(): Promise<number | null> {
  const [rows] = await pool.query(
    "SELECT MAX(boost_order) AS m FROM profiles WHERE is_boosted = 1",
  );
  const value = (rows as Record<string, unknown>[])[0]?.m;
  return value == null ? null : Number(value);
}

/**
 * Atomic pending→approved transition (approveUser): flips the row only while
 * status is still 'pending' (closes the double-approve / double-credit race)
 * and returns the affected row's referred_by, or null if no row matched.
 */
export async function approveProfileAtomic(
  userId: string,
  approvedBy: string | null,
): Promise<string | null> {
  const [result] = await pool.query(
    `UPDATE profiles SET status = 'approved', approved_by = ?
     WHERE id = ? AND status = 'pending'`,
    [approvedBy, userId],
  );
  if ((result as { affectedRows: number }).affectedRows === 0) return null;

  const row = await getProfile(userId);
  return row?.referred_by ?? null;
}

/** Bonus-relevant columns for the referral credit branches. */
export async function getProfileBonusFields(
  userId: string,
): Promise<{
  free_autolike_until: string | null;
  auto_like_paused: boolean;
  free_autolike_paused_remaining_minutes: number | null;
} | null> {
  const [rows] = await pool.query(
    `SELECT free_autolike_until, auto_like_paused, free_autolike_paused_remaining_minutes
     FROM profiles WHERE id = ? LIMIT 1`,
    [userId],
  );
  const row = (rows as Record<string, unknown>[])[0];
  if (!row) return null;
  return {
    free_autolike_until: toIso(row.free_autolike_until),
    auto_like_paused: Boolean(row.auto_like_paused),
    free_autolike_paused_remaining_minutes:
      row.free_autolike_paused_remaining_minutes == null ? null : Number(row.free_autolike_paused_remaining_minutes),
  };
}

/** Hard-delete a profile (rejectUser / deleteUser). Likes/links cascade. */
export async function deleteProfile(userId: string): Promise<void> {
  await pool.query("DELETE FROM profiles WHERE id = ?", [userId]);
}

/** Null out references to a deleted user (reject cleanup). */
export async function nullOutReferredBy(userId: string): Promise<void> {
  await pool.query("UPDATE profiles SET referred_by = NULL WHERE referred_by = ?", [userId]);
}

export async function nullOutApprovedBy(userId: string): Promise<void> {
  await pool.query("UPDATE profiles SET approved_by = NULL WHERE approved_by = ?", [userId]);
}
