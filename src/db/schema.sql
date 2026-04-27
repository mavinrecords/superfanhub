-- Gift Cards Table
CREATE TABLE IF NOT EXISTS gift_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  code_hash TEXT NOT NULL UNIQUE,
  code_prefix TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('standard', 'premium', 'vip')),
  card_type TEXT NOT NULL CHECK (card_type IN ('value', 'discount', 'hybrid')),
  initial_value REAL DEFAULT 0,
  current_balance REAL DEFAULT 0,
  discount_percent REAL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  discount_uses_remaining INTEGER,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'revoked', 'exhausted')),
  issued_by TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Transaction Ledger
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('issue', 'redeem', 'discount_apply', 'freeze', 'unfreeze', 'revoke', 'adjust', 'link')),
  amount REAL,
  balance_before REAL,
  balance_after REAL,
  discount_applied REAL,
  ticket_id TEXT,
  ticket_amount REAL,
  performed_by TEXT NOT NULL,
  performed_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_address TEXT,
  notes TEXT,
  FOREIGN KEY (card_id) REFERENCES gift_cards(id)
);

-- Validation Attempts for Rate Limiting
CREATE TABLE IF NOT EXISTS validation_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_address TEXT NOT NULL,
  code_prefix TEXT,
  attempted_at TEXT NOT NULL DEFAULT (datetime('now')),
  success INTEGER DEFAULT 0
);

-- Admin Users
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'admin' CHECK (role IN ('admin', 'superadmin')),
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT
);

-- Admin audit log (T0-6): every state-mutating admin action is recorded here.
-- Called explicitly from route handlers via adminAuditService.logAdminAction().
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER,
  admin_username TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details_json TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_log(admin_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_entity ON admin_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log(action, created_at);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_gift_cards_code_prefix ON gift_cards(code_prefix);
CREATE INDEX IF NOT EXISTS idx_gift_cards_user_id ON gift_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_gift_cards_status ON gift_cards(status);
CREATE INDEX IF NOT EXISTS idx_transactions_card_id ON transactions(card_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_performed_at ON transactions(performed_at);
CREATE INDEX IF NOT EXISTS idx_validation_attempts_ip ON validation_attempts(ip_address, attempted_at);

-- Reminder Log (for tracking sent reminders)
CREATE TABLE IF NOT EXISTS reminder_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL,
  reminder_type TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (card_id) REFERENCES gift_cards(id)
);

CREATE INDEX IF NOT EXISTS idx_reminder_log_card ON reminder_log(card_id, reminder_type, sent_at);

-- Temporary Tokens (for sharing, password reset, etc)
CREATE TABLE IF NOT EXISTS temp_tokens (
  token TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Loyalty Points System
CREATE TABLE IF NOT EXISTS loyalty_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  points INTEGER DEFAULT 0,
  lifetime_points INTEGER DEFAULT 0,
  tier TEXT DEFAULT 'bronze',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL, -- 'earned' or 'redeemed'
  reference_id TEXT, -- transaction id or order id
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_loyalty_email ON loyalty_points(email);
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_email ON loyalty_transactions(email);

-- Referral System
CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_email TEXT NOT NULL,
  referee_email TEXT,
  code TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'pending', -- pending, completed
  reward_status TEXT DEFAULT 'unclaimed',
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(code);

-- =============================================================
-- MAVIN SUPERFAN HUB - USER SYSTEM
-- =============================================================

-- Users Table (SuperFan accounts)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  is_verified INTEGER DEFAULT 0,
  verification_token TEXT,
  reset_token TEXT,
  reset_token_expires TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- User Sessions
CREATE TABLE IF NOT EXISTS user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- User Profiles (extended data)
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id INTEGER PRIMARY KEY,
  avatar_url TEXT,
  bio TEXT,
  favorite_artist TEXT,
  date_of_birth TEXT,
  city TEXT,
  country TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Spotify Connections
CREATE TABLE IF NOT EXISTS spotify_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  spotify_user_id TEXT NOT NULL,
  display_name TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TEXT NOT NULL,
  last_sync_at TEXT,
  total_minutes_streamed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Loyalty Cards (linked to users)
CREATE TABLE IF NOT EXISTS loyalty_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  card_number TEXT NOT NULL UNIQUE,
  tier TEXT DEFAULT 'bronze' CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum', 'diamond')),
  points INTEGER DEFAULT 0,
  lifetime_points INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('pending', 'active', 'suspended', 'revoked')),
  issued_at TEXT,
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Loyalty Card Applications
CREATE TABLE IF NOT EXISTS loyalty_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by INTEGER,
  reviewed_at TEXT,
  rejection_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES admin_users(id)
);

-- Streaming History (cached from Spotify)
CREATE TABLE IF NOT EXISTS streaming_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  spotify_track_id TEXT NOT NULL,
  track_name TEXT,
  artist_name TEXT,
  duration_ms INTEGER,
  played_at TEXT NOT NULL,
  is_mavin_artist INTEGER DEFAULT 0,
  points_awarded INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- User Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_spotify_user ON spotify_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_cards_user ON loyalty_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_cards_number ON loyalty_cards(card_number);
CREATE INDEX IF NOT EXISTS idx_streaming_history_user ON streaming_history(user_id, played_at);

-- Campaigns System
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('stream', 'social', 'event', 'quiz', 'other')),
  points INTEGER DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  target_link TEXT, -- Spotify URL, Social URL, etc.
  target_id TEXT, -- Specific Artist ID, Album ID, etc.
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'ended', 'archived')),
  image_url TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  campaign_id INTEGER NOT NULL,
  status TEXT DEFAULT 'started' CHECK (status IN ('started', 'completed')),
  completed_at TEXT,
  points_awarded INTEGER DEFAULT 0,
  proof TEXT, -- Generic field for storage (tweet ID, etc.)
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  UNIQUE(user_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_user_campaigns_user ON user_campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_user_campaigns_campaign ON user_campaigns(campaign_id);

-- =============================================================
-- COMMUNITY TASK MASTER MODULE
-- =============================================================

-- Tasks (admin-defined missions)
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('stream', 'ugc', 'social', 'referral', 'irl', 'quiz', 'daily', 'weekly')),
  category TEXT DEFAULT 'general',
  points INTEGER DEFAULT 0,
  xp INTEGER DEFAULT 0,
  max_completions INTEGER DEFAULT 1,
  required_proof TEXT CHECK (required_proof IN ('none', 'url', 'hashtag', 'qr_scan', 'screenshot', 'manual')),
  target_url TEXT,
  target_hashtag TEXT,
  artist_id TEXT,
  artist_name TEXT,
  start_date TEXT,
  end_date TEXT,
  is_recurring INTEGER DEFAULT 0,
  recurrence_interval TEXT CHECK (recurrence_interval IN ('daily', 'weekly', 'monthly', NULL)),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'expired', 'archived')),
  difficulty TEXT DEFAULT 'easy' CHECK (difficulty IN ('easy', 'medium', 'hard', 'legendary')),
  image_url TEXT,
  squad_only INTEGER DEFAULT 0,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
CREATE INDEX IF NOT EXISTS idx_tasks_artist ON tasks(artist_id);

-- Task Submissions (user task attempts + progress + proof)
CREATE TABLE IF NOT EXISTS task_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  status TEXT DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'verified', 'rejected', 'expired')),
  progress INTEGER DEFAULT 0,
  progress_target INTEGER DEFAULT 1,
  proof_type TEXT,
  proof_data TEXT,
  proof_url TEXT,
  points_awarded INTEGER DEFAULT 0,
  xp_awarded INTEGER DEFAULT 0,
  multiplier REAL DEFAULT 1.0,
  verified_by TEXT,
  verified_at TEXT,
  rejection_reason TEXT,
  submitted_at TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_submissions_user ON task_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_task_submissions_task ON task_submissions(task_id);
CREATE INDEX IF NOT EXISTS idx_task_submissions_status ON task_submissions(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_submissions_unique ON task_submissions(user_id, task_id) WHERE status != 'rejected';

-- Verification Queue (pending proof items for moderation)
CREATE TABLE IF NOT EXISTS verification_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  proof_type TEXT NOT NULL,
  proof_data TEXT,
  auto_result TEXT CHECK (auto_result IN ('pass', 'fail', 'inconclusive', NULL)),
  manual_result TEXT CHECK (manual_result IN ('approved', 'rejected', NULL)),
  reviewed_by TEXT,
  reviewed_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (submission_id) REFERENCES task_submissions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_verification_pending ON verification_queue(manual_result) WHERE manual_result IS NULL;

-- Contribution Scores (per-user score driving fan tier)
CREATE TABLE IF NOT EXISTS contribution_scores (
  user_id INTEGER PRIMARY KEY,
  total_score INTEGER DEFAULT 0,
  tasks_completed INTEGER DEFAULT 0,
  streak_bonus INTEGER DEFAULT 0,
  social_score INTEGER DEFAULT 0,
  streaming_score INTEGER DEFAULT 0,
  referral_score INTEGER DEFAULT 0,
  event_score INTEGER DEFAULT 0,
  current_tier TEXT DEFAULT 'fan' CHECK (current_tier IN ('fan', 'superfan', 'elite', 'inner_circle')),
  tier_updated_at TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Fan Tier History
CREATE TABLE IF NOT EXISTS fan_tier_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  old_tier TEXT,
  new_tier TEXT NOT NULL,
  trigger_reason TEXT,
  score_at_change INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fan_tier_history_user ON fan_tier_history(user_id);

-- Rewards Catalog
CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'general' CHECK (category IN ('merch', 'experience', 'digital', 'exclusive', 'general')),
  points_cost INTEGER NOT NULL,
  tier_required TEXT DEFAULT 'fan' CHECK (tier_required IN ('fan', 'superfan', 'elite', 'inner_circle')),
  inventory INTEGER DEFAULT -1,
  image_url TEXT,
  artist_id TEXT,
  artist_name TEXT,
  is_active INTEGER DEFAULT 1,
  redemption_instructions TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rewards_active ON rewards(is_active);
CREATE INDEX IF NOT EXISTS idx_rewards_category ON rewards(category);

-- Reward Redemptions
CREATE TABLE IF NOT EXISTS reward_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  reward_id INTEGER NOT NULL,
  points_spent INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'fulfilled', 'cancelled')),
  fulfillment_data TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reward_id) REFERENCES rewards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reward_redemptions_user ON reward_redemptions(user_id);

-- Squads (artist-hub teams)
CREATE TABLE IF NOT EXISTS squads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  artist_id TEXT,
  artist_name TEXT,
  description TEXT,
  max_members INTEGER DEFAULT 50,
  leader_user_id INTEGER,
  total_score INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (leader_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_squads_artist ON squads(artist_id);

-- Squad Members
CREATE TABLE IF NOT EXISTS squad_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  squad_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('leader', 'member')),
  contribution INTEGER DEFAULT 0,
  joined_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (squad_id) REFERENCES squads(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(squad_id, user_id)
);

-- Squad Missions (team-based tasks)
CREATE TABLE IF NOT EXISTS squad_missions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  squad_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  target_completions INTEGER DEFAULT 10,
  current_completions INTEGER DEFAULT 0,
  bonus_points INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired')),
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (squad_id) REFERENCES squads(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_squad_missions_squad ON squad_missions(squad_id);

-- Streaks
CREATE TABLE IF NOT EXISTS streaks (
  user_id INTEGER PRIMARY KEY,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_activity_date TEXT,
  streak_type TEXT DEFAULT 'daily',
  bonus_multiplier REAL DEFAULT 1.0,
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Daily/Weekly Challenges (auto-generated)
CREATE TABLE IF NOT EXISTS daily_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  challenge_date TEXT NOT NULL,
  challenge_type TEXT DEFAULT 'daily' CHECK (challenge_type IN ('daily', 'weekly')),
  bonus_points INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_daily_challenges_date ON daily_challenges(challenge_date, challenge_type);

-- Leaderboard Cache (materialized for performance)
CREATE TABLE IF NOT EXISTS leaderboard_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  user_name TEXT,
  scope TEXT DEFAULT 'global',
  scope_id TEXT,
  rank INTEGER,
  score INTEGER DEFAULT 0,
  tasks_completed INTEGER DEFAULT 0,
  current_tier TEXT,
  streak INTEGER DEFAULT 0,
  period TEXT DEFAULT 'all_time' CHECK (period IN ('daily', 'weekly', 'monthly', 'all_time')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_scope ON leaderboard_cache(scope, scope_id, period);
CREATE INDEX IF NOT EXISTS idx_leaderboard_rank ON leaderboard_cache(rank);

-- Campaign Multipliers (boost events)
CREATE TABLE IF NOT EXISTS campaign_multipliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER,
  title TEXT NOT NULL,
  multiplier REAL DEFAULT 1.5,
  applies_to TEXT DEFAULT 'all' CHECK (applies_to IN ('all', 'stream', 'ugc', 'social', 'referral', 'irl')),
  artist_id TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_multipliers_active ON campaign_multipliers(is_active, start_date, end_date);

-- Task Fraud Flags
CREATE TABLE IF NOT EXISTS task_fraud_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  submission_id INTEGER,
  flag_type TEXT NOT NULL CHECK (flag_type IN ('duplicate_proof', 'velocity_abuse', 'bot_pattern', 'suspicious_ip', 'same_proof_reuse', 'manual_flag')),
  severity TEXT DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  details TEXT,
  resolved INTEGER DEFAULT 0,
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (submission_id) REFERENCES task_submissions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_fraud_flags_user ON task_fraud_flags(user_id);
CREATE INDEX IF NOT EXISTS idx_fraud_flags_unresolved ON task_fraud_flags(resolved) WHERE resolved = 0;

-- ============================================================
-- PERFORMANCE INDEXES (Cleanup Pass)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_campaigns_created_by
    ON campaigns(created_by);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id
    ON user_profiles(user_id);

CREATE INDEX IF NOT EXISTS idx_loyalty_applications_user_id
    ON loyalty_applications(user_id);

CREATE INDEX IF NOT EXISTS idx_fraud_flags_created_at
    ON task_fraud_flags(created_at);

CREATE INDEX IF NOT EXISTS idx_streaming_history_created_at
    ON streaming_history(created_at);

CREATE INDEX IF NOT EXISTS idx_user_campaigns_campaign_status
    ON user_campaigns(campaign_id, status);

-- referrals.referrer_user_id index — column added via migrate.js
-- This is a no-op on fresh DBs until migrate.js has run, but safe to include.
-- CREATE INDEX IF NOT EXISTS idx_referrals_referrer_user_id ON referrals(referrer_user_id);

-- ============================================================
-- ARTIST ROSTER (Single Source of Truth)
-- ============================================================
-- Used by:
--   • Frontend display (GET /api/artists) — hero tags, marquee
--   • Spotify ingestion allowlist (isMavinTrack) via spotify_artist_id
--   • All artist_id FK strings across tasks, squads, rewards, campaign_multipliers
--
-- Seeded and managed via src/db/migrate.js and POST/PATCH/DELETE /api/admin/artists.

CREATE TABLE IF NOT EXISTS artists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,                 -- kebab-case stable ID, e.g. "ayra-starr"; used as the FK string by other tables
  display_name TEXT NOT NULL,
  spotify_artist_id TEXT UNIQUE,             -- nullable — can be filled in later via admin UI
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_artists_active ON artists(active);
CREATE INDEX IF NOT EXISTS idx_artists_spotify ON artists(spotify_artist_id);

-- =============================================================
-- LAST.FM CONNECTIONS (Phase 1.5 — zero-OAuth power-user path)
-- =============================================================
-- Username-based, no OAuth. Users type their Last.fm username on the
-- dashboard; we query ws.audioscrobbler.com with a shared API key.
-- Scrobbles land in streaming_history with spotify_track_id prefixed `lf:`
-- so getStreamingStats + the fraud-prevention cap + variety bonus continue
-- to work uniformly across both data sources.

CREATE TABLE IF NOT EXISTS lastfm_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  lastfm_username TEXT NOT NULL,          -- stored lowercased (Last.fm is case-insensitive)
  display_name TEXT,                      -- user.getInfo.realname (or username fallback)
  playcount INTEGER DEFAULT 0,            -- from user.getInfo — lifetime scrobbles on Last.fm
  registered_unix INTEGER,                -- user.getInfo.registered.unixtime
  last_sync_at TEXT,
  last_played_at_unix INTEGER DEFAULT 0,  -- high-water mark for incremental sync (uts of most recent stored scrobble)
  total_mavin_scrobbles INTEGER DEFAULT 0,-- our running tally of Mavin-matched scrobbles ever ingested
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lastfm_user ON lastfm_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_lastfm_username ON lastfm_connections(lastfm_username);
