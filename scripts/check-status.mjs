import pg from "pg";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://smartdream:smartdream_dev_password@127.0.0.1:5432/smartdream";

async function main() {
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    console.log("--- PROFILES ---");
    const { rows: profiles } = await pool.query(
      "SELECT id, public_id, first_name, last_name, role, status, is_elite, is_boosted, auto_like_enabled, auto_like_paused FROM profiles LIMIT 10;"
    );
    console.table(profiles);

    console.log("--- LINKS ---");
    const { rows: links } = await pool.query(
      "SELECT id, user_id, url, likes_count, sort_order FROM links LIMIT 10;"
    );
    console.table(links);

    console.log("--- LIKES ---");
    const { rows: likes } = await pool.query(
      "SELECT id, liker_id, link_id, receiver_id, is_anonymous, is_boosted_like, created_at FROM likes ORDER BY created_at DESC LIMIT 10;"
    );
    console.table(likes);

    console.log("--- FEED ELIGIBILITY CACHE ---");
    const { rows: cache } = await pool.query(
      "SELECT * FROM feed_eligibility_cache LIMIT 10;"
    );
    console.table(cache);

    console.log("--- LIKES COUNT PER RECEIVER ---");
    const { rows: groupRecv } = await pool.query(
      "SELECT receiver_id, COUNT(*) FROM likes GROUP BY receiver_id;"
    );
    console.table(groupRecv);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
