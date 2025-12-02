-- 마이그레이션: 관리자 시스템 추가
-- 실행일: 2024

-- 1. 길드 테이블에 약어 색상 컬럼 추가
ALTER TABLE guilds ADD COLUMN short_name_color TEXT DEFAULT '#667eea';

-- 2. 채널 멤버 테이블에 권한/경고/뮤트 컬럼 추가
ALTER TABLE channel_members ADD COLUMN role TEXT DEFAULT 'user';
ALTER TABLE channel_members ADD COLUMN warnings INTEGER DEFAULT 0;
ALTER TABLE channel_members ADD COLUMN is_muted INTEGER DEFAULT 0;
ALTER TABLE channel_members ADD COLUMN muted_until TIMESTAMP;

-- 3. 채널 밴 테이블 생성 (입장금지)
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

-- 4. 경고 로그 테이블 생성
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

-- 5. 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_channel_bans_channel ON channel_bans(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_bans_user ON channel_bans(user_id);
CREATE INDEX IF NOT EXISTS idx_channel_warnings_channel ON channel_warnings(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_warnings_user ON channel_warnings(user_id);
