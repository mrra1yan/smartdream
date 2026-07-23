/**
 * Verify profiles rows exist for all demo users with correct role/status.
 * Run: node scripts/check-profiles.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

try {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
} catch {}

const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data, error } = await client
  .from("profiles")
  .select("email, role, status, is_elite, public_id")
  .ilike("email", "%@smartdream.app")
  .order("email");

if (error) {
  console.log("❌ Error:", error.message);
  process.exit(1);
}

console.log("\n=== PROFILES ===");
console.log("email".padEnd(30), "role".padEnd(13), "status".padEnd(10), "elite".padEnd(6), "public_id");
console.log("-".repeat(90));
for (const p of data) {
  console.log(
    p.email.padEnd(30),
    (p.role ?? "-").padEnd(13),
    (p.status ?? "-").padEnd(10),
    String(p.is_elite ?? false).padEnd(6),
    p.public_id ?? "-",
  );
}
console.log("\nTotal:", data.length, "demo profiles");
