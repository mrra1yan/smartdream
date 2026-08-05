import "server-only";
import { getSession } from "@/lib/session";
import { getMyStats as rpcGetMyStats } from "@/lib/repos/rpc";
import { bangladeshMidnightISO } from "@/lib/timezone";

export type MyStats = {
  givenToday: number;
  receivedToday: number;
  given24h: number;
  received24h: number;
  deficit: number;
};

const ZERO: MyStats = {
  givenToday: 0,
  receivedToday: 0,
  given24h: 0,
  received24h: 0,
  deficit: 0,
};

function hoursAgoISO(h: number): string {
  return new Date(Date.now() - h * 3600000).toISOString();
}

export async function getMyStats(): Promise<MyStats> {
  const session = await getSession();
  if (!session) return ZERO;

  const userId = session.sub;
  const todayIso = bangladeshMidnightISO();
  const minus24hIso = hoursAgoISO(24);

  try {
    const row = await rpcGetMyStats(userId, todayIso, minus24hIso);
    if (!row) return ZERO;

    return {
      givenToday: row.givenToday,
      receivedToday: row.receivedToday,
      given24h: row.given24h,
      received24h: row.received24h,
      deficit: Math.max(0, row.given24h - row.received24h),
    };
  } catch (err) {
    console.error("[stats] get_my_stats error:", (err as Error).message);
    return ZERO;
  }
}
