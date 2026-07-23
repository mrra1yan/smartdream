/**
 * Check the project's Auth settings (email confirmation, providers, etc).
 * Uses the Supabase Management API — needs the PROJECT REF + a PAT, OR falls
 * back to probing the public auth config endpoint.
 *
 * Run: node scripts/check-auth-settings.mjs
 */
import { readFileSync } from "node:fs";

try {
  const text = readFileSync(".env.local", "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
} catch {}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

// The public settings endpoint exposes whether email confirmation is enabled.
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log("Probing:", URL + "/auth/v1/settings\n");
try {
  const r = await fetch(URL + "/auth/v1/settings", {
    headers: { apikey: ANON, Authorization: "Bearer " + ANON },
  });
  console.log("HTTP status:", r.status);
  const body = await r.json();
  console.log(JSON.stringify(body, null, 2));
} catch (e) {
  console.log("Error:", e.message);
}
