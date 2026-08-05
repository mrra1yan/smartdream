-- =============================================================================
-- SmartDream — MySQL 8 Complete Setup SQL
-- সব tables, indexes, procedures, events এক জায়গায়।
--
-- কিভাবে run করবে:
--   mysql -u root -p smartdream < setup.sql
-- অথবা Docker দিয়ে:
--   docker exec -i smartdream-mysql mysql -u smartdream -psmartdream_dev_password smartdream < setup.sql
--
-- Requirements:
--   * MySQL 8.0+
--   * Database আগে তৈরি থাকতে হবে (docker-compose করলে auto-create হয়)
--   * event_scheduler=ON থাকতে হবে (docker-compose.yml এ আছে)
-- =============================================================================

SET time_zone = '+00:00';
SET foreign_key_checks = 0;

-- =============================================================================
-- TABLES
-- =============================================================================

-- ---- profiles ---------------------------------------------------------------
-- প্রতিটা user-এর main row। password bcrypt hash এখানে থাকে।
CREATE TABLE IF NOT EXISTS profiles (
  id                                        CHAR(36)        PRIMARY KEY,
  public_id                                 VARCHAR(20)     NULL,
  first_name                                VARCHAR(100)    NULL,
  last_name                                 VARCHAR(100)    NULL,
  phone                                     VARCHAR(50)     NULL,
  email                                     VARCHAR(255)    NULL,
  password_hash                             VARCHAR(100)    NULL,
  role                                      VARCHAR(20)     NOT NULL DEFAULT 'user',        -- user | admin | super_admin
  status                                    VARCHAR(20)     NOT NULL DEFAULT 'pending',     -- pending | approved | rejected
  is_elite                                  TINYINT(1)      NOT NULL DEFAULT 0,
  is_boosted                                TINYINT(1)      NOT NULL DEFAULT 0,
  boost_order                               INT             NULL,
  boost_model                               VARCHAR(20)     NOT NULL DEFAULT 'none',        -- none | no_expiry | time | usage
  boost_expiry                              DATETIME(6)     NULL,
  boost_quota                               INT             NULL,
  boost_used                                INT             NOT NULL DEFAULT 0,
  auto_like_enabled                         TINYINT(1)      NOT NULL DEFAULT 0,
  auto_like_model                           VARCHAR(20)     NOT NULL DEFAULT 'none',        -- none | no_expiry | time | usage
  auto_like_expiry                          DATETIME(6)     NULL,
  auto_like_quota                           INT             NULL,
  auto_like_used                            INT             NOT NULL DEFAULT 0,
  free_autolike_until                       DATETIME(6)     NULL,
  auto_like_paused                          TINYINT(1)      NOT NULL DEFAULT 0,
  auto_like_paused_remaining_minutes        INT             NULL,
  free_autolike_paused_remaining_minutes    INT             NULL,
  boosted_offer_count                       INT             NOT NULL DEFAULT 0,
  referred_by                               CHAR(36)        NULL,
  approved_by                               CHAR(36)        NULL,
  created_at                                DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

  -- phone unique (NULL = no phone, duplicates allowed for NULL)
  phone_key VARCHAR(50) GENERATED ALWAYS AS (
    CASE WHEN phone IS NOT NULL AND phone <> '' THEN phone ELSE NULL END
  ) STORED,
  UNIQUE KEY profiles_phone_unique (phone_key),

  -- email unique (case-insensitive)
  email_key VARCHAR(255) GENERATED ALWAYS AS (
    CASE WHEN email IS NOT NULL AND email <> '' THEN LOWER(email) ELSE NULL END
  ) STORED,
  UNIQUE KEY profiles_email_unique (email_key),

  KEY profiles_email_idx        (email),
  KEY profiles_phone_idx        (phone),
  KEY profiles_public_id_idx    (public_id),
  KEY profiles_status_role_elite_idx (status, role, is_elite),
  KEY profiles_referred_by_idx  (referred_by),
  KEY profiles_is_elite_idx     (is_elite),
  KEY profiles_is_boosted_order_idx (is_boosted, boost_order),

  CONSTRAINT profiles_referred_by_fk FOREIGN KEY (referred_by) REFERENCES profiles (id) ON DELETE SET NULL,
  CONSTRAINT profiles_approved_by_fk FOREIGN KEY (approved_by) REFERENCES profiles (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---- links ------------------------------------------------------------------
-- প্রতিটা user-এর link। sort_order < 0 মানে soft-deleted।
CREATE TABLE IF NOT EXISTS links (
  id          CHAR(36)    PRIMARY KEY,
  user_id     CHAR(36)    NOT NULL,
  url         TEXT        NULL,
  likes_count INT         NOT NULL DEFAULT 0,
  sort_order  BIGINT      NOT NULL DEFAULT 0,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

  KEY idx_links_user_id   (user_id),
  KEY idx_links_user_sort (user_id, sort_order),

  CONSTRAINT links_user_fk FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---- likes ------------------------------------------------------------------
-- কে কার link-এ like দিয়েছে। 7 দিন পর auto-delete হয় (EVENT দেখো নিচে)।
CREATE TABLE IF NOT EXISTS likes (
  id              CHAR(36)    PRIMARY KEY,
  liker_id        CHAR(36)    NULL,
  link_id         CHAR(36)    NULL,
  receiver_id     CHAR(36)    NOT NULL,
  is_anonymous    TINYINT(1)  NOT NULL DEFAULT 0,
  is_boosted_like TINYINT(1)  NOT NULL DEFAULT 0,
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

  KEY idx_likes_receiver_id            (receiver_id),
  KEY idx_likes_liker_id               (liker_id),
  KEY idx_likes_liker_created_at       (liker_id, created_at),
  KEY idx_likes_receiver_created_at    (receiver_id, created_at),
  KEY idx_likes_liker_link_created     (liker_id, link_id, created_at),
  KEY idx_likes_receiver_boosted       (receiver_id, is_boosted_like),

  CONSTRAINT likes_liker_fk    FOREIGN KEY (liker_id)    REFERENCES profiles (id) ON DELETE SET NULL,
  CONSTRAINT likes_link_fk     FOREIGN KEY (link_id)     REFERENCES links    (id) ON DELETE CASCADE,
  CONSTRAINT likes_receiver_fk FOREIGN KEY (receiver_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---- blogs ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blogs (
  id           CHAR(36)      PRIMARY KEY,
  title        VARCHAR(255)  NULL,
  slug         VARCHAR(255)  NULL,
  excerpt      TEXT          NULL,
  content      LONGTEXT      NULL,
  hero_image   TEXT          NULL,
  published_at DATETIME(6)   NULL,
  created_by   CHAR(36)      NULL,
  created_at   DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

  UNIQUE KEY blogs_slug_unique    (slug),
  KEY blogs_created_by_idx        (created_by),
  KEY blogs_published_at_idx      (published_at),
  KEY blogs_created_at_idx        (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---- settings ---------------------------------------------------------------
-- Single-row config (id = '1')। INSERT on first run, তারপর UPDATE।
CREATE TABLE IF NOT EXISTS settings (
  id                                  VARCHAR(20)   PRIMARY KEY,
  whatsapp_number                     TEXT          NULL,
  active_like_count                   INT           NOT NULL DEFAULT 0,
  active_window_hours                 INT           NOT NULL DEFAULT 24,
  elite_weight                        INT           NOT NULL DEFAULT 50,
  offer_likes_required                INT           NOT NULL DEFAULT 100,
  offer_autolike_minutes              INT           NOT NULL DEFAULT 60,
  offer_active                        TINYINT(1)    NOT NULL DEFAULT 0,
  boost_price_no_expiry               INT           NULL,
  boost_price_1w                      INT           NULL,
  boost_price_1m                      INT           NULL,
  boost_price_3m                      INT           NULL,
  boost_price_6m                      INT           NULL,
  boost_price_1y                      INT           NULL,
  boost_price_usage_per_unit          INT           NULL,
  autolike_price_no_expiry            INT           NULL,
  autolike_price_1w                   INT           NULL,
  autolike_price_1m                   INT           NULL,
  autolike_price_3m                   INT           NULL,
  autolike_price_6m                   INT           NULL,
  autolike_price_1y                   INT           NULL,
  autolike_price_usage_per_unit       INT           NULL,
  referral_reward_referrer_minutes    INT           NOT NULL DEFAULT 1440,
  referral_reward_referee_minutes     INT           NOT NULL DEFAULT 720,
  level1_name                         VARCHAR(50)   NULL,
  level1_threshold                    INT           NULL,
  level2_name                         VARCHAR(50)   NULL,
  level2_threshold                    INT           NULL,
  level3_name                         VARCHAR(50)   NULL,
  level3_threshold                    INT           NULL,
  level4_name                         VARCHAR(50)   NULL,
  level4_threshold                    INT           NULL,
  created_at                          DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at                          DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Default settings row
INSERT INTO settings (id) VALUES ('1')
  ON DUPLICATE KEY UPDATE id = id;

-- ---- audit_log --------------------------------------------------------------
-- Admin action log।
CREATE TABLE IF NOT EXISTS audit_log (
  id          CHAR(36)      PRIMARY KEY,
  actor_id    CHAR(36)      NULL,
  actor_role  VARCHAR(20)   NULL,
  action      VARCHAR(255)  NOT NULL,
  target_id   CHAR(36)      NULL,
  metadata    JSON          NULL,
  created_at  DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

  KEY audit_log_created_at_idx (created_at),
  KEY audit_log_actor_idx      (actor_id),

  CONSTRAINT audit_log_actor_fk FOREIGN KEY (actor_id) REFERENCES profiles (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---- feed_eligibility_cache -------------------------------------------------
-- Feed query optimize করতে 120 seconds পরপর refresh হয়।
CREATE TABLE IF NOT EXISTS feed_eligibility_cache (
  user_id      CHAR(36)    PRIMARY KEY,
  is_elite     TINYINT(1)  NOT NULL DEFAULT 0,
  is_boosted   TINYINT(1)  NOT NULL DEFAULT 0,
  boost_order  INT         NULL,
  is_slowdown  TINYINT(1)  NOT NULL DEFAULT 0,
  refreshed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

  CONSTRAINT fk_fec_user FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---- boost_order_seq --------------------------------------------------------
-- Auto-increment sequence boost_order এর জন্য (MySQL-এ sequence নেই)।
CREATE TABLE IF NOT EXISTS boost_order_seq (
  id INT AUTO_INCREMENT PRIMARY KEY
) ENGINE=InnoDB;

SET foreign_key_checks = 1;

-- =============================================================================
-- STORED PROCEDURES
-- =============================================================================

DELIMITER //

-- ---- next_boost_order() -----------------------------------------------------
-- পরের boost_order নম্বর atomically দেয়।
CREATE OR REPLACE PROCEDURE next_boost_order(OUT p_result INT)
SQL SECURITY DEFINER
BEGIN
  INSERT INTO boost_order_seq (id) VALUES (NULL);
  SET p_result = LAST_INSERT_ID();
END//

-- ---- add_links_atomic() -----------------------------------------------------
-- Per-user lock দিয়ে atomically links insert করে (max cap check সহ)।
-- p_rows: JSON array of {id, url}
-- p_inserted: কতটা actually insert হয়েছে
CREATE OR REPLACE PROCEDURE add_links_atomic(
  IN  p_user_id   CHAR(36),
  IN  p_rows      JSON,
  IN  p_max_links INT,
  OUT p_inserted  INT
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE v_existing  INT;
  DECLARE v_remaining INT;
  DECLARE v_next_sort INT;
  DECLARE v_i         INT DEFAULT 0;
  DECLARE v_n         INT;
  DECLARE v_id        CHAR(36);
  DECLARE v_url       TEXT;

  SET @lock = SHA2(p_user_id, 256);

  IF GET_LOCK(@lock, 10) <= 0 THEN
    SET p_inserted = 0;
  ELSE
    SELECT COUNT(*) INTO v_existing
    FROM links
    WHERE user_id = p_user_id AND sort_order >= 0;

    SET v_remaining := GREATEST(p_max_links - v_existing, 0);
    SET v_next_sort := v_existing;
    SET p_inserted  := 0;
    SET v_n         := JSON_LENGTH(p_rows);

    WHILE v_i < v_n AND v_remaining > 0 DO
      SET v_id  := JSON_UNQUOTE(JSON_EXTRACT(p_rows, CONCAT('$[', v_i, '].id')));
      SET v_url := JSON_UNQUOTE(JSON_EXTRACT(p_rows, CONCAT('$[', v_i, '].url')));

      INSERT INTO links (id, user_id, url, likes_count, sort_order, created_at)
      VALUES (v_id, p_user_id, v_url, 0, v_next_sort, NOW(6));

      SET v_next_sort := v_next_sort + 1;
      SET v_remaining := v_remaining - 1;
      SET p_inserted  := p_inserted + 1;
      SET v_i         := v_i + 1;
    END WHILE;

    DO RELEASE_LOCK(@lock);
  END IF;
END//

-- ---- get_my_stats() ---------------------------------------------------------
-- Viewer-এর দেওয়া ও পাওয়া like এর count (today + 24h)।
CREATE OR REPLACE PROCEDURE get_my_stats(
  IN p_viewer_id   CHAR(36),
  IN p_today_iso   DATETIME(6),
  IN p_minus24h_iso DATETIME(6)
)
SQL SECURITY DEFINER
READS SQL DATA
BEGIN
  SELECT
    (SELECT COUNT(*) FROM likes WHERE liker_id    = p_viewer_id AND created_at >= p_today_iso) AS given_today,
    (SELECT COUNT(*) FROM likes WHERE receiver_id = p_viewer_id AND created_at >= p_today_iso AND NOT (is_boosted_like <=> 1)) AS received_today,
    (SELECT COUNT(*) FROM likes WHERE liker_id    = p_viewer_id AND created_at >= p_minus24h_iso) AS given_24h,
    (SELECT COUNT(*) FROM likes WHERE receiver_id = p_viewer_id AND created_at >= p_minus24h_iso AND NOT (is_boosted_like <=> 1)) AS received_24h;
END//

-- ---- get_top_likers() -------------------------------------------------------
-- Non-elite user leaderboard — কে সবচেয়ে বেশি like দিয়েছে।
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

-- ---- refresh_feed_eligibility_cache() ---------------------------------------
-- Feed-এ কোন user দেখাবে সেটা cache করে রাখে। 120s পরপর auto-call হয়।
CREATE OR REPLACE PROCEDURE refresh_feed_eligibility_cache()
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE v_active_like_count   INT;
  DECLARE v_active_window_hours INT;
  DECLARE v_window_iso          DATETIME(6);

  SELECT active_like_count, active_window_hours
    INTO v_active_like_count, v_active_window_hours
  FROM settings LIMIT 1;

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
      COALESCE(g.given_24h, 0)  AS given_24h,
      COALESCE(r.recv_24h, 0)   AS recv_24h,
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

-- ---- get_eligible_feed_links() ----------------------------------------------
-- Feed-এ দেখানোর জন্য eligible links return করে।
CREATE OR REPLACE PROCEDURE get_eligible_feed_links(
  IN p_viewer_id          CHAR(36),
  IN p_active_like_count  INT,
  IN p_active_window_hours INT,
  IN p_cooldown_hours     INT,
  IN p_limit              INT,
  IN p_offset             INT
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
      el.id, el.url, el.likes_count, el.user_id, el.created_at,
      ec.is_elite, ec.is_boosted, ec.boost_order, ec.is_slowdown,
      MAX(el.created_at) OVER(PARTITION BY el.user_id) AS max_created_at,
      ROW_NUMBER() OVER(PARTITION BY el.user_id ORDER BY el.created_at DESC) AS rank_in_user
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
    CASE WHEN rl.is_elite   THEN rl.created_at                         ELSE NULL END DESC,
    CASE WHEN rl.is_boosted THEN COALESCE(rl.boost_order, 999999999)   ELSE NULL END ASC,
    CASE WHEN rl.is_boosted THEN rl.created_at                         ELSE NULL END DESC,
    rl.rank_in_user ASC,
    rl.is_slowdown ASC,
    rl.max_created_at DESC,
    rl.user_id DESC
  LIMIT p_limit OFFSET p_offset;
END//

-- ---- process_like_commit() --------------------------------------------------
-- Like commit করার main procedure।
-- 3টা session lock, 12h cooldown check, quota management সব এখানে।
-- Returns: p_result = 1 (committed) | 0 (rejected)
CREATE OR REPLACE PROCEDURE process_like_commit(
  IN  p_liker_id              CHAR(36),
  IN  p_link_id               CHAR(36),
  IN  p_receiver_id           CHAR(36),
  IN  p_is_anon               TINYINT,
  IN  p_is_boosted_like       TINYINT,
  IN  p_offer_active          TINYINT,
  IN  p_offer_likes_required  INT,
  IN  p_offer_autolike_minutes INT,
  IN  p_active_window_hours   INT,
  IN  p_active_like_count     INT,
  IN  p_today_iso             DATETIME(6),
  OUT p_result                TINYINT
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE v_recent       INT     DEFAULT 0;
  DECLARE v_owner_cnt    INT     DEFAULT 0;
  DECLARE v_liker_cnt    INT     DEFAULT 0;
  DECLARE v_o_elite      TINYINT DEFAULT 0;
  DECLARE v_o_boosted    TINYINT DEFAULT 0;
  DECLARE v_o_bmodel     VARCHAR(20)  DEFAULT 'none';
  DECLARE v_o_bexpiry    DATETIME(6)  DEFAULT NULL;
  DECLARE v_o_bquota     INT          DEFAULT NULL;
  DECLARE v_o_bused      INT          DEFAULT 0;
  DECLARE v_o_created    DATETIME(6)  DEFAULT NULL;
  DECLARE v_owner_recv_total INT   DEFAULT 0;
  DECLARE v_is_new_user  TINYINT  DEFAULT 0;
  DECLARE v_owner_given_24h INT   DEFAULT 0;
  DECLARE v_owner_recv_24h  INT   DEFAULT 0;
  DECLARE v_window_start    DATETIME(6) DEFAULT NULL;
  DECLARE v_l_enabled       TINYINT     DEFAULT 0;
  DECLARE v_l_paused        TINYINT     DEFAULT 0;
  DECLARE v_l_model         VARCHAR(20) DEFAULT 'none';
  DECLARE v_l_expiry        DATETIME(6) DEFAULT NULL;
  DECLARE v_l_quota         INT         DEFAULT NULL;
  DECLARE v_l_used          INT         DEFAULT 0;
  DECLARE v_l_offer_count   INT         DEFAULT 0;
  DECLARE v_l_free_until    DATETIME(6) DEFAULT NULL;
  DECLARE v_l_free_paused_min INT       DEFAULT 0;
  DECLARE v_new_used        INT         DEFAULT 0;
  DECLARE v_quota           INT         DEFAULT NULL;
  DECLARE v_new_offer_count INT         DEFAULT 0;
  DECLARE v_current_until   DATETIME(6) DEFAULT NULL;

  -- Lock cleanup on error
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    DO RELEASE_LOCK(@lock_pair);
    DO RELEASE_LOCK(@lock_recv);
    DO RELEASE_LOCK(@lock_liker);
    RESIGNAL;
  END;

  SET @lock_pair  := SHA2(CONCAT(p_liker_id, ':', p_link_id), 256);
  SET @lock_recv  := SHA2(p_receiver_id, 256);
  SET @lock_liker := SHA2(p_liker_id, 256);
  SET @locked     := 0;

  IF GET_LOCK(@lock_pair,  10) > 0 THEN SET @locked := @locked + 1; END IF;
  IF GET_LOCK(@lock_recv,  10) > 0 THEN SET @locked := @locked + 1; END IF;
  IF GET_LOCK(@lock_liker, 10) > 0 THEN SET @locked := @locked + 1; END IF;

  main_block: BEGIN
    IF @locked < 3 THEN
      SET p_result = 0;
      LEAVE main_block;
    END IF;

    -- 1. 12h cooldown check
    SELECT COUNT(*) INTO v_recent
    FROM likes
    WHERE liker_id = p_liker_id AND link_id = p_link_id
      AND created_at >= DATE_SUB(NOW(6), INTERVAL 12 HOUR);

    IF v_recent > 0 THEN
      SET p_result = 0;
      LEAVE main_block;
    END IF;

    -- 2. Owner/receiver check
    SELECT COUNT(*) INTO v_owner_cnt FROM profiles WHERE id = p_receiver_id;
    IF v_owner_cnt = 0 THEN SET p_result = 0; LEAVE main_block; END IF;

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
          SET p_result = 0;
          LEAVE main_block;
        END IF;
      END IF;
    END IF;

    -- 3. Like insert
    INSERT INTO likes (id, liker_id, link_id, receiver_id, is_anonymous, is_boosted_like, created_at)
    VALUES (UUID(), p_liker_id, p_link_id, p_receiver_id, p_is_anon, p_is_boosted_like, NOW(6));

    -- 4. likes_count increment
    UPDATE links SET likes_count = COALESCE(likes_count, 0) + 1 WHERE id = p_link_id;

    -- 5. Liker auto-like usage
    SELECT COUNT(*) INTO v_liker_cnt FROM profiles WHERE id = p_liker_id;
    IF v_liker_cnt = 0 THEN SET p_result = 1; LEAVE main_block; END IF;

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
        UPDATE profiles
        SET auto_like_used = COALESCE(auto_like_used, 0) + 1
        WHERE id = p_liker_id
          AND auto_like_enabled = 1
          AND NOT auto_like_paused
          AND auto_like_model = 'usage'
          AND auto_like_quota IS NOT NULL
          AND COALESCE(auto_like_used, 0) < auto_like_quota;

        IF ROW_COUNT() > 0 THEN
          SELECT auto_like_used, auto_like_quota INTO v_new_used, v_quota FROM profiles WHERE id = p_liker_id;
          IF v_new_used >= v_quota THEN
            UPDATE profiles SET auto_like_enabled = 0, auto_like_model = 'none', auto_like_quota = NULL WHERE id = p_liker_id;
          END IF;
        ELSE
          UPDATE profiles SET auto_like_enabled = 0, auto_like_model = 'none', auto_like_quota = NULL WHERE id = p_liker_id;
        END IF;
      END IF;
    END IF;

    -- 6. Owner boost usage
    IF v_o_boosted AND NOT COALESCE(v_o_elite, 0) THEN
      IF v_o_bmodel = 'time' AND v_o_bexpiry < NOW(6) THEN
        UPDATE profiles SET is_boosted = 0, boost_model = 'none', boost_expiry = NULL, boost_order = NULL WHERE id = p_receiver_id;
      END IF;
    END IF;

    IF v_o_boosted AND p_is_boosted_like AND NOT COALESCE(v_o_elite, 0) THEN
      IF v_o_bmodel = 'usage' AND v_o_bquota IS NOT NULL THEN
        UPDATE profiles
        SET boost_used = COALESCE(boost_used, 0) + 1
        WHERE id = p_receiver_id AND is_boosted = 1 AND boost_model = 'usage'
          AND boost_quota IS NOT NULL AND COALESCE(boost_used, 0) < boost_quota;

        IF ROW_COUNT() > 0 THEN
          SELECT boost_used, boost_quota INTO v_new_used, v_quota FROM profiles WHERE id = p_receiver_id;
          IF v_new_used >= v_quota THEN
            UPDATE profiles SET is_boosted = 0, boost_model = 'none', boost_quota = NULL WHERE id = p_receiver_id;
          END IF;
        ELSE
          UPDATE profiles SET is_boosted = 0, boost_model = 'none', boost_quota = NULL WHERE id = p_receiver_id;
        END IF;
      ELSE
        UPDATE profiles SET boost_used = COALESCE(boost_used, 0) + 1 WHERE id = p_receiver_id;
      END IF;

      -- Offer: free autolike for liker after enough boosted likes
      IF p_offer_active THEN
        SET v_new_offer_count := COALESCE(v_l_offer_count, 0) + 1;
        IF v_new_offer_count >= p_offer_likes_required THEN
          IF COALESCE(v_l_paused, 0) THEN
            UPDATE profiles
            SET boosted_offer_count = 0,
                free_autolike_paused_remaining_minutes = COALESCE(v_l_free_paused_min, 0) + p_offer_autolike_minutes
            WHERE id = p_liker_id;
          ELSE
            SET v_current_until := COALESCE(v_l_free_until, NOW(6));
            IF v_current_until < NOW(6) THEN SET v_current_until := NOW(6); END IF;
            UPDATE profiles
            SET boosted_offer_count = 0,
                free_autolike_until = DATE_ADD(v_current_until, INTERVAL p_offer_autolike_minutes MINUTE)
            WHERE id = p_liker_id;
          END IF;
        ELSE
          UPDATE profiles SET boosted_offer_count = v_new_offer_count WHERE id = p_liker_id;
        END IF;
      END IF;
    END IF;

    SET p_result = 1;
  END main_block;

  DO RELEASE_LOCK(@lock_pair);
  DO RELEASE_LOCK(@lock_recv);
  DO RELEASE_LOCK(@lock_liker);
END//

DELIMITER ;

-- =============================================================================
-- SCHEDULED EVENTS (event_scheduler=ON দরকার)
-- =============================================================================

-- পুরনো likes 7 দিন পর delete (প্রতিদিন রাত ২টায় Bangladesh time = 20:00 UTC)
CREATE EVENT IF NOT EXISTS cleanup_old_likes
  ON SCHEDULE EVERY 1 DAY STARTS (TIMESTAMP(CURRENT_DATE) + INTERVAL 20 HOUR)
  ON COMPLETION PRESERVE
  DO DELETE FROM likes WHERE created_at < NOW(6) - INTERVAL 7 DAY;

-- Soft-deleted links 60 দিন পর permanently delete (রাত ২:৩০ Bangladesh = 20:30 UTC)
CREATE EVENT IF NOT EXISTS cleanup_old_deleted_links
  ON SCHEDULE EVERY 1 DAY STARTS (TIMESTAMP(CURRENT_DATE) + INTERVAL 20 HOUR + INTERVAL 30 MINUTE)
  ON COMPLETION PRESERVE
  DO DELETE FROM links WHERE sort_order < 0 AND created_at < NOW(6) - INTERVAL 60 DAY;

-- Feed eligibility cache প্রতি 120 seconds এ refresh
CREATE EVENT IF NOT EXISTS refresh_feed_eligibility_cache_event
  ON SCHEDULE EVERY 120 SECOND
  ON COMPLETION PRESERVE
  ENABLE
  COMMENT 'Feed poster eligibility cache refresh'
  DO CALL refresh_feed_eligibility_cache();

-- =============================================================================
-- INITIAL DATA POPULATION
-- =============================================================================

-- Feed cache populate (first run)
CALL refresh_feed_eligibility_cache();

-- =============================================================================
-- DONE! Tables created:
--   profiles, links, likes, blogs, settings, audit_log,
--   feed_eligibility_cache, boost_order_seq
-- Procedures created:
--   next_boost_order, add_links_atomic, get_my_stats,
--   get_top_likers, refresh_feed_eligibility_cache,
--   get_eligible_feed_links, process_like_commit
-- Events created:
--   cleanup_old_likes, cleanup_old_deleted_links,
--   refresh_feed_eligibility_cache_event
-- =============================================================================
