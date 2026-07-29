"use server";

import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { toBangladeshLocal, bangladeshDateKey, fromBangladeshLocalISO } from "@/lib/timezone";

export async function getWeeklyLikeStats(userId: string) {
  // ── Auth check (fixes IDOR — previously anyone could fetch any user's stats) ─
  const user = await getCurrentUser();
  if (!user || user.status !== "approved") {
    // Return empty stats rather than throwing — the chart component is
    // client-rendered and a thrown error would crash the page.
    const now = toBangladeshLocal();
    const monday = new Date(now);
    monday.setUTCHours(0, 0, 0, 0);
    return { startDate: fromBangladeshLocalISO(monday), endDate: "", stats: [] };
  }
  // Only allow fetching your own stats (admin/super-admin can use admin APIs instead)
  const effectiveUserId = user.id;

  // Week/day boundaries computed on the Bangladesh wall clock, not
  // server-local (UTC) time -- see src/lib/timezone.ts. Otherwise a like
  // given between midnight and 6am Dhaka time lands one calendar day (and
  // potentially one Mon-Sun week bucket) earlier than a Bangladeshi user
  // would expect.
  const now = toBangladeshLocal();

  const day = now.getUTCDay() || 7;
  if (day !== 1) {
    now.setUTCHours(now.getUTCHours() - 24 * (day - 1));
  }

  const startDate = new Date(now);
  startDate.setUTCHours(0, 0, 0, 0);

  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + 6);
  endDate.setUTCHours(23, 59, 59, 999);

  // Convert the BD-local boundary instants back to real UTC instants for the
  // DB query (created_at is stored as a real timestamptz).
  const startDateStr = fromBangladeshLocalISO(startDate);
  const endDateStr = fromBangladeshLocalISO(endDate);

  const { data: userLikes, error } = await supabase
    .from("likes")
    // Only 3 columns are ever read (liker_id vs userId, receiver_id vs userId,
    // created_at for day bucketing). The other 4 columns (id, link_id,
    // is_anonymous, is_boosted_like) were pulled over the wire but never used.
    .select("liker_id, receiver_id, created_at")
    .gte("created_at", startDateStr)
    .lte("created_at", endDateStr)
    .or(`liker_id.eq.${effectiveUserId},receiver_id.eq.${effectiveUserId}`);

  if (error || !userLikes) {
    return {
      startDate: startDateStr,
      endDate: endDateStr,
      stats: [
        // startDate's UTC fields already hold BD-local wall-clock values
        // (see toBangladeshLocal), so reading its date portion directly
        // gives the correct BD-local calendar day -- no further shift.
        { name: "Mon", date: startDate.toISOString().split("T")[0], given: 0, taken: 0 },
        { name: "Tue", date: "", given: 0, taken: 0 },
        { name: "Wed", date: "", given: 0, taken: 0 },
        { name: "Thu", date: "", given: 0, taken: 0 },
        { name: "Fri", date: "", given: 0, taken: 0 },
        { name: "Sat", date: "", given: 0, taken: 0 },
        { name: "Sun", date: "", given: 0, taken: 0 },
      ]
    };
  }

  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const stats = days.map((dayName, index) => {
    const currentDay = new Date(startDate);
    currentDay.setUTCDate(currentDay.getUTCDate() + index);
    const dateStr = currentDay.toISOString().split("T")[0];

    return {
      name: dayName,
      date: dateStr,
      given: 0,
      taken: 0,
    };
  });

  for (const like of userLikes) {
    // like.created_at is a real UTC instant -- bangladeshDateKey converts it
    // to the BD-local calendar day, matching the `stats[].date` labels above
    // (which are already BD-local). Comparing raw `created_at.split("T")[0]`
    // against those would misbucket anything within 6h of UTC midnight.
    const likeDateStr = bangladeshDateKey(like.created_at);
    const statItem = stats.find(s => s.date === likeDateStr);

    if (statItem) {
      if (like.liker_id === effectiveUserId) {
        statItem.given += 1;
      }
      if (like.receiver_id === effectiveUserId) {
        statItem.taken += 1;
      }
    }
  }

  return {
    startDate: startDateStr,
    endDate: endDateStr,
    stats
  };
}
