#!/usr/bin/env node
/**
 * Concurrency + quota test for the PostgreSQL process_like_commit function.
 *
 *   node scripts/test-concurrency.mjs
 *
 * Verifies the two guarantees that were racy in the old two-step Supabase
 * code and are now protected by advisory-lock + atomic-quota:
 *
 *   1. SAME-PAIR FLOOD: 50 concurrent commits for the same (liker, link,
 *      receiver) must produce EXACTLY ONE like row and likes_count == 1
 *      (12h cooldown under the liker:link advisory lock rejects the other 49).
 *
 *   2. QUOTA CEILING: a liker with auto_like usage quota 5 committing 10
 *      likes on 10 different links (different pair-locks, same liker-lock)
 *      must end at auto_like_used == 5 and auto_like_enabled == FALSE.
 *
 * Run against a running PostgreSQL instance — it creates and deletes its
 * own test rows.
 */
import pg from "pg";
import { randomUUID } from "node:crypto";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://smartdream:smartdream_dev_password@127.0.0.1:5432/smartdream";

function uuid() {
  return randomUUID();
}

function fail(msg) {
  console.error(`✗ FAIL: ${msg}`);
  process.exitCode = 1;
}

function pass(msg) {
  console.log(`✓ ${msg}`);
}

async function commitLike(client, args) {
  const { rows } = await client.query(
    "SELECT process_like_commit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result",
    [
      args.likerId, args.linkId, args.receiverId,
      args.isAnon, args.isBoostedLike, args.offerActive,
      args.offerLikesRequired, args.offerAutoLikeMinutes,
      args.activeWindowHours, args.activeLikeCount,
      args.todayIso,
    ],
  );
  return Number(rows[0]?.result) === 1;
}

async function main() {
  const pool = new pg.Pool({ connectionString, max: 50 }); // high concurrency
  const prefix = `test-${Date.now()}-`;

  // Clean up any leftover test rows from a previous crashed run
  await pool.query("DELETE FROM links WHERE url = 'https://test.local/link'").catch(() => {});
  await pool.query("DELETE FROM links WHERE url = 'https://test.local/q'").catch(() => {});

  try {
    // ── Setup ─────────────────────────────────────────────────────────────
    const liker = uuid();
    const owner = uuid();
    const linkId = uuid();
    const now = new Date();
    const todayIso = now.toISOString();

    await pool.query(
      `INSERT INTO profiles (id, public_id, first_name, last_name, phone, email, password_hash, role, status, created_at)
       VALUES ($1, $2, 'T', 'T', $3, $4, NULL, 'user', 'approved', $5)`,
      [liker, prefix + "liker", "000", prefix + "liker@test.local", now],
    );
    // Owner is elite: the exposure/deficit check is skipped for elite
    // profiles (same as production), so test 2's commits aren't blocked by
    // the owner having received more likes than it gave.
    await pool.query(
      `INSERT INTO profiles (id, public_id, first_name, last_name, phone, email, password_hash, role, status, is_elite, created_at)
       VALUES ($1, $2, 'O', 'O', $3, $4, NULL, 'user', 'approved', TRUE, $5)`,
      [owner, prefix + "owner", "111", prefix + "owner@test.local", now],
    );
    await pool.query(
      "INSERT INTO links (id, user_id, url, likes_count, sort_order) VALUES ($1, $2, $3, 0, 0)",
      [linkId, owner, "https://test.local/link"],
    );

    // ── Test 1: same-pair flood ───────────────────────────────────────────
    const args = {
      likerId: liker, linkId, receiverId: owner,
      isAnon: false, isBoostedLike: false, offerActive: false,
      offerLikesRequired: 10, offerAutoLikeMinutes: 30,
      activeWindowHours: 24, activeLikeCount: 20, todayIso: todayIso,
    };

    // Each commit needs its own client (advisory locks are session-scoped)
    const results = await Promise.all(
      Array.from({ length: 50 }, async () => {
        const client = await pool.connect();
        try {
          return await commitLike(client, args);
        } finally {
          client.release();
        }
      }),
    );
    const committed = results.filter(Boolean).length;

    const { rows: [likeCount] } = await pool.query(
      "SELECT COUNT(*)::INT AS n FROM likes WHERE liker_id = $1 AND link_id = $2",
      [liker, linkId],
    );
    const { rows: [linkRow] } = await pool.query(
      "SELECT likes_count FROM links WHERE id = $1",
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
    await pool.query(
      `UPDATE profiles SET auto_like_enabled = TRUE, auto_like_model = 'usage', auto_like_quota = 5, auto_like_used = 0
       WHERE id = $1`,
      [liker],
    );

    const linkIds = Array.from({ length: 10 }, () => uuid());
    for (const id of linkIds) {
      await pool.query(
        "INSERT INTO links (id, user_id, url, likes_count, sort_order) VALUES ($1, $2, $3, 0, 0)",
        [id, owner, "https://test.local/q"],
      );
    }
    // Fire on 10 DIFFERENT links so the pair-lock doesn't serialize them —
    // only the liker-lock + atomic WHERE clause enforce the ceiling.
    const quotaResults = await Promise.all(
      linkIds.map(async (id) => {
        const client = await pool.connect();
        try {
          return await commitLike(client, { ...args, linkId: id, todayIso: new Date().toISOString() });
        } finally {
          client.release();
        }
      }),
    );
    const quotaCommitted = quotaResults.filter(Boolean).length;

    const { rows: [likerRow] } = await pool.query(
      "SELECT auto_like_used, auto_like_enabled FROM profiles WHERE id = $1",
      [liker],
    );

    likerRow.auto_like_used === 5
      ? pass(`quota ceiling: auto_like_used = 5`)
      : fail(`quota ceiling: auto_like_used = ${likerRow.auto_like_used} (expected 5)`);
    likerRow.auto_like_enabled === false
      ? pass(`quota ceiling: auto_like disabled after exhaustion`)
      : fail(`quota ceiling: auto_like still enabled (expected false)`);
    // Quota exhaustion disables auto-like but does NOT reject the like itself
    // (the like was already earned by the ad view) — all 10 commit; the usage
    // counter is what's capped at 5.
    quotaCommitted === 10
      ? pass(`quota ceiling: all 10 commits succeed, counter capped at 5`)
      : fail(`quota ceiling: ${quotaCommitted}/10 commits succeeded (expected 10)`);

    console.log("\ncleanup: dropping test rows…");
  } finally {
    await pool.query("DELETE FROM links WHERE url IN ('https://test.local/link', 'https://test.local/q')").catch(() => {});
    await pool.query("DELETE FROM profiles WHERE id LIKE $1", [`${prefix}%`]).catch(() => {});
    await pool.end();
  }
}

main().catch((err) => {
  console.error("test crashed:", err.message ?? err);
  process.exit(1);
});
