# SDT 게임 오버레이 채팅

## 설치
npm install
npm start

## 배포
cd cloudflare-backend
wrangler login
wrangler d1 create sdt-overlay-db
wrangler d1 execute sdt-overlay-db --file=schema.sql
wrangler secret put DISCORD_CLIENT_SECRET
wrangler deploy
