import "server-only";
import { cacheDel, redis } from "@/lib/redis";
import { getProfile } from "@/lib/repos/profiles";

/**
 * Profile cache invalidation. Call after ANY write to a profile row so the
 * 60s `profile:{id}` / 300s login-lookup caches never serve stale data.
 *
 * Also bumps the per-user session-version key: a role/status change takes
 * effect for existing sessions within the 60s cache window (JWT claims in
 * middleware are only coarse route guards; getCurrentUser() re-reads the
 * row and is the authorization boundary).
 *
 * Clears the lookup keys derived from the user's CURRENT identifiers too —
 * critical after a password reset, where a stale cached row would otherwise
 * keep serving the old password_hash for up to 300s. The one extra DB read
 * (getProfile is uncached) is cheap: profile writes are rare.
 */

export async function invalidateProfileCache(userId: string): Promise<void> {
  await Promise.all([
    cacheDel(`profile:${userId}`),
    redis.incr(`sess:v:${userId}`).catch(() => 0),
  ]);

  const profile = await getProfile(userId).catch(() => null);
  if (profile) {
    await cacheDel(
      ...(profile.email ? [`profile:email:${profile.email.toLowerCase()}`] : []),
      ...(profile.phone ? [`profile:phone:${profile.phone}`] : []),
      ...(profile.public_id ? [`profile:pub:${profile.public_id}`] : []),
    );
  }
}

/**
 * Clears lookup keys for identifier values that are about to change (e.g.
 * the OLD phone before it's overwritten — invalidateProfileCache only knows
 * the post-write values). `identifiers` are the raw pre-write values.
 */
export async function invalidateProfileLookups(
  identifiers: string[],
): Promise<void> {
  if (identifiers.length === 0) return;
  await cacheDel(
    ...identifiers.flatMap((v) => [
      `profile:email:${v.toLowerCase()}`,
      `profile:phone:${v}`,
      `profile:pub:${v}`,
    ]),
  );
}
