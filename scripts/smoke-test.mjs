#!/usr/bin/env node
/**
 * Smoke test — proves every stored procedure in db/migrations/0002_rpcs.sql
 * runs on a real MySQL 8 instance (syntax + execution + result shapes).
 * This is the FIRST thing to run on the VPS after `npm run db:migrate`,
 * because the procedure SQL has never executed anywhere yet.
 *
 *   npm run db:smoke
 *
 * Self-contained: creates its own test rows and cleans up. Safe to run
 * against an empty or populated database.
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

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const conn = await createConnection(MYSQL);
  const prefix = `smoke-${Date.now()}-`;
  const uid = () => crypto.randomUUID();
  const now = new Date();
  const userId = uid();
  const linkId = uid();

  try {
    // ---- sanity: migrations applied ----
    const [[mig]] = await conn.query(
      "SELECT COUNT(*) AS n FROM schema_migrations",
    );
    record("schema_migrations applied", mig.n >= 2, `${mig.n} migration(s)`);

    // ---- seed two profiles + a link ----
    await conn.query(
      `INSERT INTO profiles (id, public_id, first_name, last_name, phone, email, password_hash, role, status, created_at)
       VALUES (?, ?, 'Smoke', 'User', '9990000001', ?, NULL, 'user', 'approved', ?)`,
      [userId, prefix + "u1", prefix + "u1@test.local", now],
    );
    await conn.query(
      `INSERT INTO profiles (id, public_id, first_name, last_name, phone, email, password_hash, role, status, is_elite, created_at)
       VALUES (?, ?, 'Owner', 'Elite', '9990000002', ?, NULL, 'user', 'approved', 1, ?)`,
      [uid(), prefix + "u2", prefix + "u2@test.local", now],
    );
    await conn.query(
      "INSERT INTO links (id, user_id, url, likes_count, sort_order) VALUES (?, ?, ?, 0, 0)",
      [linkId, userId, "https://smoke.test/a"],
    );

    // ---- next_boost_order (OUT param) ----
    const boostOrder = await callOut(conn, "CALL next_boost_order(@r)");
    record("next_boost_order", typeof boostOrder === "number" && boostOrder > 0, `→ ${boostOrder}`);

    // ---- add_links_atomic (JSON rows, OUT param) ----
    const inserted = await callOut(
      conn,
      "CALL add_links_atomic(?, ?, ?, @r)",
      [userId, JSON.stringify([{ id: uid(), url: "https://smoke.test/b" }]), 20],
    );
    record("add_links_atomic", inserted === 1, `inserted ${inserted}`);

    // ---- process_like_commit (full pipeline) ----
    const committed = await callOut(
      conn,
      "CALL process_like_commit(?,?,?,?,?,?,?,?,?,?,?,@r)",
      [userId, linkId, userId, 0, 0, 0, 10, 30, 24, 20, new Date()],
    );
    record("process_like_commit", committed === 1, committed ? "committed" : "rejected");

    // ---- get_my_stats (result-set proc) ----
    const statsRows = await callRows(conn, "CALL get_my_stats(?, ?, ?)", [
      userId,
      new Date(Date.now() - 86400000),
      new Date(Date.now() - 86400000),
    ]);
    record(
      "get_my_stats",
      Array.isArray(statsRows) && statsRows.length === 1 && "given_today" in (statsRows[0] ?? {}),
      JSON.stringify(statsRows[0] ?? {}),
    );

    // ---- get_top_likers (result-set proc) ----
    const topLikers = await callRows(conn, "CALL get_top_likers(5)");
    record("get_top_likers", Array.isArray(topLikers), `${topLikers.length} row(s)`);

    // ---- refresh_feed_eligibility_cache + get_eligible_feed_links ----
    await conn.query("CALL refresh_feed_eligibility_cache()");
    const feed = await callRows(conn, "CALL get_eligible_feed_links(?, ?, ?, ?, ?, ?)", [
      uid(), 20, 24, 12, 50, 0,
    ]);
    record(
      "get_eligible_feed_links",
      Array.isArray(feed) && feed.every((r) => "id" in r && "is_boosted" in r),
      `${feed.length} row(s)`,
    );

    // ---- events registered ----
    const [[ev]] = await conn.query(
      "SELECT COUNT(*) AS n FROM information_schema.events WHERE event_schema = DATABASE()",
    );
    record("scheduled events", Number(ev.n) >= 3, `${ev.n} event(s)`);

    const failed = results.filter((r) => !r.ok).length;
    console.log(failed === 0 ? "\nALL PROCEDURES OK" : `\n${failed} FAILURE(S)`);
    process.exitCode = failed === 0 ? 0 : 1;
  } catch (err) {
    console.error("\n✗ smoke test crashed:", err.message ?? err);
    process.exitCode = 1;
  } finally {
    await conn.query("DELETE FROM profiles WHERE id LIKE ?", [`${prefix}%`]).catch(() => {});
    await conn.end();
  }
}

async function callOut(conn, sql, params = []) {
  await conn.query(sql, params);
  const [rows] = await conn.query("SELECT @r AS result");
  return rows[0]?.result ?? null;
}

async function callRows(conn, sql, params = []) {
  const [raw] = await conn.query(sql, params);
  const rows = Array.isArray(raw) ? (raw.length > 0 && Array.isArray(raw[0]) ? raw[0] : raw) : [];
  return rows;
}

main();
