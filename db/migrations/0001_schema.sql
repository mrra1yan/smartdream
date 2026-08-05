-- =============================================================================
-- SmartDream — MySQL 8 schema (replaces supabase/setup.sql + migrations
-- 0001–0017). Run via:  node scripts/migrate.mjs up
--
-- Conventions:
--   * UUIDs stored as CHAR(36) (app code is string-based; no binary conversion)
--   * All timestamps DATETIME(6), stored in UTC (container TZ=UTC, client
--     connection `timezone: 'Z'`)
--   * Booleans TINYINT(1)
--   * audit_log.metadata is JSON
--   * No RLS (browser never touches the DB directly — every query goes
--     through server actions / the app's MySQL user). Access control is
--     application-layer (getCurrentUser + role checks), mirroring the old
--     service-role model.
-- =============================================================================

-- ---- profiles --------------------------------------------------------------
-- Mirrors the old public.profiles plus a bcrypt password_hash column
-- (Supabase Auth previously owned passwords; we now own them).
CREATE TABLE IF NOT EXISTS profiles (
  id                                        CHAR(36) PRIMARY KEY,
  public_id                                 VARCHAR(20) NULL,
  first_name                                VARCHAR(100) NULL,
  last_name                                 VARCHAR(100) NULL,
  phone                                     VARCHAR(50) NULL,
  email                                     VARCHAR(255) NULL,
  password_hash                             VARCHAR(100) NULL,
  role                                      VARCHAR(20) NOT NULL DEFAULT 'user',
  status                                    VARCHAR(20) NOT NULL DEFAULT 'pending',
  is_elite                                  TINYINT(1) NOT NULL DEFAULT 0,
  is_boosted                                TINYINT(1) NOT NULL DEFAULT 0,
  boost_order                               INT NULL,
  boost_model                               VARCHAR(20) NOT NULL DEFAULT 'none',
  boost_expiry                              DATETIME(6) NULL,
  boost_quota                               INT NULL,
  boost_used                                INT NOT NULL DEFAULT 0,
  auto_like_enabled                         TINYINT(1) NOT NULL DEFAULT 0,
  auto_like_model                           VARCHAR(20) NOT NULL DEFAULT 'none',
  auto_like_expiry                          DATETIME(6) NULL,
  auto_like_quota                           INT NULL,
  auto_like_used                            INT NOT NULL DEFAULT 0,
  free_autolike_until                       DATETIME(6) NULL,
  auto_like_paused                          TINYINT(1) NOT NULL DEFAULT 0,
  auto_like_paused_remaining_minutes        INT NULL,
  free_autolike_paused_remaining_minutes    INT NULL,
  boosted_offer_count                       INT NOT NULL DEFAULT 0,
  referred_by                               CHAR(36) NULL,
  approved_by                               CHAR(36) NULL,
  created_at                                DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  -- Emulates Postgres' partial unique index (profiles_phone_unique_idx):
  -- MySQL has no partial indexes, so a generated column maps non-empty
  -- phones to themselves and NULL for everything else.
  phone_key VARCHAR(50) GENERATED ALWAYS AS (
    CASE WHEN phone IS NOT NULL AND phone <> '' THEN phone ELSE NULL END
  ) STORED,
  UNIQUE KEY profiles_phone_unique (phone_key),
  KEY profiles_email_idx (email),
  KEY profiles_public_id_idx (public_id),
  KEY profiles_status_role_elite_idx (status, role, is_elite),
  KEY profiles_referred_by_idx (referred_by),
  KEY profiles_is_elite_idx (is_elite),
  KEY profiles_is_boosted_order_idx (is_boosted, boost_order),
  CONSTRAINT profiles_referred_by_fk FOREIGN KEY (referred_by) REFERENCES profiles (id) ON DELETE SET NULL,
  CONSTRAINT profiles_approved_by_fk FOREIGN KEY (approved_by) REFERENCES profiles (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---- links -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS links (
  id          CHAR(36) PRIMARY KEY,
  user_id     CHAR(36) NOT NULL,
  url         TEXT NULL,
  likes_count INT NOT NULL DEFAULT 0,
  sort_order  BIGINT NOT NULL DEFAULT 0,  -- negative = soft-deleted (see 0002)
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY links_user_id_idx (user_id),
  KEY idx_links_user_sort (user_id, sort_order),
  CONSTRAINT links_user_fk FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---- likes ----------------------------------------------------------------
-- 7-day retention cleanup via EVENT (was pg_cron 0009).
CREATE TABLE IF NOT EXISTS likes (
  id              CHAR(36) PRIMARY KEY,
  liker_id        CHAR(36) NULL,
  link_id         CHAR(36) NULL,
  receiver_id     CHAR(36) NOT NULL,
  is_anonymous    TINYINT(1) NOT NULL DEFAULT 0,
  is_boosted_like TINYINT(1) NOT NULL DEFAULT 0,
  created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY likes_receiver_idx (receiver_id),
  KEY likes_liker_idx (liker_id),
  KEY idx_likes_liker_created_at (liker_id, created_at),
  KEY idx_likes_receiver_created_at (receiver_id, created_at),
  KEY idx_likes_liker_link_created (liker_id, link_id, created_at),
  CONSTRAINT likes_liker_fk FOREIGN KEY (liker_id) REFERENCES profiles (id) ON DELETE SET NULL,
  CONSTRAINT likes_link_fk FOREIGN KEY (link_id) REFERENCES links (id) ON DELETE CASCADE,
  CONSTRAINT likes_receiver_fk FOREIGN KEY (receiver_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---- blogs -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blogs (
  id           CHAR(36) PRIMARY KEY,
  title        VARCHAR(255) NULL,
  slug         VARCHAR(255) NULL,
  excerpt      TEXT NULL,
  content      LONGTEXT NULL,
  hero_image   TEXT NULL,
  published_at DATETIME(6) NULL,
  created_by   CHAR(36) NULL,
  created_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY blogs_slug_unique (slug),
  KEY blogs_created_by_idx (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---- settings --------------------------------------------------------------
-- Single-row config table (row id='1'), as before.
CREATE TABLE IF NOT EXISTS settings (
  id                                  VARCHAR(20) PRIMARY KEY,
  whatsapp_number                     TEXT NULL,
  active_like_count                   INT NOT NULL DEFAULT 0,
  active_window_hours                 INT NOT NULL DEFAULT 24,
  elite_weight                        INT NOT NULL DEFAULT 50,
  offer_likes_required                INT NOT NULL DEFAULT 100,
  offer_autolike_minutes              INT NOT NULL DEFAULT 60,
  offer_active                        TINYINT(1) NOT NULL DEFAULT 0,
  boost_price_no_expiry               INT NULL,
  boost_price_1w                      INT NULL,
  boost_price_1m                      INT NULL,
  boost_price_3m                      INT NULL,
  boost_price_6m                      INT NULL,
  boost_price_1y                      INT NULL,
  boost_price_usage_per_unit          INT NULL,
  autolike_price_no_expiry            INT NULL,
  autolike_price_1w                   INT NULL,
  autolike_price_1m                   INT NULL,
  autolike_price_3m                   INT NULL,
  autolike_price_6m                   INT NULL,
  autolike_price_1y                   INT NULL,
  autolike_price_usage_per_unit       INT NULL,
  referral_reward_referrer_minutes    INT NOT NULL DEFAULT 1440,
  referral_reward_referee_minutes     INT NOT NULL DEFAULT 720,
  level1_name                         VARCHAR(50) NULL,
  level1_threshold                    INT NULL,
  level2_name                         VARCHAR(50) NULL,
  level2_threshold                    INT NULL,
  level3_name                         VARCHAR(50) NULL,
  level3_threshold                    INT NULL,
  level4_name                         VARCHAR(50) NULL,
  level4_threshold                    INT NULL,
  created_at                          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at                          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO settings (id) VALUES ('1')
  ON DUPLICATE KEY UPDATE id = id;

-- ---- audit_log -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          CHAR(36) PRIMARY KEY,
  actor_id    CHAR(36) NULL,
  actor_role  VARCHAR(20) NULL,
  action      VARCHAR(255) NOT NULL,
  target_id   CHAR(36) NULL,
  metadata    JSON NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY audit_log_created_at_idx (created_at),
  KEY audit_log_actor_idx (actor_id),
  CONSTRAINT audit_log_actor_fk FOREIGN KEY (actor_id) REFERENCES profiles (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================================
-- Scheduled jobs (was pg_cron):
--   * cleanup_old_likes        — 20:00 UTC daily (02:00 Bangladesh)
--   * cleanup_old_deleted_links — 20:30 UTC daily (02:30 Bangladesh)
-- Requires the container to run with --event-scheduler=ON (docker-compose.yml
-- already sets this).
-- =============================================================================
DELIMITER //
CREATE EVENT IF NOT EXISTS cleanup_old_likes
  ON SCHEDULE EVERY 1 DAY STARTS (TIMESTAMP(CURRENT_DATE) + INTERVAL 20 HOUR)
  ON COMPLETION PRESERVE
  DO
    DELETE FROM likes WHERE created_at < NOW(6) - INTERVAL 7 DAY;//

CREATE EVENT IF NOT EXISTS cleanup_old_deleted_links
  ON SCHEDULE EVERY 1 DAY STARTS (TIMESTAMP(CURRENT_DATE) + INTERVAL 20 HOUR + INTERVAL 30 MINUTE)
  ON COMPLETION PRESERVE
  DO
    DELETE FROM links WHERE sort_order < 0 AND created_at < NOW(6) - INTERVAL 60 DAY;//

DELIMITER ;
