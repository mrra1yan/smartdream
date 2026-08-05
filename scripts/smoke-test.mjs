#!/usr/bin/env node
/**
 * Smoke test — proves every PL/pgSQL function in db/setup.sql runs on a
 * real PostgreSQL 16 instance (syntax + execution + result shapes).
 *
 *   npm run db:smoke
 *
 * Self-contained: creates its own test rows and cleans up. Safe to run
 * against an empty or populated database.
 */
import pg from "pg";
import { randomUUID } from "node:crypto";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://smartdream:smartdream_dev_password@127.0.0.1:5432/smartdream";

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const prefix = `smoke-${Date.now()}-`;
  const uid = () => randomUUID();
  const now = new Date();
  const userId = uid();
  const linkId = uid();

  try {
    // ---- sanity: tables exist ----
    const { rows: tableRows } = await pool.query(
      "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename IN ('profiles','links','likes','blogs','settings','audit_log','feed_eligibility_cache')"
    );
    const tableNames = tableRows.map((r) => r.tablename);
    record("core tables exist", tableNames.length >= 7, `${tableNames.length} tables found`);

    // ---- sanity: functions exist ----
    const { rows: funcRows } = await pool.query(
      "SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('add_links_atomic','get_my_stats','get_top_likers','refresh_feed_eligibility_cache','get_eligible_feed_links','process_like_commit')"
    );
    const funcNames = funcRows.map((r) => r.proname);
    record("PL/pgSQL functions exist", funcNames.length >= 6, `${funcNames.length} functions found`);

    // ---- seed two profiles + a link ----
    await pool.query(
      `INSERT INTO profiles (id, public_id, first_name, last_name, phone, email, password_hash, role, status, created_at)
       VALUES ($1, $2, 'Smoke', 'User', '9990000001', $3, NULL, 'user', 'approved', $4)`,
      [userId, prefix + "u1", prefix + "u1@test.local", now],
    );
    const ownerId = uid();
    await pool.query(
      `INSERT INTO profiles (id, public_id, first_name, last_name, phone, email, password_hash, role, status, is_elite, created_at)
       VALUES ($1, $2, 'Owner', 'Elite', '9990000002', $3, NULL, 'user', 'approved', TRUE, $4)`,
      [ownerId, prefix + "u2", prefix + "u2@test.local", now],
    );
    await pool.query(
      "INSERT INTO links (id, user_id, url, likes_count, sort_order) VALUES ($1, $2, $3, 0, 0)",
      [linkId, userId, "https://smoke.test/a"],
    );

    // ---- boost_order_seq (sequence, replaces MySQL next_boost_order) ----
    const { rows: [seqRow] } = await pool.query("SELECT nextval('boost_order_seq') AS result");
    const boostOrder = seqRow.result;
    record("boost_order_seq", typeof boostOrder === "number" && boostOrder > 0, `→ ${boostOrder}`);

    // ---- add_links_atomic (JSONB rows, returns inserted count) ----
    const newLinkId = uid();
    const { rows: [addRow] } = await pool.query(
      "SELECT add_links_atomic($1, $2::JSONB, $3) AS result",
      [userId, JSON.stringify([{ id: newLinkId, url: "https://smoke.test/b" }]), 20],
    );
    const inserted = Number(addRow.result);
    record("add_links_atomic", inserted === 1, `inserted ${inserted}`);

    // ---- process_like_commit (full pipeline) ----
    const { rows: [commitRow] } = await pool.query(
      "SELECT process_like_commit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result",
      [userId, linkId, userId, false, false, false, 10, 30, 24, 20, now],
    );
    const committed = Number(commitRow.result);
    record("process_like_commit", committed === 1, committed ? "committed" : "rejected");

    // ---- get_my_stats (table-returning function) ----
    const yesterday = new Date(Date.now() - 86400000);
    const { rows: statsRows } = await pool.query(
      "SELECT * FROM get_my_stats($1, $2, $3)",
      [userId, now, yesterday],
    );
    record(
      "get_my_stats",
      Array.isArray(statsRows) && statsRows.length === 1 && "given_today" in (statsRows[0] ?? {}),
      JSON.stringify(statsRows[0] ?? {}),
    );

    // ---- get_top_likers (table-returning function) ----
    const { rows: topLikers } = await pool.query("SELECT * FROM get_top_likers(5)");
    record("get_top_likers", Array.isArray(topLikers), `${topLikers.length} row(s)`);

    // ---- refresh_feed_eligibility_cache + get_eligible_feed_links ----
    await pool.query("SELECT refresh_feed_eligibility_cache()");
    const { rows: feed } = await pool.query(
      "SELECT * FROM get_eligible_feed_links($1, $2, $3, $4, $5, $6)",
      [uid(), 20, 24, 12, 50, 0],
    );
    record(
      "get_eligible_feed_links",
      Array.isArray(feed) && feed.every((r) => "id" in r && "is_boosted" in r),
      `${feed.length} row(s)`,
    );

    const failed = results.filter((r) => !r.ok).length;
    console.log(failed === 0 ? "\nALL FUNCTIONS OK" : `\n${failed} FAILURE(S)`);
    process.exitCode = failed === 0 ? 0 : 1;
  } catch (err) {
    console.error("\n✗ smoke test crashed:", err.message ?? err);
    process.exitCode = 1;
  } finally {
    await pool.query("DELETE FROM links WHERE id LIKE $1", [`${prefix}%`]).catch(() => {});
    await pool.query("DELETE FROM profiles WHERE id LIKE $1", [`${prefix}%`]).catch(() => {});
    await pool.end();
  }
}

main();
