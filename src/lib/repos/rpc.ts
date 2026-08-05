import "server-only";
import { callOut, callRows } from "@/lib/db";

/**
 * Wrappers for PostgreSQL functions (db/setup.sql PL/pgSQL functions).
 * Functions that use pg_advisory_lock run through callOut/callRows, which
 * hold a single pooled connection so locks can never leak.
 */

export type LikeCommitArgs = {
  likerId: string;
  linkId: string;
  receiverId: string;
  isAnon: boolean;
  isBoostedLike: boolean;
  offerActive: boolean;
  offerLikesRequired: number;
  offerAutoLikeMinutes: number;
  activeWindowHours: number;
  activeLikeCount: number;
  todayIso: string;
};

/** 1 = committed, 0 = rejected (cooldown / owner deficit / lock failure). */
export async function processLikeCommit(args: LikeCommitArgs): Promise<boolean> {
  const result = await callOut<number>(
    `SELECT process_like_commit($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) AS result`,
    [
      args.likerId,
      args.linkId,
      args.receiverId,
      args.isAnon,
      args.isBoostedLike,
      args.offerActive,
      args.offerLikesRequired,
      args.offerAutoLikeMinutes,
      args.activeWindowHours,
      args.activeLikeCount,
      args.todayIso,
    ],
  );
  return result === 1;
}

/** Inserts as many links as fit under the cap; returns the count inserted. */
export async function addLinksAtomic(
  userId: string,
  rows: { id: string; url: string }[],
  maxLinks: number,
): Promise<number> {
  return callOut<number>(
    "SELECT add_links_atomic($1, $2, $3) AS result",
    [userId, JSON.stringify(rows), maxLinks],
  );
}

/** Next boost_order value (atomic, race-free via sequence). */
export async function nextBoostOrder(): Promise<number> {
  return callOut<number>("SELECT nextval('boost_order_seq') AS result", []);
}

export type MyStatsRow = {
  givenToday: number;
  receivedToday: number;
  given24h: number;
  received24h: number;
};

export async function getMyStats(
  viewerId: string,
  todayIso: string,
  minus24hIso: string,
): Promise<MyStatsRow | null> {
  const rows = await callRows<Record<string, number>>(
    "SELECT * FROM get_my_stats($1, $2, $3)",
    [viewerId, todayIso, minus24hIso],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    givenToday: Number(row.given_today) || 0,
    receivedToday: Number(row.received_today) || 0,
    given24h: Number(row.given_24h) || 0,
    received24h: Number(row.received_24h) || 0,
  };
}

export type FeedLinkRow = {
  id: string;
  url: string;
  likes_count: number;
  anonymous: boolean;
  is_boosted: boolean;
};

export async function getEligibleFeedLinks(args: {
  viewerId: string;
  activeLikeCount: number;
  activeWindowHours: number;
  cooldownHours: number;
  limit: number;
  offset: number;
}): Promise<FeedLinkRow[]> {
  return callRows<FeedLinkRow>(
    "SELECT * FROM get_eligible_feed_links($1, $2, $3, $4, $5, $6)",
    [
      args.viewerId,
      args.activeLikeCount,
      args.activeWindowHours,
      args.cooldownHours,
      args.limit,
      args.offset,
    ],
  );
}

export type TopLikerRow = {
  id: string;
  public_id: string;
  first_name: string;
  last_name: string;
  email: string;
  likes_count: number;
};

export async function getTopLikers(limit = 5): Promise<TopLikerRow[]> {
  return callRows<TopLikerRow>("SELECT * FROM get_top_likers($1)", [limit]);
}
