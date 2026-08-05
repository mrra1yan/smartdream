#!/usr/bin/env node
/**
 * PostgreSQL setup runner for SmartDream.
 *
 *   node scripts/setup.mjs       # runs db/setup.sql
 *
 * Reads DATABASE_URL from .env.local / environment.
 * db/setup.sql is idempotent (IF NOT EXISTS / OR REPLACE / ON CONFLICT DO NOTHING)
 * so it's safe to run multiple times.
 *
 * Requirements:
 *   - PostgreSQL 16 running (local or Docker: npm run db:up)
 *   - pg package (already in package.json dependencies)
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SETUP_SQL = path.join(ROOT, "db", "setup.sql");

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://smartdream:smartdream_dev_password@127.0.0.1:5432/smartdream";

async function main() {
  const sql = await readFile(SETUP_SQL, "utf8");
  console.log(`Running db/setup.sql (${(sql.length / 1024).toFixed(1)} KB)...`);

  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    await client.query(sql);
    console.log("✓ Database setup complete!");
    console.log("");
    console.log("Tables:   profiles, links, likes, blogs, settings, audit_log, feed_eligibility_cache");
    console.log("Functions: add_links_atomic, get_my_stats, get_top_likers,");
    console.log("          refresh_feed_eligibility_cache, get_eligible_feed_links,");
    console.log("          process_like_commit");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("setup failed:", err.message ?? err);
  process.exit(1);
});
