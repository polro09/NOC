-- Cloudflare D1 Database Schema
-- sdt-ad.xyz 데이터베이스

-- 사용자 테이블
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT UNIQUE NOT NULL,
  discord_username TEXT NOT NULL,
  custom_nickname TEXT NOT NULL,
  avatar TEXT,
  email TEXT,
  guild_id INTEGER,
  role TEXT DEFAULT 'user', -- user, super_admin
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (guild_id) REFERENCES guilds(id)
);

-- 길드 테이블
CREATE TABLE IF NOT EXISTS guilds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  short_name TEXT,
  short_name_color TEXT DEFAULT '#667eea', -- ✅ 약어 색상
  name TEXT NOT NULL,
  logo TEXT,
  faction TEXT NOT NULL,
  recruitment TEXT NOT NULL,
  description TEXT,
  contact TEXT,
  owner_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(discord_id)
);

-- 채널 테이블
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  logo TEXT,
  password TEXT,
  owner_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(discord_id)
);

-- ✅ 채널 멤버 테이블 (권한, 경고, 뮤트 추가)
CREATE TABLE IF NOT EXISTS channel_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT DEFAULT 'user', -- owner, admin, moderator, user
  nickname_color TEXT DEFAULT '#ffffff',
  warnings INTEGER DEFAULT 0,
  is_muted INTEGER DEFAULT 0,
  muted_until TIMESTAMP,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channel_id) REFERENCES channels(id),
  FOREIGN KEY (user_id) REFERENCES users(discord_id),
  UNIQUE(channel_id, user_id)
);

-- ✅ 채널 밴 테이블 (입장금지)
CREATE TABLE IF NOT EXISTS channel_bans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  banned_by TEXT NOT NULL,
  reason TEXT,
  banned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channel_id) REFERENCES channels(id),
  FOREIGN KEY (user_id) REFERENCES users(discord_id),
  FOREIGN KEY (banned_by) REFERENCES users(discord_id),
  UNIQUE(channel_id, user_id)
);

-- ✅ 경고 로그 테이블
CREATE TABLE IF NOT EXISTS channel_warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  warned_by TEXT NOT NULL,
  reason TEXT,
  warned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channel_id) REFERENCES channels(id),
  FOREIGN KEY (user_id) REFERENCES users(discord_id),
  FOREIGN KEY (warned_by) REFERENCES users(discord_id)
);

-- 메시지 테이블
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'chat', -- chat, system, warning
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channel_id) REFERENCES channels(id),
  FOREIGN KEY (user_id) REFERENCES users(discord_id)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id);
CREATE INDEX IF NOT EXISTS idx_users_guild_id ON users(guild_id);
CREATE INDEX IF NOT EXISTS idx_guilds_owner ON guilds(owner_id);
CREATE INDEX IF NOT EXISTS idx_channels_owner ON channels(owner_id);
CREATE INDEX IF NOT EXISTS idx_channel_members_channel ON channel_members(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_members_user ON channel_members(user_id);
CREATE INDEX IF NOT EXISTS idx_channel_bans_channel ON channel_bans(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_bans_user ON channel_bans(user_id);
CREATE INDEX IF NOT EXISTS idx_channel_warnings_channel ON channel_warnings(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_warnings_user ON channel_warnings(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

-- ✅ 총 관리자 설정 (Discord ID: 257097077782216704)
-- 앱에서 하드코딩으로 처리