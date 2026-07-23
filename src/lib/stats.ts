import "server-only";
import { supabase } from "@/lib/supabase";
import { getSession } from "@/lib/session";
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

  const { data, error } = await supabase.rpc("get_my_stats", {
    viewer_id: userId,
    today_iso: todayIso,
    minus24h_iso: minus24hIso,
  });

  if (error || !data || data.length === 0) return ZERO;

  const row = data[0] as any;
  const given24h = Number(row.given_24h) || 0;
  const received24h = Number(row.received_24h) || 0;

  return {
    givenToday: Number(row.given_today) || 0,
    receivedToday: Number(row.received_today) || 0,
    given24h,
    received24h,
    deficit: Math.max(0, given24h - received24h),
  };
}
