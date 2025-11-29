// Cloudflare Durable Objects - WebSocket Chat Room

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map(); // WebSocket 세션 저장
  }
  
  async fetch(request) {
    const url = new URL(request.url);
    
    // WebSocket 업그레이드 요청
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }
    
    // HTTP 요청 (채팅 히스토리 등)
    if (url.pathname.startsWith('/messages')) {
      return this.handleMessages(request);
    }
    
    return new Response('Not found', { status: 404 });
  }
  
  // WebSocket 연결 처리
  async handleWebSocket(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    
    // WebSocket 세션 생성
    const session = {
      webSocket: server,
      userId: null,
      channelId: null,
      nickname: null,
      nicknameColor: '#ffffff'
    };
    
    // WebSocket 이벤트 핸들러
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
      
      // 퇴장 알림
      if (session.channelId) {
        this.broadcast(session.channelId, {
          type: 'user_left',
          userId: session.userId,
          nickname: session.nickname
        }, session.userId);
      }
    });
    
    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }
  
  // 메시지 처리
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
  
  // 인증 처리
  async handleAuth(session, data) {
    // 토큰 검증
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
    
    this.sessions.set(session.userId, session);
    
    session.webSocket.send(JSON.stringify({
      type: 'auth_success',
      userId: session.userId
    }));
  }
  
  // 채널 입장
  async handleJoinChannel(session, data) {
    session.channelId = data.channelId;
    
    // 채널 멤버에 추가
    await this.env.DB.prepare(`
      INSERT OR IGNORE INTO channel_members (channel_id, user_id)
      VALUES (?, ?)
    `).bind(data.channelId, session.userId).run();
    
    // 입장 알림
    this.broadcast(session.channelId, {
      type: 'user_joined',
      userId: session.userId,
      nickname: session.nickname
    }, session.userId);
    
    // 최근 메시지 전송
    const { results } = await this.env.DB.prepare(`
      SELECT m.*, u.custom_nickname, cm.nickname_color
      FROM messages m
      JOIN users u ON m.user_id = u.discord_id
      LEFT JOIN channel_members cm ON cm.channel_id = m.channel_id AND cm.user_id = m.user_id
      WHERE m.channel_id = ?
      ORDER BY m.created_at DESC
      LIMIT 50
    `).bind(data.channelId).all();
    
    session.webSocket.send(JSON.stringify({
      type: 'message_history',
      messages: results.reverse()
    }));
  }
  
  // 채팅 메시지
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
    
    // 브로드캐스트
    this.broadcast(session.channelId, {
      type: 'message',
      author: session.nickname,
      authorId: session.userId,
      authorColor: nicknameColor,
      content: data.content,
      timestamp: new Date().toISOString()
    });
  }
  
  // 채널 퇴장
  async handleLeaveChannel(session, data) {
    const channelId = session.channelId;
    session.channelId = null;
    
    // 퇴장 알림
    this.broadcast(channelId, {
      type: 'user_left',
      userId: session.userId,
      nickname: session.nickname
    }, session.userId);
  }
  
  // 브로드캐스트
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
  
  // 메시지 히스토리 조회
  async handleMessages(request) {
    const url = new URL(request.url);
    const channelId = url.searchParams.get('channelId');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    
    const { results } = await this.env.DB.prepare(`
      SELECT m.*, u.custom_nickname, cm.nickname_color
      FROM messages m
      JOIN users u ON m.user_id = u.discord_id
      LEFT JOIN channel_members cm ON cm.channel_id = m.channel_id AND cm.user_id = m.user_id
      WHERE m.channel_id = ?
      ORDER BY m.created_at DESC
      LIMIT ?
    `).bind(channelId, limit).all();
    
    return new Response(JSON.stringify(results.reverse()), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
