/**
 * Create demo users via the OFFICIAL Supabase Admin API (reliable).
 *
 * Why a script instead of SQL? Writing directly into auth.users via SQL is
 * fragile — Supabase Auth reads many internal columns (instance_id, encrypted_password
 * format, raw_app_meta_data, etc.) that are easy to get wrong, causing
 * "Invalid login credentials" even when the row exists. The Admin API handles
 * all of that correctly.
 *
 * USAGE:
 *   1. npm i -D dotenv  (skip if already installed; we read .env.local)
 *   2. Make sure .env.local has real NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   3. node scripts/seed-users.mjs
 *
 * Creates 5 users (idempotent — updates existing users):
 *   superadmin@smartdream.app  super_admin
 *   admin@smartdream.app       admin
 *   elite@smartdream.app       user (is_elite)
 *   user1@smartdream.app       user
 *   user2@smartdream.app       user
 *
 * Password for all: Password123!  (change PASSWORD below)
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// --- Load .env.local manually (no dotenv dependency) ---
function loadEnvLocal() {
  try {
    const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2];
    }
  } catch {
    // ignore — env may come from the shell
  }
}
loadEnvLocal();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Password123!";

if (!URL || !KEY || URL.includes("your-project-id") || KEY.includes("your-service")) {
  console.error(
    "\n❌ Missing or placeholder env vars.\n" +
      "   Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local first.\n",
  );
  process.exit(1);
}

const supabase = createClient(URL, KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const USERS = [
  { email: "superadmin@smartdream.app", role: "super_admin", status: "approved", is_elite: false, first_name: "Super", last_name: "Admin" },
  { email: "admin@smartdream.app",      role: "admin",       status: "approved", is_elite: false, first_name: "Test",  last_name: "Admin" },
  { email: "elite@smartdream.app",      role: "user",        status: "approved", is_elite: true,  first_name: "Elite", last_name: "User" },
  { email: "user1@smartdream.app",      role: "user",        status: "approved", is_elite: false, first_name: "Regular", last_name: "One" },
  { email: "user2@smartdream.app",      role: "user",        status: "approved", is_elite: false, first_name: "Regular", last_name: "Two" },
];

async function upsertProfile(user, userId) {
  const publicId = String(Math.floor(Math.random() * 90000000) + 10000000);
  const { error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: userId,
        public_id: publicId,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: "",
        email: user.email,
        role: user.role,
        status: user.status,
        is_elite: user.is_elite,
        is_boosted: false,
        boost_model: "none",
        auto_like_enabled: false,
        auto_like_model: "none",
        auto_like_used: 0,
        boosted_offer_count: 0,
      },
      { onConflict: "id" },
    );
  if (error) throw new Error(`profile upsert failed for ${user.email}: ${error.message}`);
}

async function main() {
  console.log(`\n🔗 Supabase: ${URL}`);
  console.log(`🔑 Password for all users: ${PASSWORD}\n`);

  for (const user of USERS) {
    // Look up existing auth user by email.
    const { data: list, error: listErr } = await supabase.auth.admin.listUsers();
    if (listErr) throw new Error(`listUsers failed: ${JSON.stringify(listErr)}`);
    const existing = (list?.users ?? []).find(
      (u) => u.email?.toLowerCase() === user.email.toLowerCase(),
    );

    let userId;

    if (existing) {
      // Update password + metadata on the existing user.
      const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
        password: PASSWORD,
        email_confirm: true,
        user_metadata: {
          first_name: user.first_name,
          last_name: user.last_name,
          phone: "",
          role: user.role,
          status: user.status,
        },
      });
      if (error) throw new Error(`update ${user.email}: ${JSON.stringify(error)}`);
      userId = data.user.id;
      console.log(`🔄 updated  ${user.email}  (${user.role})`);
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: user.email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: {
          first_name: user.first_name,
          last_name: user.last_name,
          phone: "",
          role: user.role,
          status: user.status,
        },
      });
      if (error) throw new Error(`create ${user.email}: ${JSON.stringify(error)}`);
      userId = data.user.id;
      console.log(`✅ created  ${user.email}  (${user.role})`);
    }

    await upsertProfile(user, userId);
  }

  console.log("\n🎉 All users ready. Log in with: <email> / " + PASSWORD + "\n");
}

main().catch((e) => {
  console.error("\n❌ " + e.message + "\n");
  process.exit(1);
});
