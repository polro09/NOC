// Cloudflare Workers - 통합 서버
// Discord OAuth + REST API + WebSocket Chat

// ✅ 총 관리자 ID
const SUPER_ADMIN_ID = '257097077782216704';

// ============================================
// ChatRoom Durable Object (WebSocket 채팅)
// ============================================
export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map(); // { userId: session }
    this.channelMembers = new Map(); // { channelId: Map(userId -> userInfo) }
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
      sessionId: null,
      channelId: null,
      nickname: null,
      avatar: null,
      guild: null,
      guildColor: '#667eea',
      nicknameColor: '#ffffff',
      role: 'user',
      isMuted: false,
      warnings: 0
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
      this.handleDisconnect(session);
    });
    
    server.addEventListener('error', () => {
      this.handleDisconnect(session);
    });
    
    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }
  
  // ✅ 연결 해제 처리
  handleDisconnect(session) {
    if (session.sessionId) {
      this.sessions.delete(session.sessionId);
    }
    
    if (session.channelId && session.userId) {
      const members = this.channelMembers.get(session.channelId);
      if (members) {
        members.delete(session.userId);
        
        // 퇴장 알림 브로드캐스트
        this.broadcast(session.channelId, {
          type: 'user_left',
          userId: session.userId,
          nickname: session.nickname
        }, session.userId);
        
        // ✅ 인원수 브로드캐스트
        this.broadcastMemberCount(session.channelId);
      }
    }
  }
  
  async handleMessage(session, data) {
    switch (data.type) {
      case 'join':
        await this.handleJoin(session, data);
        break;
      case 'message':
        await this.handleChatMessage(session, data);
        break;
      case 'leave':
        await this.handleLeave(session, data);
        break;
      case 'admin_action':
        await this.handleAdminAction(session, data);
        break;
    }
  }
  
  // ✅ 채널 입장
  async handleJoin(session, data) {
    const { channelId, user } = data;
    
    if (!user || !user.discordId) {
      session.webSocket.send(JSON.stringify({ type: 'error', message: 'Invalid user data' }));
      return;
    }
    
    // 입장금지 확인
    try {
      const ban = await this.env.DB.prepare(`
        SELECT * FROM channel_bans WHERE channel_id = ? AND user_id = ?
      `).bind(channelId, user.discordId).first();
      
      if (ban) {
        session.webSocket.send(JSON.stringify({ 
          type: 'banned', 
          message: '입장금지된 채널입니다.',
          reason: ban.reason
        }));
        session.webSocket.close();
        return;
      }
    } catch (e) {
      // 테이블이 없을 수 있음, 무시
    }
    
    // 세션 설정
    session.userId = user.discordId;
    session.sessionId = `${channelId}-${user.discordId}`;
    session.channelId = channelId;
    session.nickname = user.nickname || 'Unknown';
    session.avatar = user.avatar || null;
    session.guild = user.guild || '없음';
    session.guildColor = user.guildColor || '#667eea';
    session.isSuperAdmin = user.discordId === SUPER_ADMIN_ID;
    
    // 채널 멤버 정보 가져오기
    try {
      const memberInfo = await this.env.DB.prepare(`
        SELECT role, nickname_color, warnings, is_muted 
        FROM channel_members 
        WHERE channel_id = ? AND user_id = ?
      `).bind(channelId, user.discordId).first();
      
      if (memberInfo) {
        session.role = memberInfo.role || 'user';
        session.nicknameColor = memberInfo.nickname_color || '#ffffff';
        session.warnings = memberInfo.warnings || 0;
        session.isMuted = memberInfo.is_muted === 1;
      }
    } catch (e) {
      // 무시
    }
    
    // 채널 소유자 확인
    try {
      const channel = await this.env.DB.prepare(`
        SELECT owner_id FROM channels WHERE id = ?
      `).bind(channelId).first();
      
      if (channel && channel.owner_id === user.discordId) {
        session.role = 'owner';
      }
    } catch (e) {
      // 무시
    }
    
    // 세션 저장
    this.sessions.set(session.sessionId, session);
    
    // 채널 멤버 맵에 추가
    if (!this.channelMembers.has(channelId)) {
      this.channelMembers.set(channelId, new Map());
    }
    
    this.channelMembers.get(channelId).set(user.discordId, {
      discordId: user.discordId,
      nickname: session.nickname,
      guild: session.guild,
      guildColor: session.guildColor,
      nicknameColor: session.nicknameColor,
      role: session.role,
      isMuted: session.isMuted,
      warnings: session.warnings,
      isSuperAdmin: session.isSuperAdmin
    });
    
    // DB에 멤버 추가/업데이트
    try {
      await this.env.DB.prepare(`
        INSERT INTO channel_members (channel_id, user_id, role, nickname_color)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(channel_id, user_id) DO UPDATE SET
          nickname_color = COALESCE(channel_members.nickname_color, excluded.nickname_color)
      `).bind(channelId, user.discordId, session.role, session.nicknameColor).run();
    } catch (e) {
      // 무시
    }
    
    // 입장 알림 브로드캐스트
    this.broadcast(channelId, {
      type: 'user_joined',
      user: {
        discordId: user.discordId,
        nickname: session.nickname,
        guild: session.guild,
        guildColor: session.guildColor,
        role: session.role
      }
    }, user.discordId);
    
    // ✅ 인원수 브로드캐스트
    this.broadcastMemberCount(channelId);
    
    // 참여자 목록 전송
    const membersList = Array.from(this.channelMembers.get(channelId).values());
    session.webSocket.send(JSON.stringify({
      type: 'members_list',
      members: membersList
    }));
    
    // 최근 메시지 전송
    try {
      const { results } = await this.env.DB.prepare(`
        SELECT m.*, u.custom_nickname, g.short_name, g.short_name_color
        FROM messages m
        LEFT JOIN users u ON m.user_id = u.discord_id
        LEFT JOIN guilds g ON u.guild_id = g.id
        WHERE m.channel_id = ?
        ORDER BY m.created_at DESC
        LIMIT 50
      `).bind(channelId).all();
      
      session.webSocket.send(JSON.stringify({
        type: 'message_history',
        messages: results.reverse()
      }));
    } catch (e) {
      // 무시
    }
  }
  
  // ✅ 채팅 메시지 처리
  async handleChatMessage(session, data) {
    if (!session.channelId || !session.userId) return;
    
    // 뮤트 확인
    if (session.isMuted) {
      session.webSocket.send(JSON.stringify({
        type: 'error',
        message: '채팅 금지 상태입니다.'
      }));
      return;
    }
    
    // 메시지 저장
    try {
      await this.env.DB.prepare(`
        INSERT INTO messages (channel_id, user_id, content, message_type)
        VALUES (?, ?, ?, 'chat')
      `).bind(session.channelId, session.userId, data.content).run();
    } catch (e) {
      // 무시
    }
    
    // 브로드캐스트
    this.broadcast(session.channelId, {
      type: 'message',
      author: session.nickname,
      authorId: session.userId,
      authorColor: session.nicknameColor,
      avatar: session.avatar,
      guild: session.guild,
      guildColor: session.guildColor,
      content: data.content,
      timestamp: new Date().toISOString()
    });
  }
  
  // ✅ 퇴장 처리
  async handleLeave(session, data) {
    this.handleDisconnect(session);
  }
  
  // ✅ 관리자 액션
  async handleAdminAction(session, data) {
    const { action, channelId, targetUserId } = data;
    
    // 권한 확인
    const isAdmin = session.isSuperAdmin || session.role === 'owner' || session.role === 'moderator';
    if (!isAdmin) {
      session.webSocket.send(JSON.stringify({ type: 'error', message: '권한이 없습니다.' }));
      return;
    }
    
    const members = this.channelMembers.get(channelId);
    const targetMember = members?.get(targetUserId);
    
    switch (action) {
      case 'change_color':
        if (targetMember) {
          targetMember.nicknameColor = data.color;
          
          // DB 업데이트
          try {
            await this.env.DB.prepare(`
              UPDATE channel_members SET nickname_color = ? 
              WHERE channel_id = ? AND user_id = ?
            `).bind(data.color, channelId, targetUserId).run();
          } catch (e) {}
          
          // 브로드캐스트
          this.broadcast(channelId, {
            type: 'color_changed',
            targetUserId,
            color: data.color
          });
        }
        break;
        
      case 'warn':
        if (targetMember) {
          targetMember.warnings = (targetMember.warnings || 0) + 1;
          
          // 경고 로그 저장
          try {
            await this.env.DB.prepare(`
              INSERT INTO channel_warnings (channel_id, user_id, warned_by, reason)
              VALUES (?, ?, ?, ?)
            `).bind(channelId, targetUserId, session.userId, data.reason || '').run();
            
            await this.env.DB.prepare(`
              UPDATE channel_members SET warnings = warnings + 1 
              WHERE channel_id = ? AND user_id = ?
            `).bind(channelId, targetUserId).run();
          } catch (e) {}
          
          // 3회 경고시 뮤트
          if (targetMember.warnings >= 3) {
            targetMember.isMuted = true;
            
            try {
              await this.env.DB.prepare(`
                UPDATE channel_members SET is_muted = 1 
                WHERE channel_id = ? AND user_id = ?
              `).bind(channelId, targetUserId).run();
            } catch (e) {}
            
            // 타겟 세션 업데이트
            const targetSession = this.sessions.get(`${channelId}-${targetUserId}`);
            if (targetSession) {
              targetSession.isMuted = true;
            }
            
            this.broadcast(channelId, {
              type: 'warning',
              message: `⚠️ ${targetMember.nickname}님이 경고 3회 누적으로 채팅 금지되었습니다.`
            });
          } else {
            this.broadcast(channelId, {
              type: 'warning',
              message: `⚠️ ${targetMember.nickname}님에게 경고가 부여되었습니다. (${targetMember.warnings}/3)`
            });
          }
        }
        break;
        
      case 'kick':
        const kickSession = this.sessions.get(`${channelId}-${targetUserId}`);
        if (kickSession) {
          kickSession.webSocket.send(JSON.stringify({ type: 'kicked', targetUserId }));
          kickSession.webSocket.close();
        }
        
        if (members) members.delete(targetUserId);
        
        this.broadcast(channelId, {
          type: 'warning',
          message: `👢 ${targetMember?.nickname || 'Unknown'}님이 추방되었습니다.`
        });
        
        this.broadcastMemberCount(channelId);
        break;
        
      case 'ban':
        // DB에 밴 추가
        try {
          await this.env.DB.prepare(`
            INSERT INTO channel_bans (channel_id, user_id, banned_by, reason)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(channel_id, user_id) DO UPDATE SET
              reason = excluded.reason,
              banned_at = CURRENT_TIMESTAMP
          `).bind(channelId, targetUserId, session.userId, data.reason || '').run();
        } catch (e) {}
        
        const banSession = this.sessions.get(`${channelId}-${targetUserId}`);
        if (banSession) {
          banSession.webSocket.send(JSON.stringify({ type: 'banned', targetUserId }));
          banSession.webSocket.close();
        }
        
        if (members) members.delete(targetUserId);
        
        this.broadcast(channelId, {
          type: 'warning',
          message: `🚫 ${targetMember?.nickname || 'Unknown'}님이 입장금지되었습니다.`
        });
        
        this.broadcastMemberCount(channelId);
        break;
        
      case 'set_role':
        if (targetMember && (session.isSuperAdmin || session.role === 'owner')) {
          targetMember.role = data.role;
          
          try {
            await this.env.DB.prepare(`
              UPDATE channel_members SET role = ? 
              WHERE channel_id = ? AND user_id = ?
            `).bind(data.role, channelId, targetUserId).run();
          } catch (e) {}
          
          const targetRoleSession = this.sessions.get(`${channelId}-${targetUserId}`);
          if (targetRoleSession) {
            targetRoleSession.role = data.role;
          }
          
          const roleMsg = data.role === 'moderator' 
            ? `🛡️ ${targetMember.nickname}님이 부관리자로 지정되었습니다.`
            : `🛡️ ${targetMember.nickname}님의 부관리자 권한이 해제되었습니다.`;
          
          this.broadcast(channelId, { type: 'warning', message: roleMsg });
        }
        break;
        
      case 'unmute':
        if (targetMember) {
          targetMember.isMuted = false;
          targetMember.warnings = 0;
          
          try {
            await this.env.DB.prepare(`
              UPDATE channel_members SET is_muted = 0, warnings = 0 
              WHERE channel_id = ? AND user_id = ?
            `).bind(channelId, targetUserId).run();
          } catch (e) {}
          
          const targetUnmuteSession = this.sessions.get(`${channelId}-${targetUserId}`);
          if (targetUnmuteSession) {
            targetUnmuteSession.isMuted = false;
            targetUnmuteSession.warnings = 0;
          }
          
          this.broadcast(channelId, {
            type: 'warning',
            message: `🔊 ${targetMember.nickname}님의 채팅 금지가 해제되었습니다.`
          });
        }
        break;
    }
    
    // 참여자 목록 업데이트 브로드캐스트
    if (members) {
      this.broadcast(channelId, {
        type: 'members_list',
        members: Array.from(members.values())
      });
    }
  }
  
  // ✅ 브로드캐스트
  broadcast(channelId, message, excludeUserId = null) {
    const messageStr = JSON.stringify(message);
    
    for (const [sessionId, session] of this.sessions) {
      if (session.channelId === channelId && session.userId !== excludeUserId) {
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
    
    // 해당 채널의 모든 세션에 전송
    this.broadcast(channelId, {
      type: 'member_count',
      channelId: channelId,
      count: count
    });
    
    // ✅ 전역 이벤트 (다른 채널 탭에서도 업데이트 가능하도록)
    // 모든 세션에 전송
    const globalMessage = JSON.stringify({
      type: 'global_member_count',
      channelId: channelId,
      count: count
    });
    
    for (const [sessionId, session] of this.sessions) {
      try {
        session.webSocket.send(globalMessage);
      } catch (error) {}
    }
  }
  
  async handleMessages(request) {
    const url = new URL(request.url);
    const channelId = url.searchParams.get('channelId');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    
    const { results } = await this.env.DB.prepare(`
      SELECT m.*, u.custom_nickname, g.short_name, g.short_name_color
      FROM messages m
      LEFT JOIN users u ON m.user_id = u.discord_id
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
    
    // 프로필
    if (url.pathname === '/api/users/profile') {
      if (request.method === 'POST') {
        return handleProfileCreate(request, env, corsHeaders);
      } else if (request.method === 'PUT') {
        return handleProfileUpdate(request, env, corsHeaders);
      }
    }
    
    // 길드
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
    
    // 채널
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

// ============================================
// API Handlers
// ============================================

async function handleDiscordCallback(request, env, corsHeaders) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  
  if (!code) {
    return new Response('Authorization code not found', { status: 400, headers: corsHeaders });
  }
  
  try {
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: env.DISCORD_REDIRECT_URI
      })
    });
    
    const tokenData = await tokenResponse.json();
    
    if (!tokenData.access_token) throw new Error('Failed to get access token');
    
    const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    
    const discordUser = await userResponse.json();
    const sessionId = crypto.randomUUID();
    
    await env.SESSIONS.put(sessionId, JSON.stringify({
      discordUser,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000)
    }), { expirationTtl: 3600 });
    
    await env.SESSIONS.put('latest', sessionId, { expirationTtl: 300 });
    
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>로그인 완료</title>
      <style>body{font-family:'Segoe UI',sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;}
      .container{text-align:center;background:rgba(255,255,255,0.1);padding:40px;border-radius:20px;backdrop-filter:blur(10px);}</style></head>
      <body><div class="container"><h1>✅ 로그인 완료!</h1><p>이 창을 닫고 앱으로 돌아가세요.</p></div>
      <script>setTimeout(()=>window.close(),2000);</script></body></html>`;
    
    return new Response(html, { headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (error) {
    return new Response('Authentication failed: ' + error.message, { status: 500, headers: corsHeaders });
  }
}

async function handleAuthCheck(request, env, corsHeaders) {
  const url = new URL(request.url);
  
  if (url.searchParams.get('latest') === 'true') {
    const latestSessionId = await env.SESSIONS.get('latest');
    if (!latestSessionId) {
      return new Response(JSON.stringify({ authenticated: false }), {
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
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  
  return new Response(JSON.stringify({ authenticated: false }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

async function handleProfileCreate(request, env, corsHeaders) {
  const data = await request.json();
  
  await env.DB.prepare(`
    INSERT INTO users (discord_id, discord_username, custom_nickname, avatar, email, guild_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      custom_nickname = excluded.custom_nickname,
      guild_id = excluded.guild_id,
      updated_at = CURRENT_TIMESTAMP
  `).bind(data.discordId, data.discordUsername, data.customNickname, data.avatar, data.email, data.guildId || null).run();
  
  const token = crypto.randomUUID();
  await env.SESSIONS.put(token, JSON.stringify(data), { expirationTtl: 86400 });
  
  return new Response(JSON.stringify({ success: true, token, user: data }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

async function handleProfileUpdate(request, env, corsHeaders) {
  const data = await request.json();
  
  await env.DB.prepare(`
    UPDATE users SET 
      custom_nickname = COALESCE(?, custom_nickname),
      guild_id = COALESCE(?, guild_id),
      updated_at = CURRENT_TIMESTAMP
    WHERE discord_id = ?
  `).bind(data.customNickname || null, data.guildId || null, data.discordId).run();
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

async function handleGuildsList(request, env, corsHeaders) {
  const { results } = await env.DB.prepare(`
    SELECT * FROM guilds ORDER BY created_at DESC
  `).all();
  
  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

async function handleGuildCreate(request, env, corsHeaders) {
  const data = await request.json();
  
  const result = await env.DB.prepare(`
    INSERT INTO guilds (short_name, short_name_color, name, faction, recruitment, description, contact, logo, owner_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.shortName,
    data.shortNameColor || '#667eea',
    data.name,
    data.faction,
    data.recruitment,
    data.description,
    data.contact,
    data.logo || null,
    data.ownerId
  ).run();
  
  return new Response(JSON.stringify({ success: true, guildId: result.meta.last_row_id }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

async function handleGuildUpdate(request, env, corsHeaders, guildId) {
  const data = await request.json();
  
  await env.DB.prepare(`
    UPDATE guilds SET 
      short_name = ?, short_name_color = ?, name = ?, faction = ?, recruitment = ?,
      description = ?, contact = ?, logo = COALESCE(?, logo), updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    data.shortName,
    data.shortNameColor || '#667eea',
    data.name,
    data.faction,
    data.recruitment,
    data.description,
    data.contact,
    data.logo || null,
    guildId
  ).run();
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

async function handleGuildDelete(request, env, corsHeaders, guildId) {
  await env.DB.prepare(`DELETE FROM guilds WHERE id = ?`).bind(guildId).run();
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

async function handleChannelsList(request, env, corsHeaders) {
  const { results } = await env.DB.prepare(`
    SELECT 
      c.id, c.name, c.logo, c.owner_id,
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

async function handleChannelCreate(request, env, corsHeaders) {
  const data = await request.json();
  
  const result = await env.DB.prepare(`
    INSERT INTO channels (name, password, logo, owner_id)
    VALUES (?, ?, ?, ?)
  `).bind(data.name, data.password || null, data.logo || null, data.ownerId).run();
  
  return new Response(JSON.stringify({ success: true, channelId: result.meta.last_row_id }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

async function handleChannelUpdate(request, env, corsHeaders, channelId) {
  const data = await request.json();
  
  await env.DB.prepare(`
    UPDATE channels SET name = ?, password = ?, logo = COALESCE(?, logo), updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(data.name, data.password || null, data.logo || null, channelId).run();
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

async function handleChannelDelete(request, env, corsHeaders, channelId) {
  await env.DB.prepare(`DELETE FROM channel_members WHERE channel_id = ?`).bind(channelId).run();
  await env.DB.prepare(`DELETE FROM messages WHERE channel_id = ?`).bind(channelId).run();
  await env.DB.prepare(`DELETE FROM channels WHERE id = ?`).bind(channelId).run();
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

async function handleChannelVerify(request, env, corsHeaders) {
  const { channelId, password } = await request.json();
  
  const channel = await env.DB.prepare(`
    SELECT password FROM channels WHERE id = ?
  `).bind(channelId).first();
  
  if (!channel) {
    return new Response(JSON.stringify({ success: false, error: '채널을 찾을 수 없습니다' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  const isValid = channel.password === password;
  
  return new Response(JSON.stringify({ success: isValid, error: isValid ? null : '비밀번호가 틀렸습니다' }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ✅ 실시간 인원수 API
async function handleMemberCounts(request, env, corsHeaders) {
  const { results } = await env.DB.prepare(`
    SELECT channel_id, COUNT(user_id) as count
    FROM channel_members
    GROUP BY channel_id
  `).all();
  
  return new Response(JSON.stringify(results.map(r => ({
    channelId: r.channel_id,
    count: r.count
  }))), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function handleChannelMemberCount(request, env, corsHeaders, channelId) {
  const result = await env.DB.prepare(`
    SELECT COUNT(user_id) as count FROM channel_members WHERE channel_id = ?
  `).bind(channelId).first();
  
  return new Response(JSON.stringify({ count: result?.count || 0 }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}