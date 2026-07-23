/**
 * Live test: simulate what the admin "Reset password" action does.
 * Uses the admin client's auth.admin.updateUserById — same code path as
 * src/app/actions/admin.ts::resetPassword.
 *
 * Run: node scripts/test-reset-password.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

try {
  const text = readFileSync(".env.local", "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
} catch {}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anon = createClient(URL, ANON);

// 1. Find user1's id
const { data: users } = await admin.auth.admin.listUsers();
const user1 = users.users.find((u) => u.email === "user1@smartdream.app");
if (!user1) {
  console.log("❌ user1 not found");
  process.exit(1);
}
console.log("✅ Found user1, id:", user1.id);

// 2. Reset password via admin (same as resetPassword action)
const NEW_PW = "NewPass456!";
const { error: resetErr } = await admin.auth.admin.updateUserById(user1.id, {
  password: NEW_PW,
});
if (resetErr) {
  console.log("❌ Reset failed:", JSON.stringify(resetErr));
  process.exit(1);
}
console.log(`✅ Password reset to "${NEW_PW}" via admin`);

// 3. Verify the new password works (login)
const { data: loginData, error: loginErr } = await anon.auth.signInWithPassword({
  email: "user1@smartdream.app",
  password: NEW_PW,
});
if (loginErr) {
  console.log("❌ Login with new password failed:", loginErr.message);
} else {
  console.log("✅ Login with new password works!");
}

// 4. Restore original password
await admin.auth.admin.updateUserById(user1.id, { password: "Password123!" });
console.log("✅ Restored to original password (Password123!)");
