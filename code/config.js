// Discord OAuth2 설정
const DISCORD_CONFIG = {
  clientId: '1442154611007033344', // Discord Developer Portal에서 발급받은 Client ID
  redirectUri: 'https://sdt-ad.xyz/auth/discord/callback', // Cloudflare에서 처리할 콜백 URL
  scopes: ['identify', 'email'],
  authUrl: 'https://discord.com/api/oauth2/authorize',
  tokenUrl: 'https://discord.com/api/oauth2/token',
  apiUrl: 'https://discord.com/api/v10'
};

// API 엔드포인트
const API_BASE = 'https://sdt-ad.xyz/api';

module.exports = { DISCORD_CONFIG, API_BASE };
