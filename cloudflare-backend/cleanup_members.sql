-- ============================================
-- WOSB 채널 멤버 데이터 정리 SQL
-- D1 콘솔에서 실행하세요
-- ============================================

-- 1. 모든 채널 멤버 데이터 삭제 (인원수 리셋)
DELETE FROM channel_members;

-- 2. 확인
SELECT 'channel_members 삭제됨' as status, COUNT(*) as remaining FROM channel_members;

-- 3. (선택) 채널 경고 로그 삭제
-- DELETE FROM channel_warnings;

-- 4. (선택) 채널 밴 목록 삭제
-- DELETE FROM channel_bans;

-- 5. 인덱스 재구성 (선택 - 성능 향상)
-- VACUUM;