
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function check() {
  console.log("Checking RPC...");
  const now = new Date();
  const windowIso = new Date(now.getTime() - 15 * 60000).toISOString();
  const minus24hIso = new Date(now.getTime() - 24 * 3600000).toISOString();

  const { data, error } = await supabase.rpc("get_feed_user_stats", {
    window_iso: windowIso,
    minus24h_iso: minus24hIso,
  });

  if (error) {
    console.error("RPC ERROR:", error);
  } else {
    console.log("RPC SUCCESS. Rows:", data?.length);
  }
}

check();
