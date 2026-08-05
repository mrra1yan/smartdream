#!/usr/bin/env node
/**
 * Concurrency + quota test for the MySQL process_like_commit port.
 *
 *   node scripts/test-concurrency.mjs
 *
 * Verifies the two guarantees that were racy in the old two-step Supabase
 * code and are now protected by the named-lock + atomic-quota port:
 *
 *   1. SAME-PAIR FLOOD: 50 concurrent commits for the same (liker, link,
 *      receiver) must produce EXACTLY ONE like row and likes_count == 1
 *      (12h cooldown under the liker:link lock rejects the other 49).
 *
 *   2. QUOTA CEILING: a liker with auto_like usage quota 5 committing 10
 *      likes on 10 different links (different pair-locks, same liker-lock)
 *      must end at auto_like_used == 5 and auto_like_enabled == 0.
 *
 * Run against a scratch database (docker compose up) — it creates and
 * deletes its own test rows.
 */

import { createConnection } from "mysql2/promise";

const MYSQL = {
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? "smartdream",
  password: process.env.MYSQL_PASSWORD ?? "smartdream_dev_password",
  database: process.env.MYSQL_DATABASE ?? "smartdream",
  timezone: "Z",
};

function uuid() {
  return crypto.randomUUID();
}

function fail(msg) {
  console.error(`✗ FAIL: ${msg}`);
  process.exitCode = 1;
}

function pass(msg) {
  console.log(`✓ ${msg}`);
}

async function commitLike(conn, args) {
  const [rows] = await conn.query(
    "CALL process_like_commit(?,?,?,?,?,?,?,?,?,?,?,@r)",
    [
      args.likerId, args.linkId, args.receiverId,
      args.isAnon ? 1 : 0, args.isBoostedLike ? 1 : 0,
      args.offerActive ? 1 : 0,
      args.offerLikesRequired, args.offerAutoLikeMinutes,
      args.activeWindowHours, args.activeLikeCount,
      new Date(args.todayIso),
    ],
  );
  const [out] = await conn.query("SELECT @r AS result");
  return out[0]?.result === 1;
}

async function main() {
  const conn = await createConnection(MYSQL);
  const prefix = `test-${Date.now()}-`;

  try {
    // ── Setup ────────────────────────────────────────────────────────────
    const liker = uuid();
    const owner = uuid();
    const linkId = uuid();
    const now = new Date();
    const todayIso = now.toISOString();

    await conn.query(
      `INSERT INTO profiles (id, public_id, first_name, last_name, phone, email, password_hash, role, status, created_at)
       VALUES (?, ?, 'T', 'T', ?, ?, NULL, 'user', 'approved', ?)`,
      [liker, prefix + "liker", "000", prefix + "liker@test.local", now],
    );
    // Owner is elite: the exposure/deficit check is skipped for elite
    // profiles (same as production), so test 2's commits aren't blocked by
    // the owner having received more likes than it gave.
    await conn.query(
      `INSERT INTO profiles (id, public_id, first_name, last_name, phone, email, password_hash, role, status, is_elite, created_at)
       VALUES (?, ?, 'O', 'O', ?, ?, NULL, 'user', 'approved', 1, ?)`,
      [owner, prefix + "owner", "111", prefix + "owner@test.local", now],
    );
    await conn.query(
      "INSERT INTO links (id, user_id, url, likes_count, sort_order) VALUES (?, ?, ?, 0, 0)",
      [linkId, owner, "https://test.local/link"],
    );

    // ── Test 1: same-pair flood ──────────────────────────────────────────
    const args = {
      likerId: liker, linkId, receiverId: owner,
      isAnon: false, isBoostedLike: false, offerActive: false,
      offerLikesRequired: 10, offerAutoLikeMinutes: 30,
      activeWindowHours: 24, activeLikeCount: 20, todayIso,
    };
    const results = await Promise.all(
      Array.from({ length: 50 }, () => commitLike(conn, args)),
    );
    const committed = results.filter(Boolean).length;

    const [[likeCount]] = await conn.query(
      "SELECT COUNT(*) AS n FROM likes WHERE liker_id = ? AND link_id = ?",
      [liker, linkId],
    );
    const [[linkRow]] = await conn.query(
      "SELECT likes_count FROM links WHERE id = ?",
      [linkId],
    );

    committed === 1
      ? pass(`same-pair flood: exactly 1 of 50 commits succeeded`)
      : fail(`same-pair flood: ${committed} commits succeeded (expected 1)`);
    likeCount.n === 1
      ? pass(`same-pair flood: likes table has 1 row`)
      : fail(`same-pair flood: likes table has ${likeCount.n} rows (expected 1)`);
    linkRow.likes_count === 1
      ? pass(`same-pair flood: link likes_count = 1`)
      : fail(`same-pair flood: link likes_count = ${linkRow.likes_count} (expected 1)`);

    // ── Test 2: quota ceiling ────────────────────────────────────────────
    await conn.query(
      `UPDATE profiles SET auto_like_enabled = 1, auto_like_model = 'usage', auto_like_quota = 5, auto_like_used = 0
       WHERE id = ?`,
      [liker],
    );

    const linkIds = Array.from({ length: 10 }, () => uuid());
    for (const id of linkIds) {
      await conn.query(
        "INSERT INTO links (id, user_id, url, likes_count, sort_order) VALUES (?, ?, ?, 0, 0)",
        [id, owner, "https://test.local/q"],
      );
    }
    // Fire on 10 DIFFERENT links so the pair-lock doesn't serialize them —
    // only the liker-lock + atomic WHERE clause enforce the ceiling.
    const quotaResults = await Promise.all(
      linkIds.map((id) =>
        commitLike(conn, { ...args, linkId: id, todayIso: new Date().toISOString() }),
      ),
    );
    const quotaCommitted = quotaResults.filter(Boolean).length;

    const [[likerRow]] = await conn.query(
      "SELECT auto_like_used, auto_like_enabled FROM profiles WHERE id = ?",
      [liker],
    );

    likerRow.auto_like_used === 5
      ? pass(`quota ceiling: auto_like_used = 5`)
      : fail(`quota ceiling: auto_like_used = ${likerRow.auto_like_used} (expected 5)`);
    likerRow.auto_like_enabled === 0
      ? pass(`quota ceiling: auto_like disabled after exhaustion`)
      : fail(`quota ceiling: auto_like still enabled (expected 0)`);
    // Quota exhaustion disables auto-like but does NOT reject the like itself
    // (the like was already earned by the ad view) — all 10 commit; the usage
    // counter is what's capped at 5.
    quotaCommitted === 10
      ? pass(`quota ceiling: all 10 commits succeed, counter capped at 5`)
      : fail(`quota ceiling: ${quotaCommitted}/10 commits succeeded (expected 10)`);

    console.log("\ncleanup: dropping test rows…");
  } finally {
    await conn.query("DELETE FROM profiles WHERE id LIKE ?", [`${prefix}%`]).catch(() => {});
    await conn.end();
  }
}

main().catch((err) => {
  console.error("test crashed:", err.message ?? err);
  process.exit(1);
});
