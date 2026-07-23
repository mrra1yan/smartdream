"use server";

import { getMyStats, type MyStats } from "@/lib/stats";

// Lets the given/received realtime clients (home-stats-client.tsx,
// profile-stats-client.tsx) resync with the authoritative count whenever
// their Realtime channel (re)subscribes -- Postgres Realtime doesn't replay
// events missed during a dropped connection, so without this a WebSocket
// blip (network switch, screen lock/unlock, backgrounding) would silently
// under-count until the next full page reload.
export async function getMyStatsAction(): Promise<MyStats> {
  return getMyStats();
}
