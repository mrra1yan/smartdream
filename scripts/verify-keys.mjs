/**
 * Verify the Supabase keys in .env.local actually work.
 * Run:  node scripts/verify-keys.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// load .env.local
try {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
} catch {}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log("\n=== ENV VALUES (first 25 chars) ===");
console.log("URL    :", URL);
console.log("ANON   :", ANON?.slice(0, 25), "...", ANON ? `(len=${ANON.length})` : "");
console.log("SERVICE:", SERVICE?.slice(0, 25), "...", SERVICE ? `(len=${SERVICE.length})` : "");

const issues = [];
if (!URL || URL.includes("your-project-id")) issues.push("NEXT_PUBLIC_SUPABASE_URL missing/placeholder");
if (!ANON || ANON.includes("your-anon")) issues.push("NEXT_PUBLIC_SUPABASE_ANON_KEY missing/placeholder");
if (!SERVICE || SERVICE.includes("your-service")) issues.push("SUPABASE_SERVICE_ROLE_KEY missing/placeholder");
// JWT structure check: service_role tokens contain ".service_role." pattern is NOT reliable,
// but they are JWTs with 3 dot-separated parts.
if (SERVICE && SERVICE.split(".").length !== 3) issues.push("SUPABASE_SERVICE_ROLE_KEY is not a valid JWT (should have 2 dots)");
if (ANON && ANON.split(".").length !== 3) issues.push("NEXT_PUBLIC_SUPABASE_ANON_KEY is not a valid JWT (should have 2 dots)");

if (issues.length) {
  console.log("\n❌ ISSUES:\n - " + issues.join("\n - ") + "\n");
  process.exit(1);
}

// Decode JWT payload to see what role it actually has.
function decodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64").toString());
  } catch (e) {
    return { error: e.message };
  }
}

const servicePayload = decodeJwt(SERVICE);
const anonPayload = decodeJwt(ANON);
console.log("\n=== JWT PAYLOADS ===");
console.log("SERVICE role:", servicePayload?.role);
console.log("ANON role   :", anonPayload?.role);
console.log("SERVICE ref :", servicePayload?.ref);
console.log("SERVICE iss :", servicePayload?.iss);

// Live test: try to read profiles with the service-role client.
console.log("\n=== LIVE TEST: read profiles with service-role key ===");
const client = createClient(URL, SERVICE, { auth: { persistSession: false } });
const { data, error } = await client.from("profiles").select("email").limit(1);
if (error) {
  console.log("❌ DB read failed:", error.message);
} else {
  console.log("✅ DB read OK. Sample rows:", data.length);
}

// Live test: admin listUsers.
console.log("\n=== LIVE TEST: auth.admin.listUsers ===");
const { data: users, error: usersErr } = await client.auth.admin.listUsers();
if (usersErr) {
  console.log("❌ listUsers failed:", JSON.stringify(usersErr));
} else {
  console.log(`✅ listUsers OK. Total users: ${users.users.length}`);
  for (const u of users.users) console.log("   -", u.email);
}
