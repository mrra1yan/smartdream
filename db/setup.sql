-- =============================================================================
-- SmartDream — PostgreSQL 16 Complete Setup SQL
-- সব tables, indexes, functions, sequences এক জায়গায়।
--
-- কিভাবে run করবে:
--   psql -U smartdream -d smartdream -f db/setup.sql
-- অথবা Docker দিয়ে:
--   docker exec -i smartdream-postgres psql -U smartdream -d smartdream -f /dev/stdin < db/setup.sql
-- =============================================================================

SET timezone = 'UTC';

-- =============================================================================
-- EXTENSIONS
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- =============================================================================
-- SEQUENCES
-- =============================================================================

-- boost_order sequence (replaces MySQL AUTO_INCREMENT table hack)
CREATE SEQUENCE IF NOT EXISTS boost_order_seq START 1 INCREMENT 1;

-- =============================================================================
-- TABLES
-- =============================================================================

-- ---- profiles ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id                                        UUID            PRIMARY KEY,
  public_id                                 VARCHAR(20)     NULL,
  first_name                                VARCHAR(100)    NULL,
  last_name                                 VARCHAR(100)    NULL,
  phone                                     VARCHAR(50)     NULL,
  email                                     VARCHAR(255)    NULL,
  password_hash                             VARCHAR(100)    NULL,
  role                                      VARCHAR(20)     NOT NULL DEFAULT 'user',
  status                                    VARCHAR(20)     NOT NULL DEFAULT 'pending',
  is_elite                                  BOOLEAN         NOT NULL DEFAULT FALSE,
  is_boosted                                BOOLEAN         NOT NULL DEFAULT FALSE,
  boost_order                               INTEGER         NULL,
  boost_model                               VARCHAR(20)     NOT NULL DEFAULT 'none',
  boost_expiry                              TIMESTAMPTZ     NULL,
  boost_quota                               INTEGER         NULL,
  boost_used                                INTEGER         NOT NULL DEFAULT 0,
  auto_like_enabled                         BOOLEAN         NOT NULL DEFAULT FALSE,
  auto_like_model                           VARCHAR(20)     NOT NULL DEFAULT 'none',
  auto_like_expiry                          TIMESTAMPTZ     NULL,
  auto_like_quota                           INTEGER         NULL,
  auto_like_used                            INTEGER         NOT NULL DEFAULT 0,
  free_autolike_until                       TIMESTAMPTZ     NULL,
  auto_like_paused                          BOOLEAN         NOT NULL DEFAULT FALSE,
  auto_like_paused_remaining_minutes        INTEGER         NULL,
  free_autolike_paused_remaining_minutes    INTEGER         NULL,
  boosted_offer_count                       INTEGER         NOT NULL DEFAULT 0,
  referred_by                               UUID            NULL REFERENCES profiles(id) ON DELETE SET NULL,
  approved_by                               UUID            NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at                                TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Unique phone (NULLs allowed, duplicates on NULLs OK in PG partial unique)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_unique
  ON profiles (phone) WHERE phone IS NOT NULL AND phone <> '';

-- Unique email (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique
  ON profiles (LOWER(email)) WHERE email IS NOT NULL AND email <> '';

CREATE INDEX IF NOT EXISTS profiles_email_idx        ON profiles (email);
CREATE INDEX IF NOT EXISTS profiles_phone_idx        ON profiles (phone);
CREATE INDEX IF NOT EXISTS profiles_public_id_idx    ON profiles (public_id);
CREATE INDEX IF NOT EXISTS profiles_status_role_elite_idx ON profiles (status, role, is_elite);
CREATE INDEX IF NOT EXISTS profiles_referred_by_idx  ON profiles (referred_by);
CREATE INDEX IF NOT EXISTS profiles_is_elite_idx     ON profiles (is_elite);
CREATE INDEX IF NOT EXISTS profiles_is_boosted_order_idx ON profiles (is_boosted, boost_order);

-- ---- links ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS links (
  id          UUID        PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  url         TEXT        NULL,
  likes_count INTEGER     NOT NULL DEFAULT 0,
  sort_order  BIGINT      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_links_user_id   ON links (user_id);
CREATE INDEX IF NOT EXISTS idx_links_user_sort ON links (user_id, sort_order);

-- ---- likes ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS likes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  liker_id        UUID        NULL REFERENCES profiles(id) ON DELETE SET NULL,
  link_id         UUID        NULL REFERENCES links(id)    ON DELETE CASCADE,
  receiver_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_anonymous    BOOLEAN     NOT NULL DEFAULT FALSE,
  is_boosted_like BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_likes_receiver_id            ON likes (receiver_id);
CREATE INDEX IF NOT EXISTS idx_likes_liker_id               ON likes (liker_id);
CREATE INDEX IF NOT EXISTS idx_likes_liker_created_at       ON likes (liker_id, created_at);
CREATE INDEX IF NOT EXISTS idx_likes_receiver_created_at    ON likes (receiver_id, created_at);
CREATE INDEX IF NOT EXISTS idx_likes_liker_link_created     ON likes (liker_id, link_id, created_at);
CREATE INDEX IF NOT EXISTS idx_likes_receiver_boosted       ON likes (receiver_id, is_boosted_like);

-- ---- blogs ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blogs (
  id           UUID        PRIMARY KEY,
  title        VARCHAR(255) NULL,
  slug         VARCHAR(255) NULL,
  excerpt      TEXT        NULL,
  content      TEXT        NULL,
  hero_image   TEXT        NULL,
  published_at TIMESTAMPTZ NULL,
  created_by   UUID        NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS blogs_slug_unique    ON blogs (slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS blogs_created_by_idx        ON blogs (created_by);
CREATE INDEX IF NOT EXISTS blogs_published_at_idx      ON blogs (published_at);
CREATE INDEX IF NOT EXISTS blogs_created_at_idx        ON blogs (created_at);

-- ---- settings ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  id                                  VARCHAR(20)  PRIMARY KEY,
  whatsapp_number                     TEXT         NULL,
  active_like_count                   INTEGER      NOT NULL DEFAULT 0,
  active_window_hours                 INTEGER      NOT NULL DEFAULT 24,
  elite_weight                        INTEGER      NOT NULL DEFAULT 50,
  offer_likes_required                INTEGER      NOT NULL DEFAULT 100,
  offer_autolike_minutes              INTEGER      NOT NULL DEFAULT 60,
  offer_active                        BOOLEAN      NOT NULL DEFAULT FALSE,
  boost_price_no_expiry               INTEGER      NULL,
  boost_price_1w                      INTEGER      NULL,
  boost_price_1m                      INTEGER      NULL,
  boost_price_3m                      INTEGER      NULL,
  boost_price_6m                      INTEGER      NULL,
  boost_price_1y                      INTEGER      NULL,
  boost_price_usage_per_unit          INTEGER      NULL,
  autolike_price_no_expiry            INTEGER      NULL,
  autolike_price_1w                   INTEGER      NULL,
  autolike_price_1m                   INTEGER      NULL,
  autolike_price_3m                   INTEGER      NULL,
  autolike_price_6m                   INTEGER      NULL,
  autolike_price_1y                   INTEGER      NULL,
  autolike_price_usage_per_unit       INTEGER      NULL,
  referral_reward_referrer_minutes    INTEGER      NOT NULL DEFAULT 1440,
  referral_reward_referee_minutes     INTEGER      NOT NULL DEFAULT 720,
  level1_name                         VARCHAR(50)  NULL,
  level1_threshold                    INTEGER      NULL,
  level2_name                         VARCHAR(50)  NULL,
  level2_threshold                    INTEGER      NULL,
  level3_name                         VARCHAR(50)  NULL,
  level3_threshold                    INTEGER      NULL,
  level4_name                         VARCHAR(50)  NULL,
  level4_threshold                    INTEGER      NULL,
  created_at                          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO settings (id) VALUES ('1') ON CONFLICT (id) DO NOTHING;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_settings_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS settings_updated_at ON settings;
CREATE TRIGGER settings_updated_at
  BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION update_settings_updated_at();

-- ---- audit_log --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID        NULL REFERENCES profiles(id) ON DELETE SET NULL,
  actor_role  VARCHAR(20) NULL,
  action      VARCHAR(255) NOT NULL,
  target_id   UUID        NULL,
  metadata    JSONB       NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx      ON audit_log (actor_id);

-- ---- feed_eligibility_cache -------------------------------------------------
CREATE TABLE IF NOT EXISTS feed_eligibility_cache (
  user_id      UUID        PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  is_elite     BOOLEAN     NOT NULL DEFAULT FALSE,
  is_boosted   BOOLEAN     NOT NULL DEFAULT FALSE,
  boost_order  INTEGER     NULL,
  is_slowdown  BOOLEAN     NOT NULL DEFAULT FALSE,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- PL/pgSQL FUNCTIONS (replaces MySQL stored procedures)
-- =============================================================================

-- ---- add_links_atomic() -----------------------------------------------------
CREATE OR REPLACE FUNCTION add_links_atomic(
  p_user_id   UUID,
  p_rows      JSONB,
  p_max_links INTEGER
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lock_key  BIGINT;
  v_existing  INTEGER;
  v_remaining INTEGER;
  v_next_sort INTEGER;
  v_inserted  INTEGER := 0;
  v_n         INTEGER;
  v_i         INTEGER := 0;
  v_id        UUID;
  v_url       TEXT;
BEGIN
  v_lock_key := hashtext(p_user_id::text);

  IF NOT pg_try_advisory_lock(v_lock_key) THEN
    RETURN 0;
  END IF;

  BEGIN
    SELECT COUNT(*) INTO v_existing
    FROM links WHERE user_id = p_user_id AND sort_order >= 0;

    v_remaining := GREATEST(p_max_links - v_existing, 0);
    v_next_sort := v_existing;
    v_n := jsonb_array_length(p_rows);

    WHILE v_i < v_n AND v_remaining > 0 LOOP
      v_id  := (p_rows->v_i->>'id')::UUID;
      v_url := p_rows->v_i->>'url';

      INSERT INTO links (id, user_id, url, likes_count, sort_order, created_at)
      VALUES (v_id, p_user_id, v_url, 0, v_next_sort, NOW());

      v_next_sort := v_next_sort + 1;
      v_remaining := v_remaining - 1;
      v_inserted  := v_inserted + 1;
      v_i         := v_i + 1;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_advisory_unlock(v_lock_key);
    RAISE;
  END;

  PERFORM pg_advisory_unlock(v_lock_key);
  RETURN v_inserted;
END;
$$;

-- ---- get_my_stats() ---------------------------------------------------------
CREATE OR REPLACE FUNCTION get_my_stats(
  p_viewer_id    UUID,
  p_today_iso    TIMESTAMPTZ,
  p_minus24h_iso TIMESTAMPTZ
) RETURNS TABLE(
  given_today    BIGINT,
  received_today BIGINT,
  given_24h      BIGINT,
  received_24h   BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY SELECT
    (SELECT COUNT(*) FROM likes WHERE liker_id    = p_viewer_id AND created_at >= p_today_iso),
    (SELECT COUNT(*) FROM likes WHERE receiver_id = p_viewer_id AND created_at >= p_today_iso AND NOT is_boosted_like),
    (SELECT COUNT(*) FROM likes WHERE liker_id    = p_viewer_id AND created_at >= p_minus24h_iso),
    (SELECT COUNT(*) FROM likes WHERE receiver_id = p_viewer_id AND created_at >= p_minus24h_iso AND NOT is_boosted_like);
END;
$$;

-- ---- get_top_likers() -------------------------------------------------------
CREATE OR REPLACE FUNCTION get_top_likers(p_limit INTEGER)
RETURNS TABLE(
  id          UUID,
  public_id   VARCHAR,
  first_name  VARCHAR,
  last_name   VARCHAR,
  email       VARCHAR,
  likes_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.public_id, p.first_name, p.last_name, p.email,
         COUNT(l.id) AS likes_count
  FROM profiles p
  LEFT JOIN likes l ON l.liker_id = p.id
  WHERE NOT p.is_elite AND p.role = 'user'
  GROUP BY p.id
  ORDER BY likes_count DESC
  LIMIT p_limit;
END;
$$;

-- ---- refresh_feed_eligibility_cache() ---------------------------------------
CREATE OR REPLACE FUNCTION refresh_feed_eligibility_cache()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_active_like_count   INTEGER;
  v_active_window_hours INTEGER;
  v_window_start        TIMESTAMPTZ;
BEGIN
  SELECT active_like_count, active_window_hours
    INTO v_active_like_count, v_active_window_hours
  FROM settings LIMIT 1;

  v_window_start := NOW() - (v_active_window_hours || ' hours')::INTERVAL;

  DELETE FROM feed_eligibility_cache;

  INSERT INTO feed_eligibility_cache (user_id, is_elite, is_boosted, boost_order, is_slowdown, refreshed_at)
  WITH posters AS (
    SELECT DISTINCT user_id FROM links WHERE sort_order >= 0
  ),
  user_stats AS (
    SELECT
      p.id AS user_id,
      p.is_elite,
      p.is_boosted,
      p.boost_order,
      p.created_at AS profile_created_at,
      COALESCE(g.given_24h, 0) AS given_24h,
      COALESCE(r.recv_24h, 0)  AS recv_24h,
      COALESCE(r.recv_total, 0) AS recv_total
    FROM posters po
    JOIN profiles p ON p.id = po.user_id
    LEFT JOIN (
      SELECT liker_id, COUNT(*) AS given_24h
      FROM likes
      WHERE created_at >= v_window_start
        AND liker_id IN (SELECT user_id FROM posters)
      GROUP BY liker_id
    ) g ON g.liker_id = p.id
    LEFT JOIN (
      SELECT receiver_id,
             SUM(CASE WHEN created_at >= v_window_start THEN 1 ELSE 0 END) AS recv_24h,
             COUNT(*) AS recv_total
      FROM likes
      WHERE NOT is_boosted_like
        AND receiver_id IN (SELECT user_id FROM posters)
      GROUP BY receiver_id
    ) r ON r.receiver_id = p.id
  )
  SELECT
    us.user_id,
    us.is_elite,
    us.is_boosted,
    us.boost_order,
    CASE
      WHEN us.given_24h > 0 AND (us.recv_24h::FLOAT / us.given_24h) >= 0.9 THEN TRUE
      ELSE FALSE
    END AS is_slowdown,
    NOW()
  FROM user_stats us
  WHERE us.is_elite
     OR us.is_boosted
     OR (EXTRACT(EPOCH FROM (NOW() - us.profile_created_at)) < 86400 AND us.recv_total < v_active_like_count)
     OR (us.given_24h >= v_active_like_count AND NOT (us.given_24h > 0 AND us.recv_24h >= us.given_24h));
END;
$$;

-- ---- get_eligible_feed_links() ----------------------------------------------
CREATE OR REPLACE FUNCTION get_eligible_feed_links(
  p_viewer_id          UUID,
  p_active_like_count  INTEGER,
  p_active_window_hours INTEGER,
  p_cooldown_hours     INTEGER,
  p_limit              INTEGER,
  p_offset             INTEGER
) RETURNS TABLE(
  id          UUID,
  url         TEXT,
  likes_count INTEGER,
  anonymous   BOOLEAN,
  is_boosted  BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cooldown_start TIMESTAMPTZ;
BEGIN
  v_cooldown_start := NOW() - (p_cooldown_hours || ' hours')::INTERVAL;

  RETURN QUERY
  WITH eligible_links AS (
    SELECT l.id, l.url, l.likes_count, l.user_id, l.created_at
    FROM links l
    WHERE l.sort_order >= 0
      AND l.user_id <> p_viewer_id
      AND NOT EXISTS (
        SELECT 1 FROM likes lk
        WHERE lk.liker_id = p_viewer_id
          AND lk.link_id = l.id
          AND lk.created_at >= v_cooldown_start
      )
  ),
  ranked_links AS (
    SELECT
      el.id, el.url, el.likes_count, el.user_id, el.created_at,
      ec.is_elite, ec.is_boosted, ec.boost_order, ec.is_slowdown,
      MAX(el.created_at) OVER (PARTITION BY el.user_id) AS max_created_at,
      ROW_NUMBER() OVER (PARTITION BY el.user_id ORDER BY el.created_at DESC) AS rank_in_user
    FROM eligible_links el
    JOIN feed_eligibility_cache ec ON ec.user_id = el.user_id
  )
  SELECT
    rl.id,
    rl.url,
    rl.likes_count,
    rl.is_elite   AS anonymous,
    rl.is_boosted AS is_boosted
  FROM ranked_links rl
  ORDER BY
    rl.is_elite DESC,
    rl.is_boosted DESC,
    CASE WHEN rl.is_elite   THEN rl.created_at                       END DESC NULLS LAST,
    CASE WHEN rl.is_boosted THEN COALESCE(rl.boost_order, 999999999) END ASC  NULLS LAST,
    CASE WHEN rl.is_boosted THEN rl.created_at                       END DESC NULLS LAST,
    rl.rank_in_user ASC,
    rl.is_slowdown ASC,
    rl.max_created_at DESC,
    rl.user_id DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ---- process_like_commit() --------------------------------------------------
-- Main like procedure: advisory locks, cooldown, quota management.
-- Returns: 1 = committed, 0 = rejected
CREATE OR REPLACE FUNCTION process_like_commit(
  p_liker_id              UUID,
  p_link_id               UUID,
  p_receiver_id           UUID,
  p_is_anon               BOOLEAN,
  p_is_boosted_like       BOOLEAN,
  p_offer_active          BOOLEAN,
  p_offer_likes_required  INTEGER,
  p_offer_autolike_minutes INTEGER,
  p_active_window_hours   INTEGER,
  p_active_like_count     INTEGER,
  p_cooldown_hours        INTEGER,
  p_today_iso             TIMESTAMPTZ
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lock_pair   BIGINT;
  v_lock_recv   BIGINT;
  v_lock_liker  BIGINT;
  v_recent      INTEGER := 0;
  v_o_elite     BOOLEAN := FALSE;
  v_o_boosted   BOOLEAN := FALSE;
  v_o_bmodel    VARCHAR(20) := 'none';
  v_o_bexpiry   TIMESTAMPTZ := NULL;
  v_o_bquota    INTEGER := NULL;
  v_o_bused     INTEGER := 0;
  v_o_created   TIMESTAMPTZ := NULL;
  v_owner_recv_total INTEGER := 0;
  v_is_new_user BOOLEAN := FALSE;
  v_window_start TIMESTAMPTZ;
  v_owner_given_24h INTEGER := 0;
  v_owner_recv_24h  INTEGER := 0;
  v_l_enabled   BOOLEAN := FALSE;
  v_l_paused    BOOLEAN := FALSE;
  v_l_model     VARCHAR(20) := 'none';
  v_l_expiry    TIMESTAMPTZ := NULL;
  v_l_quota     INTEGER := NULL;
  v_l_used      INTEGER := 0;
  v_l_offer_count INTEGER := 0;
  v_l_free_until TIMESTAMPTZ := NULL;
  v_l_free_paused_min INTEGER := 0;
  v_rows_updated INTEGER;
  v_new_used    INTEGER;
  v_new_offer   INTEGER;
  v_current_until TIMESTAMPTZ;
BEGIN
  v_lock_pair  := hashtext(p_liker_id::text || ':' || p_link_id::text);
  v_lock_recv  := hashtext(p_receiver_id::text);
  v_lock_liker := hashtext(p_liker_id::text);

  -- Acquire all three locks in a consistent order. Concurrent ad
  -- completions wait instead of being rejected just because multiple view
  -- timers finished at the same time.
  PERFORM pg_advisory_lock(v_lock_pair);
  PERFORM pg_advisory_lock(v_lock_recv);
  PERFORM pg_advisory_lock(v_lock_liker);

  BEGIN
    -- 1. Cooldown (parameterised — matches get_eligible_feed_links)
    SELECT COUNT(*) INTO v_recent
    FROM likes
    WHERE liker_id = p_liker_id AND link_id = p_link_id
      AND created_at >= NOW() - (p_cooldown_hours || ' hours')::INTERVAL;

    IF v_recent > 0 THEN
      PERFORM pg_advisory_unlock(v_lock_pair);
      PERFORM pg_advisory_unlock(v_lock_recv);
      PERFORM pg_advisory_unlock(v_lock_liker);
      RETURN 0;
    END IF;

    -- 2. Owner existence + deficit check
    SELECT is_elite, is_boosted, boost_model, boost_expiry, boost_quota, boost_used, created_at
      INTO v_o_elite, v_o_boosted, v_o_bmodel, v_o_bexpiry, v_o_bquota, v_o_bused, v_o_created
    FROM profiles WHERE id = p_receiver_id;

    IF NOT FOUND THEN
      PERFORM pg_advisory_unlock(v_lock_pair);
      PERFORM pg_advisory_unlock(v_lock_recv);
      PERFORM pg_advisory_unlock(v_lock_liker);
      RETURN 0;
    END IF;

    IF NOT (COALESCE(v_o_elite, FALSE) OR COALESCE(v_o_boosted, FALSE)) THEN
      SELECT COUNT(*) INTO v_owner_recv_total
      FROM likes WHERE receiver_id = p_receiver_id AND NOT is_boosted_like;

      v_is_new_user :=
        EXTRACT(EPOCH FROM (NOW() - v_o_created)) < 86400
        AND COALESCE(v_owner_recv_total, 0) < p_active_like_count;

      IF NOT v_is_new_user THEN
        v_window_start := NOW() - (p_active_window_hours || ' hours')::INTERVAL;

        SELECT COUNT(*) INTO v_owner_given_24h
        FROM likes WHERE liker_id = p_receiver_id AND created_at >= v_window_start;

        SELECT COUNT(*) INTO v_owner_recv_24h
        FROM likes WHERE receiver_id = p_receiver_id AND NOT is_boosted_like AND created_at >= v_window_start;

        IF COALESCE(v_owner_recv_24h, 0) > COALESCE(v_owner_given_24h, 0) THEN
          PERFORM pg_advisory_unlock(v_lock_pair);
          PERFORM pg_advisory_unlock(v_lock_recv);
          PERFORM pg_advisory_unlock(v_lock_liker);
          RETURN 0;
        END IF;
      END IF;
    END IF;

    -- 3. Insert the like
    INSERT INTO likes (liker_id, link_id, receiver_id, is_anonymous, is_boosted_like, created_at)
    VALUES (p_liker_id, p_link_id, p_receiver_id, p_is_anon, p_is_boosted_like, NOW());

    -- 4. Increment link likes_count
    UPDATE links SET likes_count = COALESCE(likes_count, 0) + 1 WHERE id = p_link_id;

    -- 5. Liker auto-like usage
    SELECT auto_like_enabled, auto_like_paused, auto_like_model, auto_like_expiry,
           auto_like_quota, auto_like_used, boosted_offer_count, free_autolike_until,
           free_autolike_paused_remaining_minutes
      INTO v_l_enabled, v_l_paused, v_l_model, v_l_expiry, v_l_quota, v_l_used,
           v_l_offer_count, v_l_free_until, v_l_free_paused_min
    FROM profiles WHERE id = p_liker_id;

    IF NOT FOUND THEN
      -- like already committed; liker gone is not our problem
      PERFORM pg_advisory_unlock(v_lock_pair);
      PERFORM pg_advisory_unlock(v_lock_recv);
      PERFORM pg_advisory_unlock(v_lock_liker);
      RETURN 1;
    END IF;

    IF v_l_enabled AND NOT COALESCE(v_l_paused, FALSE) THEN
      IF v_l_model = 'time' AND v_l_expiry < NOW() THEN
        UPDATE profiles SET auto_like_enabled = FALSE, auto_like_model = 'none', auto_like_expiry = NULL
        WHERE id = p_liker_id;
      ELSIF v_l_model = 'usage' AND v_l_quota IS NOT NULL THEN
        UPDATE profiles
        SET auto_like_used = COALESCE(auto_like_used, 0) + 1
        WHERE id = p_liker_id
          AND auto_like_enabled = TRUE AND NOT auto_like_paused
          AND auto_like_model = 'usage' AND auto_like_quota IS NOT NULL
          AND COALESCE(auto_like_used, 0) < auto_like_quota;

        GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
        IF v_rows_updated > 0 THEN
          SELECT auto_like_used, auto_like_quota INTO v_new_used, v_l_quota
          FROM profiles WHERE id = p_liker_id;
          IF v_new_used >= v_l_quota THEN
            UPDATE profiles SET auto_like_enabled = FALSE, auto_like_model = 'none', auto_like_quota = NULL
            WHERE id = p_liker_id;
          END IF;
        ELSE
          UPDATE profiles SET auto_like_enabled = FALSE, auto_like_model = 'none', auto_like_quota = NULL
          WHERE id = p_liker_id;
        END IF;
      END IF;
    END IF;

    -- 6. Owner boost lazy-expiry cleanup
    IF v_o_boosted AND NOT COALESCE(v_o_elite, FALSE) THEN
      IF v_o_bmodel = 'time' AND v_o_bexpiry < NOW() THEN
        UPDATE profiles SET is_boosted = FALSE, boost_model = 'none', boost_expiry = NULL, boost_order = NULL
        WHERE id = p_receiver_id;
      END IF;
    END IF;

    -- 6b. Boost usage-quota decrement + offer
    IF v_o_boosted AND p_is_boosted_like AND NOT COALESCE(v_o_elite, FALSE) THEN
      IF v_o_bmodel = 'usage' AND v_o_bquota IS NOT NULL THEN
        UPDATE profiles
        SET boost_used = COALESCE(boost_used, 0) + 1
        WHERE id = p_receiver_id
          AND is_boosted = TRUE AND boost_model = 'usage'
          AND boost_quota IS NOT NULL AND COALESCE(boost_used, 0) < boost_quota;

        GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
        IF v_rows_updated > 0 THEN
          SELECT boost_used, boost_quota INTO v_new_used, v_o_bquota FROM profiles WHERE id = p_receiver_id;
          IF v_new_used >= v_o_bquota THEN
            UPDATE profiles SET is_boosted = FALSE, boost_model = 'none', boost_quota = NULL WHERE id = p_receiver_id;
          END IF;
        ELSE
          UPDATE profiles SET is_boosted = FALSE, boost_model = 'none', boost_quota = NULL WHERE id = p_receiver_id;
        END IF;
      ELSE
        UPDATE profiles SET boost_used = COALESCE(boost_used, 0) + 1 WHERE id = p_receiver_id;
      END IF;

      -- Offer: free autolike for liker after enough boosted likes
      IF p_offer_active THEN
        v_new_offer := COALESCE(v_l_offer_count, 0) + 1;
        IF v_new_offer >= p_offer_likes_required THEN
          IF COALESCE(v_l_paused, FALSE) THEN
            UPDATE profiles
            SET boosted_offer_count = 0,
                free_autolike_paused_remaining_minutes = COALESCE(v_l_free_paused_min, 0) + p_offer_autolike_minutes
            WHERE id = p_liker_id;
          ELSE
            v_current_until := COALESCE(v_l_free_until, NOW());
            IF v_current_until < NOW() THEN v_current_until := NOW(); END IF;
            UPDATE profiles
            SET boosted_offer_count = 0,
                free_autolike_until = v_current_until + (p_offer_autolike_minutes || ' minutes')::INTERVAL
            WHERE id = p_liker_id;
          END IF;
        ELSE
          UPDATE profiles SET boosted_offer_count = v_new_offer WHERE id = p_liker_id;
        END IF;
      END IF;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_advisory_unlock(v_lock_pair);
    PERFORM pg_advisory_unlock(v_lock_recv);
    PERFORM pg_advisory_unlock(v_lock_liker);
    RAISE;
  END;

  PERFORM pg_advisory_unlock(v_lock_pair);
  PERFORM pg_advisory_unlock(v_lock_recv);
  PERFORM pg_advisory_unlock(v_lock_liker);
  RETURN 1;
END;
$$;

-- =============================================================================
-- INITIAL DATA
-- =============================================================================

-- Populate feed cache (will be empty on fresh DB, no-op)
SELECT refresh_feed_eligibility_cache();

-- =============================================================================
-- NOTE ON SCHEDULED JOBS:
-- MySQL EVENTs are replaced by app-layer or pg_cron (if available):
--   - cleanup_old_likes: DELETE FROM likes WHERE created_at < NOW() - INTERVAL '7 days'
--   - cleanup_old_deleted_links: DELETE FROM links WHERE sort_order < 0 AND created_at < NOW() - INTERVAL '60 days'
--   - refresh_feed_eligibility_cache: called by app layer or pg_cron every 120s
-- Run manually or set up pg_cron extension if needed.
-- =============================================================================

-- =============================================================================
-- DONE! Tables created:
--   profiles, links, likes, blogs, settings, audit_log, feed_eligibility_cache
-- Sequences:
--   boost_order_seq
-- Functions:
--   add_links_atomic, get_my_stats, get_top_likers,
--   refresh_feed_eligibility_cache, get_eligible_feed_links,
--   process_like_commit
-- =============================================================================
