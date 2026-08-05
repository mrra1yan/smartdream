-- =============================================================================
-- SmartDream — MySQL stored procedures (port of supabase_rpc.sql + the
-- Postgres RPCs from migrations 0003-0017).
--
-- Design notes:
--   * Everything is a stored PROCEDURE (IN/OUT params), never a FUNCTION:
--     user-level locks (GET_LOCK) are connection-scoped, and the app calls
--     every proc on a dedicated pooled connection, so an early exit or a
--     crash can never leak a lock. Callers use:
--         CALL proc(?, ?, ..., @out); SELECT @out AS result;
--     on the SAME connection (see src/lib/db.ts callOut()).
--   * `SQL SECURITY DEFINER` + the app's MySQL user creating them (the
--     migration runner connects as the app user, which owns the schema) —
--     mirrors the old Postgres service_role-only EXECUTE grants: browser
--     code has no DB path at all, so these are only reachable via server
--     actions.
--   * `UPDATE ... RETURNING` doesn't exist in MySQL: the atomic quota-ceiling
--     increments use `UPDATE ... WHERE used < quota` + `ROW_COUNT()` instead
--     (safe because they run under the session locks).
--   * `COUNT(*) FILTER (WHERE x)`  -> `SUM(CASE WHEN x THEN 1 ELSE 0 END)`
--     `a IS DISTINCT FROM true`    -> `NOT (a <=> 1)`
--     `gen_random_uuid()`          -> `UUID()`
--     `(n || ' hours')::INTERVAL`  -> `INTERVAL n HOUR` (DATE_SUB/DATE_ADD)
--     `EXTRACT(EPOCH FROM (a-b))`  -> `TIMESTAMPDIFF(SECOND, b, a)`
-- =============================================================================

-- ---- boost_order sequence (replaces pg sequence, migration 0004) -----------
-- MySQL 8 has no sequences; an AUTO_INCREMENT table is the atomic equivalent.
CREATE TABLE IF NOT EXISTS boost_order_seq (
  id INT AUTO_INCREMENT PRIMARY KEY
) ENGINE=InnoDB;

-- Seed it past the current highest boost_order so fresh orders never collide.
SET @max_boost := (
  SELECT COALESCE(MAX(boost_order), 0) + 1
  FROM profiles WHERE is_boosted = 1
);
SET @seed_sql := CONCAT('ALTER TABLE boost_order_seq AUTO_INCREMENT = ', CAST(@max_boost AS UNSIGNED));
PREPARE seed_stmt FROM @seed_sql;
EXECUTE seed_stmt;
DEALLOCATE PREPARE seed_stmt;

-- =============================================================================
-- next_boost_order()
-- Returns the next boost_order value, atomically (INSERT + LAST_INSERT_ID is
-- race-free across concurrent callers, same guarantee as nextval()).
-- =============================================================================
DELIMITER //
CREATE OR REPLACE PROCEDURE next_boost_order(OUT p_result INT)
SQL SECURITY DEFINER
BEGIN
  INSERT INTO boost_order_seq (id) VALUES (NULL);
  SET p_result = LAST_INSERT_ID();
END//

-- =============================================================================
-- add_links_atomic(p_user_id, p_rows JSON array of {id, url}, p_max_links)
-- Count-check-and-insert under a per-user lock; inserts only as many as fit
-- under the cap; returns how many were actually inserted.
-- =============================================================================
CREATE OR REPLACE PROCEDURE add_links_atomic(
  IN p_user_id CHAR(36),
  IN p_rows JSON,
  IN p_max_links INT,
  OUT p_inserted INT
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE v_existing INT;
  DECLARE v_remaining INT;
  DECLARE v_next_sort INT;
  DECLARE v_i INT DEFAULT 0;
  DECLARE v_n INT;
  DECLARE v_id CHAR(36);
  DECLARE v_url TEXT;

  SET @lock = SHA2(p_user_id, 256);

  IF GET_LOCK(@lock, 10) <= 0 THEN
    SET p_inserted = 0;
  ELSE
    SELECT COUNT(*) INTO v_existing
    FROM links
    WHERE user_id = p_user_id AND sort_order >= 0;

    SET v_remaining := GREATEST(p_max_links - v_existing, 0);
    SET v_next_sort := v_existing;
    SET p_inserted := 0;
    SET v_n := JSON_LENGTH(p_rows);

    WHILE v_i < v_n AND v_remaining > 0 DO
      SET v_id := JSON_UNQUOTE(JSON_EXTRACT(p_rows, CONCAT('$[', v_i, '].id')));
      SET v_url := JSON_UNQUOTE(JSON_EXTRACT(p_rows, CONCAT('$[', v_i, '].url')));

      INSERT INTO links (id, user_id, url, likes_count, sort_order, created_at)
      VALUES (v_id, p_user_id, v_url, 0, v_next_sort, NOW(6));

      SET v_next_sort := v_next_sort + 1;
      SET v_remaining := v_remaining - 1;
      SET p_inserted := p_inserted + 1;
      SET v_i := v_i + 1;
    END WHILE;

    DO RELEASE_LOCK(@lock);
  END IF;
END//

-- =============================================================================
-- get_my_stats(viewer_id, today_iso, minus24h_iso)
-- Final SELECT acts as the result set (caller: SELECT * FROM
-- (CALL get_my_stats(...)) — or just `CALL` and read rows).
-- Given counts INCLUDE boosted likes; received counts exclude them
-- (migration 0011 semantics).
-- =============================================================================
CREATE OR REPLACE PROCEDURE get_my_stats(
  IN p_viewer_id CHAR(36),
  IN p_today_iso DATETIME(6),
  IN p_minus24h_iso DATETIME(6)
)
SQL SECURITY DEFINER
READS SQL DATA
BEGIN
  SELECT
    (SELECT COUNT(*) FROM likes WHERE liker_id = p_viewer_id AND created_at >= p_today_iso) AS given_today,
    (SELECT COUNT(*) FROM likes WHERE receiver_id = p_viewer_id AND created_at >= p_today_iso AND NOT (is_boosted_like <=> 1)) AS received_today,
    (SELECT COUNT(*) FROM likes WHERE liker_id = p_viewer_id AND created_at >= p_minus24h_iso) AS given_24h,
    (SELECT COUNT(*) FROM likes WHERE receiver_id = p_viewer_id AND created_at >= p_minus24h_iso AND NOT (is_boosted_like <=> 1)) AS received_24h;
END//

-- =============================================================================
-- get_top_likers(p_limit)
-- Non-elite role='user' leaderboard by likes given (migration 0016).
-- =============================================================================
CREATE OR REPLACE PROCEDURE get_top_likers(IN p_limit INT, OUT p_count INT)
SQL SECURITY DEFINER
READS SQL DATA
BEGIN
  SET p_count = 0;
  SELECT p.id, p.public_id, p.first_name, p.last_name, p.email,
         COUNT(l.id) AS likes_count
  FROM profiles p
  LEFT JOIN likes l ON l.liker_id = p.id
  WHERE p.is_elite = 0 AND p.role = 'user'
  GROUP BY p.id
  ORDER BY likes_count DESC
  LIMIT p_limit;
END//

-- =============================================================================
-- refresh_feed_eligibility_cache()
-- Recomputes which posters are elite/boosted/new/active-not-in-slowdown and
-- swaps the cache table in one go (port of migration 0014; driven by an EVENT
-- every 120s instead of pg_cron — see 0017's frequency decision).
-- =============================================================================
CREATE OR REPLACE PROCEDURE refresh_feed_eligibility_cache()
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE v_active_like_count INT;
  DECLARE v_active_window_hours INT;
  DECLARE v_window_iso DATETIME(6);

  SELECT active_like_count, active_window_hours
    INTO v_active_like_count, v_active_window_hours
  FROM settings
  LIMIT 1;

  SET v_window_iso := DATE_SUB(NOW(6), INTERVAL v_active_window_hours HOUR);

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
      COALESCE(r.recv_24h, 0) AS recv_24h,
      COALESCE(r.recv_total, 0) AS recv_total
    FROM posters po
    JOIN profiles p ON p.id = po.user_id
    LEFT JOIN (
      SELECT liker_id, COUNT(*) AS given_24h
      FROM likes
      WHERE created_at >= v_window_iso
        AND liker_id IN (SELECT user_id FROM posters)
      GROUP BY liker_id
    ) g ON g.liker_id = p.id
    LEFT JOIN (
      SELECT receiver_id,
             SUM(CASE WHEN created_at >= v_window_iso THEN 1 ELSE 0 END) AS recv_24h,
             COUNT(*) AS recv_total
      FROM likes
      WHERE NOT (is_boosted_like <=> 1)
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
      WHEN us.given_24h > 0 AND (us.recv_24h / us.given_24h) >= 0.9 THEN 1
      ELSE 0
    END AS is_slowdown,
    NOW(6)
  FROM user_stats us
  WHERE us.is_elite = 1
     OR us.is_boosted = 1
     OR (TIMESTAMPDIFF(SECOND, us.profile_created_at, NOW(6)) < 86400 AND us.recv_total < v_active_like_count)
     OR (us.given_24h >= v_active_like_count AND NOT (us.given_24h > 0 AND us.recv_24h >= us.given_24h));
END//

-- =============================================================================
-- get_eligible_feed_links(viewer_id, active_like_count, active_window_hours,
--                         cooldown_hours, limit, offset)
-- Joins the eligibility cache (port of migration 0014's version).
-- =============================================================================
CREATE OR REPLACE PROCEDURE get_eligible_feed_links(
  IN p_viewer_id CHAR(36),
  IN p_active_like_count INT,
  IN p_active_window_hours INT,
  IN p_cooldown_hours INT,
  IN p_limit INT,
  IN p_offset INT
)
SQL SECURITY DEFINER
READS SQL DATA
BEGIN
  DECLARE v_cooldown_iso DATETIME(6);
  SET v_cooldown_iso := DATE_SUB(NOW(6), INTERVAL p_cooldown_hours HOUR);

  WITH eligible_links AS (
    SELECT l.id, l.url, l.likes_count, l.user_id, l.created_at
    FROM links l
    WHERE l.sort_order >= 0
      AND l.user_id <> p_viewer_id
      AND NOT EXISTS (
        SELECT 1 FROM likes lk
        WHERE lk.liker_id = p_viewer_id
          AND lk.link_id = l.id
          AND lk.created_at >= v_cooldown_iso
      )
  ),
  ranked_links AS (
    SELECT
      el.id,
      el.url,
      el.likes_count,
      el.user_id,
      el.created_at,
      ec.is_elite,
      ec.is_boosted,
      ec.boost_order,
      ec.is_slowdown,
      MAX(el.created_at) OVER(PARTITION BY el.user_id) AS max_created_at,
      ROW_NUMBER() OVER(PARTITION BY el.user_id ORDER BY el.created_at DESC) AS rank_in_user
    FROM eligible_links el
    JOIN feed_eligibility_cache ec ON ec.user_id = el.user_id
  )
  SELECT
    rl.id,
    rl.url,
    rl.likes_count,
    rl.is_elite AS anonymous,
    rl.is_boosted AS is_boosted
  FROM ranked_links rl
  ORDER BY
    rl.is_elite DESC,
    rl.is_boosted DESC,
    CASE WHEN rl.is_elite THEN rl.created_at ELSE NULL END DESC,
    CASE WHEN rl.is_boosted THEN COALESCE(rl.boost_order, 999999999) ELSE NULL END ASC,
    CASE WHEN rl.is_boosted THEN rl.created_at ELSE NULL END DESC,
    rl.rank_in_user ASC,
    rl.is_slowdown ASC,
    rl.max_created_at DESC,
    rl.user_id DESC
  LIMIT p_limit
  OFFSET p_offset;
END//

-- =============================================================================
-- process_like_commit(...)  — OUT p_result (1 = committed, 0 = rejected)
-- Port of supabase_rpc.sql's final 11-param version: three session locks
-- (liker:link pair, receiver, liker), 12h cooldown, authoritative owner
-- deficit check, atomic quota-ceiling increments via ROW_COUNT().
-- =============================================================================
CREATE OR REPLACE PROCEDURE process_like_commit(
  IN p_liker_id CHAR(36),
  IN p_link_id CHAR(36),
  IN p_receiver_id CHAR(36),
  IN p_is_anon TINYINT,
  IN p_is_boosted_like TINYINT,
  IN p_offer_active TINYINT,
  IN p_offer_likes_required INT,
  IN p_offer_autolike_minutes INT,
  IN p_active_window_hours INT,
  IN p_active_like_count INT,
  IN p_today_iso DATETIME(6),
  OUT p_result TINYINT
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE v_recent INT DEFAULT 0;
  DECLARE v_owner_cnt INT DEFAULT 0;
  DECLARE v_liker_cnt INT DEFAULT 0;
  DECLARE v_o_elite TINYINT DEFAULT 0;
  DECLARE v_o_boosted TINYINT DEFAULT 0;
  DECLARE v_o_bmodel VARCHAR(20) DEFAULT 'none';
  DECLARE v_o_bexpiry DATETIME(6) DEFAULT NULL;
  DECLARE v_o_bquota INT DEFAULT NULL;
  DECLARE v_o_bused INT DEFAULT 0;
  DECLARE v_o_created DATETIME(6) DEFAULT NULL;
  DECLARE v_owner_recv_total INT DEFAULT 0;
  DECLARE v_is_new_user TINYINT DEFAULT 0;
  DECLARE v_owner_given_24h INT DEFAULT 0;
  DECLARE v_owner_recv_24h INT DEFAULT 0;
  DECLARE v_window_start DATETIME(6) DEFAULT NULL;
  DECLARE v_l_enabled TINYINT DEFAULT 0;
  DECLARE v_l_paused TINYINT DEFAULT 0;
  DECLARE v_l_model VARCHAR(20) DEFAULT 'none';
  DECLARE v_l_expiry DATETIME(6) DEFAULT NULL;
  DECLARE v_l_quota INT DEFAULT NULL;
  DECLARE v_l_used INT DEFAULT 0;
  DECLARE v_l_offer_count INT DEFAULT 0;
  DECLARE v_l_free_until DATETIME(6) DEFAULT NULL;
  DECLARE v_l_free_paused_min INT DEFAULT 0;
  DECLARE v_new_used INT DEFAULT 0;
  DECLARE v_quota INT DEFAULT NULL;
  DECLARE v_new_offer_count INT DEFAULT 0;
  DECLARE v_current_until DATETIME(6) DEFAULT NULL;

  -- Guarantee lock cleanup even on a SQL error (e.g. deadlock rollback).
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    DO RELEASE_LOCK(@lock_pair);
    DO RELEASE_LOCK(@lock_recv);
    DO RELEASE_LOCK(@lock_liker);
    RESIGNAL;
  END;

  -- Session-scoped lock keys (SHA2 hex fits GET_LOCK's 64-char key limit).
  SET @lock_pair := SHA2(CONCAT(p_liker_id, ':', p_link_id), 256);
  SET @lock_recv := SHA2(p_receiver_id, 256);
  SET @lock_liker := SHA2(p_liker_id, 256);
  SET @locked := 0;

  IF GET_LOCK(@lock_pair, 10) > 0 THEN SET @locked := @locked + 1; END IF;
  IF GET_LOCK(@lock_recv, 10) > 0 THEN SET @locked := @locked + 1; END IF;
  IF GET_LOCK(@lock_liker, 10) > 0 THEN SET @locked := @locked + 1; END IF;

  main_block: BEGIN
    IF @locked < 3 THEN
      SET p_result = 0; -- could not acquire all locks
      LEAVE main_block;
    END IF;

    -- 1. 12h cooldown
    SELECT COUNT(*) INTO v_recent
    FROM likes
    WHERE liker_id = p_liker_id
      AND link_id = p_link_id
      AND created_at >= DATE_SUB(NOW(6), INTERVAL 12 HOUR);

    IF v_recent > 0 THEN
      SET p_result = 0; -- cooldown active
      LEAVE main_block;
    END IF;

    -- 2. Owner exposure/deficit check (authoritative, under receiver lock)
    SELECT COUNT(*) INTO v_owner_cnt FROM profiles WHERE id = p_receiver_id;
    IF v_owner_cnt = 0 THEN
      SET p_result = 0;
      LEAVE main_block;
    END IF;

    SELECT is_elite, is_boosted, boost_model, boost_expiry, boost_quota, boost_used, created_at
      INTO v_o_elite, v_o_boosted, v_o_bmodel, v_o_bexpiry, v_o_bquota, v_o_bused, v_o_created
    FROM profiles WHERE id = p_receiver_id;

    IF NOT (COALESCE(v_o_elite, 0) OR COALESCE(v_o_boosted, 0)) THEN
      SELECT COUNT(*) INTO v_owner_recv_total
      FROM likes WHERE receiver_id = p_receiver_id AND is_boosted_like = 0;

      SET v_is_new_user :=
        (TIMESTAMPDIFF(SECOND, v_o_created, NOW(6)) < 86400)
        AND (COALESCE(v_owner_recv_total, 0) < p_active_like_count);

      IF NOT v_is_new_user THEN
        SET v_window_start := DATE_SUB(NOW(6), INTERVAL p_active_window_hours HOUR);

        SELECT COUNT(*) INTO v_owner_given_24h
        FROM likes WHERE liker_id = p_receiver_id AND created_at >= v_window_start;

        SELECT COUNT(*) INTO v_owner_recv_24h
        FROM likes WHERE receiver_id = p_receiver_id AND is_boosted_like = 0 AND created_at >= v_window_start;

        IF COALESCE(v_owner_recv_24h, 0) > COALESCE(v_owner_given_24h, 0) THEN
          SET p_result = 0; -- exposure_limit_reached (owner deficit)
          LEAVE main_block;
        END IF;
      END IF;
    END IF;

    -- 3. Insert the like
    INSERT INTO likes (id, liker_id, link_id, receiver_id, is_anonymous, is_boosted_like, created_at)
    VALUES (UUID(), p_liker_id, p_link_id, p_receiver_id, p_is_anon, p_is_boosted_like, NOW(6));

    -- 4. Increment link likes_count
    UPDATE links
    SET likes_count = COALESCE(likes_count, 0) + 1
    WHERE id = p_link_id;

    -- 5. Liker usage (auto-like)
    SELECT COUNT(*) INTO v_liker_cnt FROM profiles WHERE id = p_liker_id;
    IF v_liker_cnt = 0 THEN
      SET p_result = 1; -- like already committed; liker row gone is not our problem
      LEAVE main_block;
    END IF;

    SELECT auto_like_enabled, auto_like_paused, auto_like_model, auto_like_expiry,
           auto_like_quota, auto_like_used, boosted_offer_count, free_autolike_until,
           free_autolike_paused_remaining_minutes
      INTO v_l_enabled, v_l_paused, v_l_model, v_l_expiry, v_l_quota, v_l_used,
           v_l_offer_count, v_l_free_until, v_l_free_paused_min
    FROM profiles WHERE id = p_liker_id;

    IF v_l_enabled AND NOT COALESCE(v_l_paused, 0) THEN
      IF v_l_model = 'time' AND v_l_expiry < NOW(6) THEN
        UPDATE profiles
        SET auto_like_enabled = 0, auto_like_model = 'none', auto_like_expiry = NULL
        WHERE id = p_liker_id;
      ELSEIF v_l_model = 'usage' AND v_l_quota IS NOT NULL THEN
        -- Atomic increment with quota ceiling (ROW_COUNT() substitutes for
        -- UPDATE ... RETURNING; safe under the liker lock)
        UPDATE profiles
        SET auto_like_used = COALESCE(auto_like_used, 0) + 1
        WHERE id = p_liker_id
          AND auto_like_enabled = 1
          AND NOT auto_like_paused
          AND auto_like_model = 'usage'
          AND auto_like_quota IS NOT NULL
          AND COALESCE(auto_like_used, 0) < auto_like_quota;

        IF ROW_COUNT() > 0 THEN
          SELECT auto_like_used, auto_like_quota INTO v_new_used, v_quota
          FROM profiles WHERE id = p_liker_id;
          IF v_new_used >= v_quota THEN
            UPDATE profiles
            SET auto_like_enabled = 0, auto_like_model = 'none', auto_like_quota = NULL
            WHERE id = p_liker_id;
          END IF;
        ELSE
          -- Quota already exhausted by a concurrent transaction
          UPDATE profiles
          SET auto_like_enabled = 0, auto_like_model = 'none', auto_like_quota = NULL
          WHERE id = p_liker_id;
        END IF;
      END IF;
    END IF;

    -- 6. Owner usage (boosted page)
    -- 6a. Lazy boost-expiry cleanup (not gated on p_is_boosted_like)
    IF v_o_boosted AND NOT COALESCE(v_o_elite, 0) THEN
      IF v_o_bmodel = 'time' AND v_o_bexpiry < NOW(6) THEN
        UPDATE profiles
        SET is_boosted = 0, boost_model = 'none', boost_expiry = NULL, boost_order = NULL
        WHERE id = p_receiver_id;
      END IF;
    END IF;

    -- 6b. Boost usage-quota decrement + boosted-offer crediting (requires
    --     p_is_boosted_like so organic likes don't drain paid quota)
    IF v_o_boosted AND p_is_boosted_like AND NOT COALESCE(v_o_elite, 0) THEN
      IF v_o_bmodel = 'usage' AND v_o_bquota IS NOT NULL THEN
        UPDATE profiles
        SET boost_used = COALESCE(boost_used, 0) + 1
        WHERE id = p_receiver_id
          AND is_boosted = 1
          AND boost_model = 'usage'
          AND boost_quota IS NOT NULL
          AND COALESCE(boost_used, 0) < boost_quota;

        IF ROW_COUNT() > 0 THEN
          SELECT boost_used, boost_quota INTO v_new_used, v_quota
          FROM profiles WHERE id = p_receiver_id;
          IF v_new_used >= v_quota THEN
            UPDATE profiles
            SET is_boosted = 0, boost_model = 'none', boost_quota = NULL
            WHERE id = p_receiver_id;
          END IF;
        ELSE
          UPDATE profiles
          SET is_boosted = 0, boost_model = 'none', boost_quota = NULL
          WHERE id = p_receiver_id;
        END IF;
      ELSE
        UPDATE profiles
        SET boost_used = COALESCE(boost_used, 0) + 1
        WHERE id = p_receiver_id;
      END IF;

      -- Process Offer (free autolike for viewers)
      IF p_offer_active THEN
        SET v_new_offer_count := COALESCE(v_l_offer_count, 0) + 1;

        IF v_new_offer_count >= p_offer_likes_required THEN
          IF COALESCE(v_l_paused, 0) THEN
            UPDATE profiles
            SET boosted_offer_count = 0,
                free_autolike_paused_remaining_minutes =
                  COALESCE(v_l_free_paused_min, 0) + p_offer_autolike_minutes
            WHERE id = p_liker_id;
          ELSE
            SET v_current_until := COALESCE(v_l_free_until, NOW(6));
            IF v_current_until < NOW(6) THEN
              SET v_current_until := NOW(6);
            END IF;
            UPDATE profiles
            SET boosted_offer_count = 0,
                free_autolike_until = DATE_ADD(v_current_until, INTERVAL p_offer_autolike_minutes MINUTE)
            WHERE id = p_liker_id;
          END IF;
        ELSE
          UPDATE profiles
          SET boosted_offer_count = v_new_offer_count
          WHERE id = p_liker_id;
        END IF;
      END IF;
    END IF;

    SET p_result = 1;
  END main_block;

  DO RELEASE_LOCK(@lock_pair);
  DO RELEASE_LOCK(@lock_recv);
  DO RELEASE_LOCK(@lock_liker);
END//

-- =============================================================================
-- Scheduled jobs: eligibility cache refresh every 120s (migration 0017
-- reduced this from 15s; pg_cron -> MySQL EVENT).
-- NOTE: the initial one-shot population CALL lives in 0003_schema_fixes.sql
-- (the feed_eligibility_cache TABLE is created there — calling the refresh
-- before the table exists would fail the migration).
-- =============================================================================
CREATE EVENT IF NOT EXISTS refresh_feed_eligibility_cache
  ON SCHEDULE EVERY 120 SECOND
  ON COMPLETION PRESERVE
  ENABLE
  COMMENT 'Recompute poster eligibility for the feed (was pg_cron 120s)'
  DO CALL refresh_feed_eligibility_cache();

DELIMITER ;
