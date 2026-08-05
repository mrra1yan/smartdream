#!/usr/bin/env node
/**
 * One-time data migration: Supabase (PostgREST, service-role) → MySQL.
 *
 *   node scripts/migrate-data.mjs
 *
 * Requires env (see .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   — the OLD Supabase
 *   MYSQL_* / REDIS_URL                                    — the NEW MySQL
 *
 * Password handling: Supabase Auth hashes (GoTrue bcrypt, $2a$/$2b$) are
 * directly compatible with bcryptjs. They are NOT exposed via the REST API,
 * so the script leaves password_hash NULL by default. To import real
 * passwords, export them from the Supabase dashboard SQL editor:
 *
 *   SELECT id, email, encrypted_password FROM auth.users;
 *
 *   save as CSV (header row: id,email,encrypted_password) at
 *   supabase-auth-users.csv, re-run this script, and every imported user's
 *   existing password keeps working. Without it, existing users must have a
 *   new password set by an admin (admin panel → reset password).
 *
 * The script is idempotent per run only if the target tables are empty —
 * run it ONCE on a fresh MySQL database (right after `migrate.mjs up`).
 */

import { readFile } from "node:fs/promises";
import { createConnection } from "mysql2/promise";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MYSQL = {
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? "smartdream",
  password: process.env.MYSQL_PASSWORD ?? "smartdream_dev_password",
  database: process.env.MYSQL_DATABASE ?? "smartdream",
  timezone: "Z",
  charset: "utf8mb4",
};

const PAGE_SIZE = 1000;

async function fetchAll(table, select = "*") {
  const rows = [];
  let offset = 0;
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=${PAGE_SIZE}&offset=${offset}&order=created_at.asc`;
    const res = await fetch(url, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    });
    if (!res.ok) {
      throw new Error(`GET ${table} failed: ${res.status} ${await res.text()}`);
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

/** ISO string → Date for DATETIME binding (or null). */
function dt(iso) {
  if (iso == null || iso === "") return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function bool(v) {
  return v ? 1 : 0;
}

async function loadPasswordMap() {
  try {
    const csv = await readFile("supabase-auth-users.csv", "utf8");
    const map = new Map();
    const lines = csv.trim().split(/\r?\n/);
    if (lines[0]?.toLowerCase().includes("encrypted_password")) lines.shift();
    for (const line of lines) {
      const [id, email, hash] = line.split(",");
      if (id && hash) map.set(id.trim(), hash.trim());
    }
    console.log(`  loaded ${map.size} password hash(es) from supabase-auth-users.csv`);
    return map;
  } catch {
    return new Map();
  }
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (still needed for the old Supabase).");
    process.exit(1);
  }

  const conn = await createConnection(MYSQL);
  const passwords = await loadPasswordMap();

  try {
    console.log("Fetching from Supabase…");
    const [profiles, links, likes, blogs, settingsRows, auditRows] = await Promise.all([
      fetchAll("profiles"),
      fetchAll("links"),
      fetchAll("likes"),
      fetchAll("blogs"),
      fetchAll("settings"),
      fetchAll("audit_log"),
    ]);
    console.log(`  profiles=${profiles.length} links=${links.length} likes=${likes.length} blogs=${blogs.length} settings=${settingsRows.length} audit=${auditRows.length}`);

    await conn.query("SET FOREIGN_KEY_CHECKS = 0");

    // profiles (self-referencing via referred_by/approved_by — order doesn't
    // matter with FK checks off).
    for (const r of profiles) {
      await conn.query(
        `INSERT INTO profiles (id, public_id, first_name, last_name, phone, email, password_hash,
           role, status, is_elite, is_boosted, boost_order, boost_model, boost_expiry, boost_quota,
           boost_used, auto_like_enabled, auto_like_model, auto_like_expiry, auto_like_quota,
           auto_like_used, free_autolike_until, auto_like_paused, auto_like_paused_remaining_minutes,
           free_autolike_paused_remaining_minutes, boosted_offer_count, referred_by, approved_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          r.id, r.public_id ?? null, r.first_name ?? null, r.last_name ?? null, r.phone ?? null,
          r.email ?? null, passwords.get(r.id) ?? null,
          r.role ?? "user", r.status ?? "pending",
          bool(r.is_elite), bool(r.is_boosted), r.boost_order ?? null, r.boost_model ?? "none",
          dt(r.boost_expiry), r.boost_quota ?? null, r.boost_used ?? 0,
          bool(r.auto_like_enabled), r.auto_like_model ?? "none", dt(r.auto_like_expiry),
          r.auto_like_quota ?? null, r.auto_like_used ?? 0, dt(r.free_autolike_until),
          bool(r.auto_like_paused), r.auto_like_paused_remaining_minutes ?? null,
          r.free_autolike_paused_remaining_minutes ?? null, r.boosted_offer_count ?? 0,
          r.referred_by ?? null, r.approved_by ?? null, dt(r.created_at) ?? new Date(),
        ],
      );
    }
    console.log("  profiles imported");

    for (const r of links) {
      await conn.query(
        `INSERT INTO links (id, user_id, url, likes_count, sort_order, created_at)
         VALUES (?,?,?,?,?,?)`,
        [r.id, r.user_id, r.url ?? "", r.likes_count ?? 0, r.sort_order ?? 0, dt(r.created_at) ?? new Date()],
      );
    }
    console.log("  links imported");

    for (const r of likes) {
      await conn.query(
        `INSERT INTO likes (id, liker_id, link_id, receiver_id, is_anonymous, is_boosted_like, created_at)
         VALUES (?,?,?,?,?,?,?)`,
        [r.id, r.liker_id ?? null, r.link_id ?? null, r.receiver_id, bool(r.is_anonymous), bool(r.is_boosted_like), dt(r.created_at) ?? new Date()],
      );
    }
    console.log("  likes imported");

    for (const r of blogs) {
      await conn.query(
        `INSERT INTO blogs (id, title, slug, excerpt, content, hero_image, published_at, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [r.id, r.title ?? "", r.slug ?? "", r.excerpt ?? null, r.content ?? null, r.hero_image ?? null, dt(r.published_at), r.created_by ?? null, dt(r.created_at) ?? new Date()],
      );
    }
    console.log("  blogs imported");

    for (const r of settingsRows) {
      const cols = Object.keys(r);
      const vals = cols.map((c) =>
        typeof r[c] === "boolean" ? (r[c] ? 1 : 0) : r[c] === null ? null : r[c],
      );
      await conn.query(
        `INSERT INTO settings (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
        vals,
      );
    }
    console.log("  settings imported");

    for (const r of auditRows) {
      await conn.query(
        `INSERT INTO audit_log (id, actor_id, actor_role, action, target_id, metadata, created_at)
         VALUES (?,?,?,?,?,?,?)`,
        [r.id, r.actor_id ?? null, r.actor_role ?? null, r.action, r.target_id ?? null, r.metadata ? JSON.stringify(r.metadata) : null, dt(r.created_at) ?? new Date()],
      );
    }
    console.log("  audit_log imported");

    await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    console.log("Done.");
    if (passwords.size === 0) {
      console.warn("\nNOTE: no password hashes imported — existing users must get a new\n" +
        "password via the admin panel (reset password). To import real\n" +
        "passwords, export auth.users (id,email,encrypted_password) to\n" +
        "supabase-auth-users.csv from the Supabase dashboard and re-run.\n");
    }
  } catch (err) {
    console.error("migration failed:", err.message ?? err);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

main();
