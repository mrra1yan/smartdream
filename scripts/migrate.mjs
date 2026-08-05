#!/usr/bin/env node
/**
 * Minimal MySQL migration runner for SmartDream.
 *
 *   node scripts/migrate.mjs up       # apply pending migrations
 *   node scripts/migrate.mjs status   # list applied/pending
 *   node scripts/migrate.mjs create <name>   # scaffold db/migrations/NNNN_name.sql
 *
 * Reads numbered .sql files from db/migrations/, tracks them in the
 * `schema_migrations` table, and runs each in order. Handles `DELIMITER`
 * blocks (required for CREATE EVENT/PROCEDURE/TRIGGER in mysql2, which
 * speaks the wire protocol and has no client-side DELIMITER support).
 */
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "mysql2/promise";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

const config = {
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? "smartdream",
  password: process.env.MYSQL_PASSWORD ?? "smartdream_dev_password",
  database: process.env.MYSQL_DATABASE ?? "smartdream",
  multipleStatements: false,
  charset: "utf8mb4",
};

/**
 * Split a .sql file into executable statements, honoring DELIMITER blocks.
 * mysql2 sends one statement per execute(), so multi-statement bodies
 * (events/procedures/triggers) must be extracted as single statements.
 */
function splitStatements(sql) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";
  const lines = sql.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    const delimMatch = trimmed.match(/^DELIMITER\s+(\S+)\s*$/i);
    if (delimMatch) {
      // Flush whatever accumulated under the previous delimiter first.
      if (buffer.trim()) {
        statements.push(buffer.trim());
        buffer = "";
      }
      delimiter = delimMatch[1];
      continue;
    }

    const idx = line.indexOf(delimiter);
    if (idx !== -1) {
      buffer += line.slice(0, idx) + "\n";
      if (buffer.trim()) statements.push(buffer.trim());
      buffer = "";
    } else {
      buffer += line + "\n";
    }
  }
  if (buffer.trim()) statements.push(buffer.trim());
  return statements.filter((s) => s.length > 0);
}

async function listMigrations() {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  const applied = new Set(
    (
      await readdir(MIGRATIONS_DIR).catch(() => [])
    ).length
      ? await getApplied()
      : [],
  );
  return { files, applied };
}

async function getApplied() {
  const conn = await createConnection(config);
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const [rows] = await conn.query("SELECT name FROM schema_migrations");
    return rows.map((r) => r.name);
  } finally {
    await conn.end();
  }
}

async function applyMigration(conn, name) {
  const sql = await readFile(path.join(MIGRATIONS_DIR, name), "utf8");
  const statements = splitStatements(sql);
  for (const stmt of statements) {
    await conn.query(stmt);
  }
  await conn.query("INSERT INTO schema_migrations (name) VALUES (?)", [name]);
  console.log(`  applied  ${name}`);
}

async function main() {
  const [cmd, extra] = process.argv.slice(2);

  if (cmd === "create") {
    if (!extra) {
      console.error("usage: node scripts/migrate.mjs create <name>");
      process.exit(1);
    }
    const existing = await readdir(MIGRATIONS_DIR).catch(() => []);
    const next = String(existing.length + 1).padStart(4, "0");
    const file = `${next}_${extra.replace(/[^a-zA-Z0-9_-]/g, "_")}.sql`;
    await writeFile(path.join(MIGRATIONS_DIR, file), "-- new migration\n");
    console.log(`created ${file}`);
    return;
  }

  if (cmd === "status") {
    const applied = await getApplied();
    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => /^\d+_.+\.sql$/.test(f))
      .sort();
    for (const f of files) {
      console.log(`  ${applied.includes(f) ? "[x]" : "[ ]"}  ${f}`);
    }
    return;
  }

  if (cmd !== "up") {
    console.error("usage: node scripts/migrate.mjs <up|status|create>");
    process.exit(1);
  }

  const applied = await getApplied();
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  const pending = files.filter((f) => !applied.includes(f));
  if (pending.length === 0) {
    console.log("no pending migrations");
    return;
  }

  const conn = await createConnection({ ...config, multipleStatements: false });
  try {
    for (const name of pending) {
      await applyMigration(conn, name);
    }
    console.log(`done — ${pending.length} migration(s) applied`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("migration failed:", err.message ?? err);
  process.exit(1);
});
