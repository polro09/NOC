// Cloudflare Workers - 통합 서버
// Discord OAuth + REST API + WebSocket Chat

// ============================================
// ChatRoom Durable Object (WebSocket 채팅)
// ============================================
export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map(); // { userId: session }
    this.channelMembers = new Map(); // { channelId: Set(userIds) }
  }
  
  async fetch(request) {
    const url = new URL(request.url);
    
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }
    
    if (url.pathname.startsWith('/messages')) {
      return this.handleMessages(request);
    }
    
    return new Response('Not found', { status: 404 });
  }
  
  async handleWebSocket(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    
    const session = {
      webSocket: server,
      userId: null,
      channelId: null,
      nickname: null,
      guild: null,
      nicknameColor: '#ffffff'
    };
    
    server.accept();
    
    server.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data);
        await this.handleMessage(session, data);
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });
    
    server.addEventListener('close', () => {
      this.sessions.delete(session.userId);
      
      if (session.channelId) {
        // 채널 멤버에서 제거
        const members = this.channelMembers.get(session.channelId);
        if (members) {
          members.delete(session.userId);
        }
        
        // 퇴장 알림
        this.broadcast(session.channelId, {
          type: 'user_left',
          userId: session.userId,
          nickname: session.nickname
        }, session.userId);
        
        // 인원수 브로드캐스트
        this.broadcastMemberCount(session.channelId);
      }
    });
    
    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }
  
  async handleMessage(session, data) {
    switch (data.type) {
      case 'auth':
        await this.handleAuth(session, data);
        break;
      case 'join_channel':
        await this.handleJoinChannel(session, data);
        break;
      case 'message':
        await this.handleChatMessage(session, data);
        break;
      case 'leave_channel':
        await this.handleLeaveChannel(session, data);
        break;
    }
  }
  
  async handleAuth(session, data) {
    const sessionData = await this.env.SESSIONS.get(data.token);
    
    if (!sessionData) {
      session.webSocket.send(JSON.stringify({
        type: 'error',
        message: 'Invalid token'
      }));
      session.webSocket.close();
      return;
    }
    
    const userData = JSON.parse(sessionData);
    session.userId = userData.discordId;
    session.nickname = userData.customNickname;
    session.guild = userData.guild || '없음';
    
    this.sessions.set(session.userId, session);
    
    session.webSocket.send(JSON.stringify({
      type: 'auth_success',
      userId: session.userId
    }));
  }
  
  async handleJoinChannel(session, data) {
    session.channelId = data.channelId;
    
    // 채널 멤버 추가
    if (!this.channelMembers.has(data.channelId)) {
      this.channelMembers.set(data.channelId, new Set());
    }
    this.channelMembers.get(data.channelId).add(session.userId);
    
    // DB에 멤버 추가
    await this.env.DB.prepare(`
      INSERT OR IGNORE INTO channel_members (channel_id, user_id)
      VALUES (?, ?)
    `).bind(data.channelId, session.userId).run();
    
    // 입장 알림
    this.broadcast(session.channelId, {
      type: 'user_joined',
      userId: session.userId,
      nickname: session.nickname,
      guild: session.guild
    }, session.userId);
    
    // 인원수 브로드캐스트
    this.broadcastMemberCount(session.channelId);
    
    // 최근 메시지 전송
    const { results } = await this.env.DB.prepare(`
      SELECT m.*, u.custom_nickname, u.guild_id, cm.nickname_color, g.name as guild_name
      FROM messages m
      JOIN users u ON m.user_id = u.discord_id
      LEFT JOIN channel_members cm ON cm.channel_id = m.channel_id AND cm.user_id = m.user_id
      LEFT JOIN guilds g ON u.guild_id = g.id
      WHERE m.channel_id = ?
      ORDER BY m.created_at DESC
      LIMIT 50
    `).bind(data.channelId).all();
    
    session.webSocket.send(JSON.stringify({
      type: 'message_history',
      messages: results.reverse()
    }));
  }
  
  async handleChatMessage(session, data) {
    if (!session.channelId || !session.userId) {
      return;
    }
    
    // 메시지 저장
    await this.env.DB.prepare(`
      INSERT INTO messages (channel_id, user_id, content)
      VALUES (?, ?, ?)
    `).bind(session.channelId, session.userId, data.content).run();
    
    // 닉네임 색상 조회
    const { results } = await this.env.DB.prepare(`
      SELECT nickname_color FROM channel_members
      WHERE channel_id = ? AND user_id = ?
    `).bind(session.channelId, session.userId).all();
    
    const nicknameColor = results[0]?.nickname_color || '#ffffff';
    
    // ✅ 길드 정보 포함하여 브로드캐스트
    this.broadcast(session.channelId, {
      type: 'message',
      author: session.nickname,
      authorId: session.userId,
      authorColor: nicknameColor,
      guild: session.guild || '없음', // ✅ 길드 정보
      content: data.content,
      timestamp: new Date().toISOString()
    });
  }
  
  async handleLeaveChannel(session, data) {
    const channelId = session.channelId;
    
    // 채널 멤버에서 제거
    const members = this.channelMembers.get(channelId);
    if (members) {
      members.delete(session.userId);
    }
    
    session.channelId = null;
    
    // 퇴장 알림
    this.broadcast(channelId, {
      type: 'user_left',
      userId: session.userId,
      nickname: session.nickname
    }, session.userId);
    
    // 인원수 브로드캐스트
    this.broadcastMemberCount(channelId);
  }
  
  broadcast(channelId, message, excludeUserId = null) {
    const messageStr = JSON.stringify(message);
    
    for (const [userId, session] of this.sessions) {
      if (session.channelId === channelId && userId !== excludeUserId) {
        try {
          session.webSocket.send(messageStr);
        } catch (error) {
          console.error('Broadcast error:', error);
        }
      }
    }
  }
  
  // ✅ 인원수 브로드캐스트
  broadcastMemberCount(channelId) {
    const members = this.channelMembers.get(channelId);
    const count = members ? members.size : 0;
    
    this.broadcast(channelId, {
      type: 'member_count',
      channelId: channelId,
      count: count
    });
  }
  
  async handleMessages(request) {
    const url = new URL(request.url);
    const channelId = url.searchParams.get('channelId');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    
    const { results } = await this.env.DB.prepare(`
      SELECT m.*, u.custom_nickname, u.guild_id, cm.nickname_color, g.name as guild_name
      FROM messages m
      JOIN users u ON m.user_id = u.discord_id
      LEFT JOIN channel_members cm ON cm.channel_id = m.channel_id AND cm.user_id = m.user_id
      LEFT JOIN guilds g ON u.guild_id = g.id
      WHERE m.channel_id = ?
      ORDER BY m.created_at DESC
      LIMIT ?
    `).bind(channelId, limit).all();
    
    return new Response(JSON.stringify(results.reverse()), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ============================================
// Main Worker (HTTP API)
// ============================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Session-ID',
      'Access-Control-Allow-Credentials': 'true'
    };
    
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // WebSocket 연결
    if (url.pathname.startsWith('/ws')) {
      const match = url.pathname.match(/^\/ws\/channel\/(.+)$/);
      const channelId = match ? match[1] : 'general';
      
      const id = env.CHAT_ROOMS.idFromName(channelId);
      const stub = env.CHAT_ROOMS.get(id);
      return stub.fetch(request);
    }
    
    // Discord OAuth 콜백
    if (url.pathname === '/auth/discord/callback') {
      return handleDiscordCallback(request, env, corsHeaders);
    }
    
    // 인증 확인
    if (url.pathname === '/api/auth/check') {
      return handleAuthCheck(request, env, corsHeaders);
    }
    
    // 토큰 검증
    if (url.pathname === '/api/auth/verify') {
      return handleAuthVerify(request, env, corsHeaders);
    }
    
    // ✅ 프로필 업데이트 (PUT 지원)
    if (url.pathname === '/api/users/profile') {
      if (request.method === 'POST') {
        return handleProfileCreate(request, env, corsHeaders);
      } else if (request.method === 'PUT') {
        return handleProfileUpdate(request, env, corsHeaders);
      }
    }
    
    // ✅ 길드 관리
    if (url.pathname.startsWith('/api/guilds')) {
      if (url.pathname === '/api/guilds' && request.method === 'GET') {
        return handleGuildsList(request, env, corsHeaders);
      } else if (url.pathname === '/api/guilds' && request.method === 'POST') {
        return handleGuildCreate(request, env, corsHeaders);
      } else if (url.pathname.match(/^\/api\/guilds\/(.+)$/)) {
        const guildId = url.pathname.match(/^\/api\/guilds\/(.+)$/)[1];
        if (request.method === 'PUT') {
          return handleGuildUpdate(request, env, corsHeaders, guildId);
        } else if (request.method === 'DELETE') {
          return handleGuildDelete(request, env, corsHeaders, guildId);
        }
      }
    }
    
    // ✅ 채널 관리
    if (url.pathname.startsWith('/api/channels')) {
      if (url.pathname === '/api/channels' && request.method === 'GET') {
        return handleChannelsList(request, env, corsHeaders);
      } else if (url.pathname === '/api/channels' && request.method === 'POST') {
        return handleChannelCreate(request, env, corsHeaders);
      } else if (url.pathname === '/api/channels/verify-password') {
        return handleChannelVerify(request, env, corsHeaders);
      } else if (url.pathname === '/api/channels/member-counts') {
        return handleMemberCounts(request, env, corsHeaders);
      } else if (url.pathname.match(/^\/api\/channels\/(.+)\/member-count$/)) {
        const channelId = url.pathname.match(/^\/api\/channels\/(.+)\/member-count$/)[1];
        return handleChannelMemberCount(request, env, corsHeaders, channelId);
      } else if (url.pathname.match(/^\/api\/channels\/(.+)$/)) {
        const channelId = url.pathname.match(/^\/api\/channels\/(.+)$/)[1];
        if (request.method === 'PUT') {
          return handleChannelUpdate(request, env, corsHeaders, channelId);
        } else if (request.method === 'DELETE') {
          return handleChannelDelete(request, env, corsHeaders, channelId);
        }
      }
    }
    
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};

// Discord OAuth 콜백 처리
async function handleDiscordCallback(request, env, corsHeaders) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  
  if (!code) {
    return new Response('Authorization code not found', { 
      status: 400, 
      headers: corsHeaders 
    });
  }
  
  try {
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
    
    const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`
      }
    });
    
    const discordUser = await userResponse.json();
    
    const sessionId = crypto.randomUUID();
    
    // 세션 정보 저장
    await env.SESSIONS.put(sessionId, JSON.stringify({
      discordUser,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000)
    }), {
      expirationTtl: 3600
    });
    
    // 최근 세션 ID 저장
    await env.SESSIONS.put(`latest:${discordUser.id}`, sessionId, {
      expirationTtl: 3600
    });
    
    await env.SESSIONS.put('latest', sessionId, {
      expirationTtl: 300
    });
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>로그인 완료</title>
        <style>
          body {
            font-family: 'Segoe UI', 'Malgun Gothic', sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
          }
          .container {
            text-align: center;
            background: rgba(255, 255, 255, 0.1);
            padding: 40px;
            border-radius: 20px;
            backdrop-filter: blur(10px);
          }
          h1 { margin-bottom: 20px; }
          p { font-size: 18px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✅ 로그인 완료!</h1>
          <p>이 창을 닫고 앱으로 돌아가세요.</p>
        </div>
        <script>
          setTimeout(() => window.close(), 2000);
        </script>
      </body>
      </html>
    `;
    
    return new Response(html, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8'
      }
    });
  } catch (error) {
    console.error('Discord OAuth error:', error);
    return new Response('Authentication failed: ' + error.message, { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}

// 인증 확인
async function handleAuthCheck(request, env, corsHeaders) {
  const url = new URL(request.url);
  
  if (url.searchParams.get('latest') === 'true') {
    const latestSessionId = await env.SESSIONS.get('latest');
    
    if (!latestSessionId) {
      return new Response(JSON.stringify({ 
        authenticated: false, 
        message: 'No recent session found' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    const sessionData = await env.SESSIONS.get(latestSessionId);
    
    if (!sessionData) {
      return new Response(JSON.stringify({ authenticated: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    const session = JSON.parse(sessionData);
    
    return new Response(JSON.stringify({
      authenticated: true,
      sessionId: latestSessionId,
      user: session.discordUser
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  const sessionId = url.searchParams.get('sessionId') || request.headers.get('X-Session-ID');
  
  if (!sessionId) {
    return new Response(JSON.stringify({ authenticated: false }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  const ready = await env.SESSIONS.get(`ready:${sessionId}`);
  
  if (!ready) {
    return new Response(JSON.stringify({ authenticated: false, waiting: true }), {
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
  const sessionData = await env.SESSIONS.get(token);
  
  if (!sessionData) {
    return new Response('Invalid token', { status: 401, headers: corsHeaders });
  }
  
  return new Response(JSON.stringify({ valid: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ✅ 프로필 생성 (POST)
async function handleProfileCreate(request, env, corsHeaders) {
  try {
    const data = await request.json();
    
    console.log('프로필 생성 요청:', data);
    
    await env.DB.prepare(`
      INSERT INTO users (discord_id, discord_username, custom_nickname, avatar, email, guild_id)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(discord_id) DO UPDATE SET
        custom_nickname = excluded.custom_nickname,
        guild_id = excluded.guild_id,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      data.discordId,
      data.discordUsername,
      data.customNickname,
      data.avatar,
      data.email,
      data.guildId || null
    ).run();
    
    const token = crypto.randomUUID();
    
    await env.SESSIONS.put(token, JSON.stringify(data), {
      expirationTtl: 86400
    });
    
    return new Response(JSON.stringify({
      success: true,
      token: token,
      user: data
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('프로필 생성 오류:', error);
    return new Response(JSON.stringify({
      error: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// ✅ 프로필 업데이트 (PUT)
async function handleProfileUpdate(request, env, corsHeaders) {
  try {
    const data = await request.json();
    
    console.log('프로필 업데이트 요청:', data);
    
    await env.DB.prepare(`
      UPDATE users 
      SET custom_nickname = COALESCE(?, custom_nickname),
          guild_id = COALESCE(?, guild_id),
          updated_at = CURRENT_TIMESTAMP
      WHERE discord_id = ?
    `).bind(
      data.customNickname || null,
      data.guildId || null,
      data.discordId
    ).run();
    
    return new Response(JSON.stringify({
      success: true,
      message: '프로필이 업데이트되었습니다'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('프로필 업데이트 오류:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// ✅ 길드 목록
async function handleGuildsList(request, env, corsHeaders) {
  const { results } = await env.DB.prepare(`
    SELECT * FROM guilds ORDER BY created_at DESC
  `).all();
  
  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ✅ 길드 생성
async function handleGuildCreate(request, env, corsHeaders) {
  const data = await request.json();
  
  const result = await env.DB.prepare(`
    INSERT INTO guilds (name, faction, recruitment, description, contact, logo, owner_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.name,
    data.faction,
    data.recruitment,
    data.description,
    data.contact,
    data.logo || null,
    data.ownerId
  ).run();
  
  return new Response(JSON.stringify({ 
    success: true,
    guildId: result.meta.last_row_id
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ✅ 길드 수정
async function handleGuildUpdate(request, env, corsHeaders, guildId) {
  const data = await request.json();
  
  await env.DB.prepare(`
    UPDATE guilds 
    SET name = ?, faction = ?, recruitment = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(data.name, data.faction, data.recruitment, guildId).run();
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ✅ 길드 삭제
async function handleGuildDelete(request, env, corsHeaders, guildId) {
  await env.DB.prepare(`DELETE FROM guilds WHERE id = ?`).bind(guildId).run();
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ✅ 채널 목록
async function handleChannelsList(request, env, corsHeaders) {
  const { results } = await env.DB.prepare(`
    SELECT 
      c.id, 
      c.name, 
      c.logo,
      c.owner_id,
      CASE WHEN c.password IS NOT NULL THEN 1 ELSE 0 END as has_password,
      COUNT(cm.user_id) as member_count
    FROM channels c
    LEFT JOIN channel_members cm ON c.id = cm.channel_id
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `).all();
  
  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ✅ 채널 생성
async function handleChannelCreate(request, env, corsHeaders) {
  const data = await request.json();
  
  const result = await env.DB.prepare(`
    INSERT INTO channels (name, password, logo, owner_id)
    VALUES (?, ?, ?, ?)
  `).bind(
    data.name,
    data.password || null,
    data.logo || null,
    data.ownerId
  ).run();
  
  return new Response(JSON.stringify({ 
    success: true,
    channelId: result.meta.last_row_id
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ✅ 채널 수정
async function handleChannelUpdate(request, env, corsHeaders, channelId) {
  const data = await request.json();
  
  await env.DB.prepare(`
    UPDATE channels 
    SET name = ?, password = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(data.name, data.password || null, channelId).run();
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ✅ 채널 삭제
async function handleChannelDelete(request, env, corsHeaders, channelId) {
  await env.DB.prepare(`DELETE FROM channels WHERE id = ?`).bind(channelId).run();
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ✅ 채널 비밀번호 검증
async function handleChannelVerify(request, env, corsHeaders) {
  const { channelId, password } = await request.json();
  
  const channel = await env.DB.prepare(`
    SELECT password FROM channels WHERE id = ?
  `).bind(channelId).first();
  
  if (!channel) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: '채널을 찾을 수 없습니다' 
    }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  const isValid = channel.password === password;
  
  return new Response(JSON.stringify({ 
    success: isValid,
    error: isValid ? null : '비밀번호가 틀렸습니다'
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ✅ 전체 채널 인원수
async function handleMemberCounts(request, env, corsHeaders) {
  const { results } = await env.DB.prepare(`
    SELECT channel_id, COUNT(user_id) as count
    FROM channel_members
    GROUP BY channel_id
  `).all();
  
  return new Response(JSON.stringify(results.map(r => ({
    channelId: r.channel_id,
    count: r.count
  }))), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ✅ 특정 채널 인원수
async function handleChannelMemberCount(request, env, corsHeaders, channelId) {
  const result = await env.DB.prepare(`
    SELECT COUNT(user_id) as count
    FROM channel_members
    WHERE channel_id = ?
  `).bind(channelId).first();
  
  return new Response(JSON.stringify({ 
    count: result?.count || 0 
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}