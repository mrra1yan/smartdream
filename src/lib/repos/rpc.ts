import "server-only";
import { callOut, callRows } from "@/lib/db";

/**
 * Wrappers for the MySQL stored procedures (db/migrations/0002_rpcs.sql).
 * Every procedure that uses GET_LOCK runs through callOut/callRows, which
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

/** ISO string → Date for DATETIME params (mysql2 binds Date objects
 *  correctly per connection timezone; raw "T"/"Z" strings may not parse). */
function isoParam(iso: string): Date {
  return new Date(iso);
}

/** 1 = committed, 0 = rejected (cooldown / owner deficit / lock failure). */
export async function processLikeCommit(args: LikeCommitArgs): Promise<boolean> {
  const result = await callOut<number>(
    "CALL process_like_commit(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, @r)",
    [
      args.likerId,
      args.linkId,
      args.receiverId,
      args.isAnon ? 1 : 0,
      args.isBoostedLike ? 1 : 0,
      args.offerActive ? 1 : 0,
      args.offerLikesRequired,
      args.offerAutoLikeMinutes,
      args.activeWindowHours,
      args.activeLikeCount,
      isoParam(args.todayIso),
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
    "CALL add_links_atomic(?, ?, ?, @r)",
    [userId, JSON.stringify(rows), maxLinks],
  );
}

/** Next boost_order value (atomic, race-free — mirrors the pg sequence). */
export async function nextBoostOrder(): Promise<number> {
  return callOut<number>("CALL next_boost_order(@r)", []);
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
    "CALL get_my_stats(?, ?, ?)",
    [viewerId, isoParam(todayIso), isoParam(minus24hIso)],
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
    "CALL get_eligible_feed_links(?, ?, ?, ?, ?, ?)",
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
  return callRows<TopLikerRow>("CALL get_top_likers(?)", [limit]);
}
