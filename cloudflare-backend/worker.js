// Cloudflare Workers - Discord OAuth Handler
// sdt-ad.xyz 도메인에 배포

// ChatRoom Durable Object import
import { ChatRoom } from './chat-room.js';

export { ChatRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // CORS 헤더
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Credentials': 'true'
    };
    
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // 라우팅
    if (url.pathname === '/auth/discord/callback') {
      return handleDiscordCallback(request, env, corsHeaders);
    }
    
    if (url.pathname === '/api/auth/check') {
      return handleAuthCheck(request, env, corsHeaders);
    }
    
    if (url.pathname === '/api/auth/verify') {
      return handleAuthVerify(request, env, corsHeaders);
    }
    
    if (url.pathname === '/api/users/profile') {
      return handleProfileUpdate(request, env, corsHeaders);
    }
    
    if (url.pathname.startsWith('/api/guilds')) {
      return handleGuilds(request, env, corsHeaders);
    }
    
    if (url.pathname.startsWith('/api/channels')) {
      return handleChannels(request, env, corsHeaders);
    }
    
    // WebSocket 연결
    if (url.pathname === '/ws') {
      return handleWebSocket(request, env);
    }
    
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};

// WebSocket 연결 처리
async function handleWebSocket(request, env) {
  // Durable Object로 요청 전달
  const id = env.CHAT_ROOMS.idFromName('global-chat');
  const stub = env.CHAT_ROOMS.get(id);
  
  return stub.fetch(request);
}

// Discord OAuth 콜백 처리
async function handleDiscordCallback(request, env, corsHeaders) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  
  if (!code) {
    return new Response('Authorization code not found', { 
      status: 400, 
      headers: corsHeaders 
    });
  }
  
  try {
    // Discord에서 액세스 토큰 받기
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: env.DISCORD_REDIRECT_URI
      })
    });
    
    const tokenData = await tokenResponse.json();
    
    if (!tokenData.access_token) {
      throw new Error('Failed to get access token');
    }
    
    // Discord 사용자 정보 가져오기
    const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    });
    
    const discordUser = await userResponse.json();
    
    // 세션 ID 생성
    const sessionId = crypto.randomUUID();
    
    // KV에 세션 저장 (1시간 TTL)
    await env.SESSIONS.put(sessionId, JSON.stringify({
      discordUser,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000)
    }), {
      expirationTtl: 3600
    });
    
    // HTML 응답 (자동으로 창 닫기)
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>로그인 완료</title>
      </head>
      <body>
        <script>
          localStorage.setItem('sessionId', '${sessionId}');
          window.close();
        </script>
        <p>로그인 완료! 이 창을 닫아도 됩니다.</p>
      </body>
      </html>
    `;
    
    return new Response(html, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html'
      }
    });
  } catch (error) {
    console.error('Discord OAuth error:', error);
    return new Response('Authentication failed', { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}

// 인증 확인
async function handleAuthCheck(request, env, corsHeaders) {
  const sessionId = request.headers.get('X-Session-ID');
  
  if (!sessionId) {
    return new Response(JSON.stringify({ authenticated: false }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  const sessionData = await env.SESSIONS.get(sessionId);
  
  if (!sessionData) {
    return new Response(JSON.stringify({ authenticated: false }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  const session = JSON.parse(sessionData);
  
  return new Response(JSON.stringify({
    authenticated: true,
    user: session.discordUser
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// JWT 토큰 검증
async function handleAuthVerify(request, env, corsHeaders) {
  const authHeader = request.headers.get('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }
  
  const token = authHeader.substring(7);
  
  // TODO: JWT 검증 로직
  // 현재는 세션 ID로 간단하게 확인
  const sessionData = await env.SESSIONS.get(token);
  
  if (!sessionData) {
    return new Response('Invalid token', { status: 401, headers: corsHeaders });
  }
  
  return new Response(JSON.stringify({ valid: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// 프로필 업데이트
async function handleProfileUpdate(request, env, corsHeaders) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { 
      status: 405, 
      headers: corsHeaders 
    });
  }
  
  const data = await request.json();
  
  // D1 데이터베이스에 사용자 정보 저장
  await env.DB.prepare(`
    INSERT INTO users (discord_id, discord_username, custom_nickname, avatar, email)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      custom_nickname = excluded.custom_nickname,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    data.discordId,
    data.discordUsername,
    data.customNickname,
    data.avatar,
    data.email
  ).run();
  
  // JWT 토큰 생성 (간단하게 세션 ID 사용)
  const token = crypto.randomUUID();
  
  await env.SESSIONS.put(token, JSON.stringify(data), {
    expirationTtl: 86400 // 24시간
  });
  
  return new Response(JSON.stringify({
    success: true,
    token: token,
    user: data
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// 길드 관리
async function handleGuilds(request, env, corsHeaders) {
  const url = new URL(request.url);
  
  if (request.method === 'GET') {
    // 길드 목록 조회
    const { results } = await env.DB.prepare(`
      SELECT * FROM guilds ORDER BY created_at DESC
    `).all();
    
    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  if (request.method === 'POST') {
    // 길드 생성
    const data = await request.json();
    
    await env.DB.prepare(`
      INSERT INTO guilds (name, faction, recruitment, description, contact, owner_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      data.name,
      data.faction,
      data.recruitment,
      data.description,
      data.contact,
      data.ownerId
    ).run();
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  return new Response('Method not allowed', { 
    status: 405, 
    headers: corsHeaders 
  });
}

// 채널 관리
async function handleChannels(request, env, corsHeaders) {
  if (request.method === 'GET') {
    // 채널 목록 조회
    const { results } = await env.DB.prepare(`
      SELECT id, name, owner_id, 
             CASE WHEN password IS NOT NULL THEN 1 ELSE 0 END as has_password
      FROM channels ORDER BY created_at DESC
    `).all();
    
    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  if (request.method === 'POST') {
    // 채널 생성
    const data = await request.json();
    
    await env.DB.prepare(`
      INSERT INTO channels (name, password, owner_id)
      VALUES (?, ?, ?)
    `).bind(
      data.name,
      data.password,
      data.ownerId
    ).run();
    
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  return new Response('Method not allowed', { 
    status: 405, 
    headers: corsHeaders 
  });
}
