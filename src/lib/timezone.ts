import "server-only";

/**
 * The app serves a Bangladesh-only audience but runs on a UTC server clock
 * (Vercel's default Node runtime). "Today" / "this week" boundaries must be
 * computed in Bangladesh local time (UTC+6), not server-local time, or a
 * like/action taken between midnight and 6am Dhaka time gets counted toward
 * "yesterday" until 6am server time actually arrives -- e.g. getUserStats /
 * getMyStats's "given today" counters previously used `new Date().setHours(0,
 * 0, 0, 0)`, which is UTC midnight on a UTC server, silently disagreeing with
 * getEliteUsers' (src/lib/super-admin.ts) deliberately BD-aware boundary.
 */
const BD_OFFSET_MS = 6 * 60 * 60 * 1000;

/** Converts a real instant to the Date it would show on a Bangladesh wall
 *  clock, still represented as a UTC-based Date object (so `getUTCHours()`
 *  etc. read as BD-local hours). */
export function toBangladeshLocal(instant: number | string | Date = Date.now()): Date {
  const ms = instant instanceof Date ? instant.getTime() : new Date(instant).getTime();
  return new Date(ms + BD_OFFSET_MS);
}

/** Inverse of toBangladeshLocal: given a "pseudo-date" whose UTC fields hold
 *  BD-local wall-clock values (as constructed/mutated via toBangladeshLocal
 *  + setUTC*), returns the real UTC instant it represents, as ISO. */
export function fromBangladeshLocalISO(pseudoDate: Date): string {
  return new Date(pseudoDate.getTime() - BD_OFFSET_MS).toISOString();
}

/** ISO instant for Bangladesh midnight, `daysFromToday` days from today
 *  (0 = today, -7 = a week ago, etc.). */
export function bangladeshMidnightISO(daysFromToday = 0): string {
  const local = toBangladeshLocal();
  local.setUTCHours(0, 0, 0, 0);
  local.setUTCDate(local.getUTCDate() + daysFromToday);
  return new Date(local.getTime() - BD_OFFSET_MS).toISOString();
}

/** YYYY-MM-DD for `instant` as it reads on a Bangladesh wall clock. Used to
 *  bucket timestamps by BD-local calendar day (e.g. weekly chart stats). */
export function bangladeshDateKey(instant: number | string | Date): string {
  return toBangladeshLocal(instant).toISOString().split("T")[0];
}
