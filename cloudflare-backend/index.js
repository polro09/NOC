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
    this.sessions = new Map(); // { visitorId: session }
    this.channelMembers = new Map(); // { visitorId: userInfo }
    this.channelId = null;
  }
  
  async fetch(request) {
    const url = new URL(request.url);
    
    // 인원수 조회 API
    if (url.pathname === '/member-count') {
      const count = this.channelMembers.size;
      return new Response(JSON.stringify({ count }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }
    
    return new Response('Not found', { status: 404 });
  }
  
  async handleWebSocket(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    
    // ✅ 고유한 방문자 ID 생성 (세션 충돌 방지)
    const visitorId = crypto.randomUUID();
    
    const session = {
      visitorId,
      webSocket: server,
      discordId: null,
      channelId: null,
      nickname: null,
      avatar: null,
      avatarUrl: null,
      guild: null,
      guildColor: '#667eea',
      nicknameColor: '#ffffff',
      role: 'user',
      isMuted: false,
      warnings: 0,
      isSuperAdmin: false
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
    if (session.visitorId) {
      this.sessions.delete(session.visitorId);
      this.channelMembers.delete(session.visitorId);
      
      // 퇴장 알림 브로드캐스트
      if (session.nickname) {
        this.broadcast({
          type: 'user_left',
          discordId: session.discordId,
          visitorId: session.visitorId,
          nickname: session.nickname
        }, session.visitorId);
        
        // ✅ 인원수 브로드캐스트
        this.broadcastMemberCount();
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
      case 'ping':
        session.webSocket.send(JSON.stringify({ type: 'pong' }));
        break;
      case 'admin_action':
        await this.handleAdminAction(session, data);
        break;
    }
  }
  
  // ✅ 아바타 URL 생성 헬퍼
  getAvatarUrl(discordId, avatar) {
    if (!avatar) {
      return `https://cdn.discordapp.com/embed/avatars/${parseInt(discordId || '0') % 5}.png`;
    }
    const extension = avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.${extension}?size=128`;
  }
  
  // ✅ 채널 입장 - 서버에서 Discord ID로 사용자 정보 조회
  async handleJoin(session, data) {
    const { channelId, discordId } = data;
    
    if (!discordId) {
      session.webSocket.send(JSON.stringify({ type: 'error', message: 'Discord ID required' }));
      return;
    }
    
    // 채널 ID 저장
    this.channelId = channelId;
    
    // ✅ 서버에서 사용자 정보 조회
    let userInfo = null;
    try {
      userInfo = await this.env.DB.prepare(`
        SELECT u.*, g.short_name as guild_short_name, g.short_name_color as guild_color
        FROM users u
        LEFT JOIN guilds g ON u.guild_id = g.id
        WHERE u.discord_id = ?
      `).bind(discordId).first();
    } catch (e) {
      console.error('User lookup error:', e);
    }
    
    // ✅ 사용자 정보가 없으면 에러
    if (!userInfo) {
      session.webSocket.send(JSON.stringify({ 
        type: 'error', 
        message: 'User not found. Please login again.' 
      }));
      return;
    }
    
    const nickname = userInfo.custom_nickname || userInfo.discord_username || 'Unknown';
    const avatar = userInfo.avatar || null;
    const avatarUrl = this.getAvatarUrl(discordId, avatar);
    const guild = userInfo.guild_short_name || '없음';
    const guildColor = userInfo.guild_color || '#667eea';
    
    // 입장금지 확인
    try {
      const ban = await this.env.DB.prepare(`
        SELECT * FROM channel_bans WHERE channel_id = ? AND user_id = ?
      `).bind(channelId, discordId).first();
      
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
    
    // 세션 설정 - 서버에서 조회한 정보 사용
    session.discordId = discordId;
    session.channelId = channelId;
    session.nickname = nickname;
    session.avatar = avatar;
    session.avatarUrl = avatarUrl;
    session.guild = guild;
    session.guildColor = guildColor;
    session.isSuperAdmin = discordId === SUPER_ADMIN_ID;
    
    // 채널 멤버 정보 가져오기
    try {
      const memberInfo = await this.env.DB.prepare(`
        SELECT role, nickname_color, warnings, is_muted 
        FROM channel_members 
        WHERE channel_id = ? AND user_id = ?
      `).bind(channelId, discordId).first();
      
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
      
      if (channel && channel.owner_id === discordId) {
        session.role = 'owner';
      }
    } catch (e) {
      // 무시
    }
    
    // ✅ 세션 저장 (고유 visitorId 사용)
    this.sessions.set(session.visitorId, session);
    
    // ✅ 채널 멤버 맵에 추가 (고유 visitorId 사용)
    this.channelMembers.set(session.visitorId, {
      visitorId: session.visitorId,
      discordId: discordId,
      nickname: session.nickname,
      avatar: session.avatar,
      avatarUrl: session.avatarUrl,
      guild: session.guild,
      guildColor: session.guildColor,
      nicknameColor: session.nicknameColor,
      role: session.role,
      isMuted: session.isMuted,
      warnings: session.warnings,
      isSuperAdmin: session.isSuperAdmin
    });
    
    // ✅ 본인에게 자신의 정보 전송
    session.webSocket.send(JSON.stringify({
      type: 'joined',
      user: {
        visitorId: session.visitorId,
        discordId: discordId,
        nickname: session.nickname,
        avatarUrl: session.avatarUrl,
        guild: session.guild,
        guildColor: session.guildColor,
        role: session.role,
        isSuperAdmin: session.isSuperAdmin
      }
    }));
    
    // 입장 알림 브로드캐스트 (본인 제외)
    this.broadcast({
      type: 'user_joined',
      user: {
        visitorId: session.visitorId,
        discordId: discordId,
        nickname: session.nickname,
        avatarUrl: session.avatarUrl,
        guild: session.guild,
        guildColor: session.guildColor,
        role: session.role,
        isSuperAdmin: session.isSuperAdmin
      }
    }, session.visitorId);
    
    // ✅ 인원수 브로드캐스트
    this.broadcastMemberCount();
    
    // 참여자 목록 전송
    const membersList = Array.from(this.channelMembers.values());
    session.webSocket.send(JSON.stringify({
      type: 'members_list',
      members: membersList
    }));
    
    // 최근 메시지 전송
    try {
      const { results } = await this.env.DB.prepare(`
        SELECT m.*, u.custom_nickname, u.avatar as user_avatar, g.short_name, g.short_name_color
        FROM messages m
        LEFT JOIN users u ON m.user_id = u.discord_id
        LEFT JOIN guilds g ON u.guild_id = g.id
        WHERE m.channel_id = ?
        ORDER BY m.created_at DESC
        LIMIT 50
      `).bind(channelId).all();
      
      // 아바타 URL 추가
      const messagesWithAvatar = results.map(msg => ({
        ...msg,
        avatarUrl: this.getAvatarUrl(msg.user_id, msg.user_avatar)
      }));
      
      session.webSocket.send(JSON.stringify({
        type: 'message_history',
        messages: messagesWithAvatar.reverse()
      }));
    } catch (e) {
      // 무시
    }
  }
  
  // ✅ 채팅 메시지 처리 - 서버 세션 정보 사용
  async handleChatMessage(session, data) {
    if (!session.channelId || !session.discordId) return;
    
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
      `).bind(session.channelId, session.discordId, data.content).run();
    } catch (e) {
      // 무시
    }
    
    // ✅ 서버 세션의 정보로 메시지 브로드캐스트 (본인 포함)
    this.broadcast({
      type: 'message',
      author: session.nickname,
      authorId: session.discordId,
      authorColor: session.nicknameColor,
      avatar: session.avatarUrl,
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
    
    // visitorId로 타겟 찾기
    let targetVisitorId = null;
    let targetMember = null;
    
    for (const [vid, member] of this.channelMembers) {
      if (member.discordId === targetUserId) {
        targetVisitorId = vid;
        targetMember = member;
        break;
      }
    }
    
    switch (action) {
      case 'change_color':
        if (targetMember) {
          targetMember.nicknameColor = data.color;
          
          // DB 업데이트
          try {
            await this.env.DB.prepare(`
              INSERT INTO channel_members (channel_id, user_id, nickname_color)
              VALUES (?, ?, ?)
              ON CONFLICT(channel_id, user_id) DO UPDATE SET nickname_color = ?
            `).bind(channelId, targetUserId, data.color, data.color).run();
          } catch (e) {}
          
          // 브로드캐스트
          this.broadcast({
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
            `).bind(channelId, targetUserId, session.discordId, data.reason || '').run();
            
            await this.env.DB.prepare(`
              INSERT INTO channel_members (channel_id, user_id, warnings)
              VALUES (?, ?, 1)
              ON CONFLICT(channel_id, user_id) DO UPDATE SET warnings = warnings + 1
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
            const targetSession = this.sessions.get(targetVisitorId);
            if (targetSession) {
              targetSession.isMuted = true;
            }
            
            this.broadcast({
              type: 'warning',
              message: `⚠️ ${targetMember.nickname}님이 경고 3회 누적으로 채팅 금지되었습니다.`
            });
          } else {
            this.broadcast({
              type: 'warning',
              message: `⚠️ ${targetMember.nickname}님에게 경고가 부여되었습니다. (${targetMember.warnings}/3)`
            });
          }
        }
        break;
        
      case 'kick':
        const kickSession = this.sessions.get(targetVisitorId);
        if (kickSession) {
          kickSession.webSocket.send(JSON.stringify({ type: 'kicked', targetUserId }));
          kickSession.webSocket.close();
        }
        
        if (targetVisitorId) {
          this.sessions.delete(targetVisitorId);
          this.channelMembers.delete(targetVisitorId);
        }
        
        this.broadcast({
          type: 'warning',
          message: `👢 ${targetMember?.nickname || 'Unknown'}님이 추방되었습니다.`
        });
        
        this.broadcastMemberCount();
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
          `).bind(channelId, targetUserId, session.discordId, data.reason || '').run();
        } catch (e) {}
        
        const banSession = this.sessions.get(targetVisitorId);
        if (banSession) {
          banSession.webSocket.send(JSON.stringify({ type: 'banned', targetUserId }));
          banSession.webSocket.close();
        }
        
        if (targetVisitorId) {
          this.sessions.delete(targetVisitorId);
          this.channelMembers.delete(targetVisitorId);
        }
        
        this.broadcast({
          type: 'warning',
          message: `🚫 ${targetMember?.nickname || 'Unknown'}님이 입장금지되었습니다.`
        });
        
        this.broadcastMemberCount();
        break;
        
      case 'set_role':
        if (targetMember && (session.isSuperAdmin || session.role === 'owner')) {
          targetMember.role = data.role;
          
          try {
            await this.env.DB.prepare(`
              INSERT INTO channel_members (channel_id, user_id, role)
              VALUES (?, ?, ?)
              ON CONFLICT(channel_id, user_id) DO UPDATE SET role = ?
            `).bind(channelId, targetUserId, data.role, data.role).run();
          } catch (e) {}
          
          const targetRoleSession = this.sessions.get(targetVisitorId);
          if (targetRoleSession) {
            targetRoleSession.role = data.role;
          }
          
          const roleMsg = data.role === 'moderator' 
            ? `🛡️ ${targetMember.nickname}님이 부관리자로 지정되었습니다.`
            : `🛡️ ${targetMember.nickname}님의 부관리자 권한이 해제되었습니다.`;
          
          this.broadcast({ type: 'warning', message: roleMsg });
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
          
          const targetUnmuteSession = this.sessions.get(targetVisitorId);
          if (targetUnmuteSession) {
            targetUnmuteSession.isMuted = false;
            targetUnmuteSession.warnings = 0;
          }
          
          this.broadcast({
            type: 'warning',
            message: `🔊 ${targetMember.nickname}님의 채팅 금지가 해제되었습니다.`
          });
        }
        break;
    }
    
    // 참여자 목록 업데이트 브로드캐스트
    this.broadcast({
      type: 'members_list',
      members: Array.from(this.channelMembers.values())
    });
  }
  
  // ✅ 브로드캐스트 (excludeVisitorId로 변경)
  broadcast(message, excludeVisitorId = null) {
    const messageStr = JSON.stringify(message);
    
    for (const [visitorId, session] of this.sessions) {
      if (visitorId !== excludeVisitorId) {
        try {
          session.webSocket.send(messageStr);
        } catch (error) {
          console.error('Broadcast error:', error);
        }
      }
    }
  }
  
  // ✅ 인원수 브로드캐스트
  broadcastMemberCount() {
    const count = this.channelMembers.size;
    
    const message = JSON.stringify({
      type: 'member_count',
      channelId: this.channelId,
      count: count
    });
    
    for (const [visitorId, session] of this.sessions) {
      try {
        session.webSocket.send(message);
      } catch (error) {}
    }
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
      
      // ✅ 채널별 Durable Object
      const id = env.CHAT_ROOMS.idFromName(`channel-${channelId}`);
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
    
    // ✅ 사용자 정보 조회 API 추가
    if (url.pathname.match(/^\/api\/users\/(.+)$/)) {
      const discordId = url.pathname.match(/^\/api\/users\/(.+)$/)[1];
      return handleUserGet(request, env, corsHeaders, discordId);
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

// ✅ 사용자 정보 조회
async function handleUserGet(request, env, corsHeaders, discordId) {
  try {
    const user = await env.DB.prepare(`
      SELECT u.*, g.short_name as guild_short_name, g.short_name_color as guild_color
      FROM users u
      LEFT JOIN guilds g ON u.guild_id = g.id
      WHERE u.discord_id = ?
    `).bind(discordId).first();
    
    if (!user) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify(user), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

async function handleProfileCreate(request, env, corsHeaders) {
  const data = await request.json();
  
  await env.DB.prepare(`
    INSERT INTO users (discord_id, discord_username, custom_nickname, avatar, email, guild_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      discord_username = excluded.discord_username,
      custom_nickname = excluded.custom_nickname,
      avatar = excluded.avatar,
      email = excluded.email,
      guild_id = COALESCE(excluded.guild_id, users.guild_id),
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
      CASE WHEN c.password IS NOT NULL THEN 1 ELSE 0 END as has_password
    FROM channels c
    ORDER BY c.created_at DESC
  `).all();
  
  // ✅ 각 채널의 실시간 인원수를 Durable Object에서 가져오기
  const channelsWithCounts = await Promise.all(results.map(async (channel) => {
    try {
      const id = env.CHAT_ROOMS.idFromName(`channel-${channel.id}`);
      const stub = env.CHAT_ROOMS.get(id);
      const response = await stub.fetch(new Request('http://internal/member-count'));
      const data = await response.json();
      return { ...channel, member_count: data.count || 0 };
    } catch (e) {
      return { ...channel, member_count: 0 };
    }
  }));
  
  return new Response(JSON.stringify(channelsWithCounts), {
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

// ✅ 실시간 인원수 API (Durable Object에서 가져오기)
async function handleMemberCounts(request, env, corsHeaders) {
  const { results } = await env.DB.prepare(`SELECT id FROM channels`).all();
  
  const counts = await Promise.all(results.map(async (channel) => {
    try {
      const id = env.CHAT_ROOMS.idFromName(`channel-${channel.id}`);
      const stub = env.CHAT_ROOMS.get(id);
      const response = await stub.fetch(new Request(`http://internal/member-count?channelId=${channel.id}`));
      const data = await response.json();
      return { channelId: channel.id, count: data.count || 0 };
    } catch (e) {
      return { channelId: channel.id, count: 0 };
    }
  }));
  
  return new Response(JSON.stringify(counts), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

async function handleChannelMemberCount(request, env, corsHeaders, channelId) {
  try {
    const id = env.CHAT_ROOMS.idFromName(`channel-${channelId}`);
    const stub = env.CHAT_ROOMS.get(id);
    const response = await stub.fetch(new Request('http://internal/member-count'));
    const data = await response.json();
    
    return new Response(JSON.stringify({ count: data.count || 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ count: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
