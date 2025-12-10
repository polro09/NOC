const { ipcRenderer } = require('electron');
const { API_BASE } = require('../config');

// ✅ 총 관리자 ID
const SUPER_ADMIN_ID = '257097077782216704';

// 채널 데이터
let channels = [];
let activeChannelId = null;
let currentUser = null;  // ✅ 서버에서 받은 정보로 업데이트됨
let pendingChannel = null;

// ✅ 채널별 WebSocket 관리
let channelWebSockets = new Map(); // channelId -> WebSocket

// ✅ 참여자 목록
let channelMembers = new Map(); // channelId -> [members]

// ✅ 관리 대상 사용자
let targetUser = null;

// 초기화
document.addEventListener('DOMContentLoaded', () => {
  initializeUI();
  
  ipcRenderer.on('load-channel', (event, channelData) => {
    console.log('📦 채널 데이터 수신:', channelData);
    
    // ✅ Discord ID만 저장 (나머지는 서버에서 받음)
    if (channelData.discordId) {
      currentUser = {
        discordId: channelData.discordId
      };
      console.log('👤 Discord ID:', currentUser.discordId);
    }
    
    addChannel(channelData);
  });
});

// ✅ 권한 확인 함수들 - 서버에서 받은 정보 기반
function isSuperAdmin() {
  return currentUser && currentUser.isSuperAdmin === true;
}

function isChannelOwner(channelId) {
  const channel = channels.find(c => c.id === channelId);
  return channel && currentUser && String(channel.ownerId) === String(currentUser.discordId);
}

function isChannelAdmin(channelId) {
  return isSuperAdmin() || isChannelOwner(channelId) || (currentUser && currentUser.role === 'owner');
}

function isChannelModerator(channelId) {
  return currentUser && currentUser.role === 'moderator';
}

function canManageMembers(channelId) {
  return isChannelAdmin(channelId) || isChannelModerator(channelId);
}

// UI 초기화
function initializeUI() {
  // 닫기 버튼
  document.getElementById('closeBtn').addEventListener('click', () => {
    ipcRenderer.send('close-chat-overlay');
  });
  
  // ✅ 참여자 목록 토글
  document.getElementById('toggleMembersBtn').addEventListener('click', toggleMembersSidebar);
  
  // [+] 채널 추가 버튼 생성
  createAddChannelButton();
  
  // 비밀번호 모달
  document.getElementById('confirmBtn').addEventListener('click', handlePasswordConfirm);
  document.getElementById('cancelBtn').addEventListener('click', hidePasswordModal);
  document.getElementById('passwordInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handlePasswordConfirm();
  });
  
  // 채널 선택 모달
  document.getElementById('channelSelectModal').addEventListener('click', (e) => {
    if (e.target.id === 'channelSelectModal') closeChannelSelectModal();
  });
  
  // ✅ 관리자 모달
  document.getElementById('closeAdminModal').addEventListener('click', closeAdminModal);
  document.getElementById('actionChangeColor').addEventListener('click', openColorModal);
  document.getElementById('actionWarn').addEventListener('click', warnUser);
  document.getElementById('actionKick').addEventListener('click', kickUser);
  document.getElementById('actionBan').addEventListener('click', banUser);
  document.getElementById('actionModerator').addEventListener('click', toggleModerator);
  document.getElementById('actionUnmute').addEventListener('click', unmuteUser);
  
  // ✅ 색상 선택 모달
  document.getElementById('closeColorModal').addEventListener('click', closeColorModal);
  document.getElementById('confirmColorBtn').addEventListener('click', applyNicknameColor);
  document.querySelectorAll('.color-preset').forEach(preset => {
    preset.addEventListener('click', () => {
      document.getElementById('nicknameColorPicker').value = preset.dataset.color;
    });
  });
}

// ✅ 참여자 목록 토글
function toggleMembersSidebar() {
  const sidebar = document.getElementById('membersSidebar');
  const btn = document.getElementById('toggleMembersBtn');
  
  if (!canManageMembers(activeChannelId)) {
    alert('관리자만 참여자 목록을 볼 수 있습니다.');
    return;
  }
  
  if (sidebar.style.display === 'none') {
    sidebar.style.display = 'flex';
    btn.classList.add('active');
    updateMembersList(activeChannelId);
  } else {
    sidebar.style.display = 'none';
    btn.classList.remove('active');
  }
}

// ✅ 참여자 목록 업데이트 - isSuperAdmin 플래그 사용
function updateMembersList(channelId) {
  const membersList = document.getElementById('membersList');
  const membersCount = document.getElementById('membersCount');
  const members = channelMembers.get(channelId) || [];
  
  membersCount.textContent = `${members.length}명`;
  membersList.innerHTML = '';
  
  members.forEach(member => {
    const item = document.createElement('div');
    item.className = 'member-item';
    
    // ✅ 역할 뱃지 - 서버에서 받은 isSuperAdmin 플래그 사용
    let roleBadge = '';
    if (member.isSuperAdmin === true) {
      roleBadge = '<span class="role-badge super">👑</span>';
    } else if (member.role === 'owner') {
      roleBadge = '<span class="role-badge owner">⭐</span>';
    } else if (member.role === 'moderator') {
      roleBadge = '<span class="role-badge mod">🛡️</span>';
    }
    
    // 뮤트 상태
    const muteIcon = member.isMuted ? ' <span class="mute-icon">🔇</span>' : '';
    
    item.innerHTML = `
      <span class="member-name" style="color: ${member.nicknameColor || '#ffffff'};">
        ${roleBadge}${member.nickname}${muteIcon}
      </span>
    `;
    
    // 클릭 시 관리 메뉴
    if (canManageMembers(channelId) && member.discordId !== currentUser.discordId) {
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => openAdminModal(member));
    }
    
    membersList.appendChild(item);
  });
}

// ✅ 관리자 모달 열기
function openAdminModal(member) {
  targetUser = member;
  
  document.getElementById('adminTargetInfo').innerHTML = `
    <div class="target-avatar">👤</div>
    <div class="target-name" style="color: ${member.nicknameColor || '#ffffff'};">
      ${member.guild && member.guild !== '없음' ? `<span style="color: ${member.guildColor || '#667eea'};">[${member.guild}]</span> ` : ''}
      ${member.nickname}
    </div>
    <div class="target-id">${member.discordId}</div>
  `;
  
  // 총 관리자/채널주인만 부관리자 지정 가능
  const modBtn = document.getElementById('actionModerator');
  modBtn.style.display = (isChannelOwner(activeChannelId) || isSuperAdmin()) ? 'block' : 'none';
  modBtn.textContent = member.role === 'moderator' ? '🛡️ 부관리자 해제' : '🛡️ 부관리자 지정';
  
  // 뮤트 해제 버튼
  const unmuteBtn = document.getElementById('actionUnmute');
  unmuteBtn.style.display = member.isMuted ? 'block' : 'none';
  
  document.getElementById('adminModal').style.display = 'flex';
}

function closeAdminModal() {
  document.getElementById('adminModal').style.display = 'none';
  targetUser = null;
}

// ✅ 색상 모달
function openColorModal() {
  if (!targetUser) return;
  document.getElementById('nicknameColorPicker').value = targetUser.nicknameColor || '#ffffff';
  document.getElementById('colorModal').style.display = 'flex';
}

function closeColorModal() {
  document.getElementById('colorModal').style.display = 'none';
}

function applyNicknameColor() {
  if (!targetUser) return;
  
  const color = document.getElementById('nicknameColorPicker').value;
  const ws = channelWebSockets.get(activeChannelId);
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'admin_action',
      action: 'change_color',
      channelId: activeChannelId,
      targetUserId: targetUser.discordId,
      color: color
    }));
  }
  
  closeColorModal();
  closeAdminModal();
}

// ✅ 경고
function warnUser() {
  if (!targetUser) return;
  
  const reason = prompt('경고 사유를 입력하세요:');
  if (!reason) return;
  
  const ws = channelWebSockets.get(activeChannelId);
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'admin_action',
      action: 'warn',
      channelId: activeChannelId,
      targetUserId: targetUser.discordId,
      reason: reason
    }));
  }
  
  closeAdminModal();
}

// ✅ 추방
function kickUser() {
  if (!targetUser) return;
  
  if (!confirm(`${targetUser.nickname}님을 추방하시겠습니까?`)) return;
  
  const ws = channelWebSockets.get(activeChannelId);
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'admin_action',
      action: 'kick',
      channelId: activeChannelId,
      targetUserId: targetUser.discordId
    }));
  }
  
  closeAdminModal();
}

// ✅ 입장금지
function banUser() {
  if (!targetUser) return;
  
  const reason = prompt('입장금지 사유를 입력하세요:');
  if (!reason) return;
  
  const ws = channelWebSockets.get(activeChannelId);
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'admin_action',
      action: 'ban',
      channelId: activeChannelId,
      targetUserId: targetUser.discordId,
      reason: reason
    }));
  }
  
  closeAdminModal();
}

// ✅ 부관리자 지정/해제
function toggleModerator() {
  if (!targetUser) return;
  
  const isCurrentlyMod = targetUser.role === 'moderator';
  const newRole = isCurrentlyMod ? 'user' : 'moderator';
  
  const ws = channelWebSockets.get(activeChannelId);
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'admin_action',
      action: 'set_role',
      channelId: activeChannelId,
      targetUserId: targetUser.discordId,
      role: newRole
    }));
  }
  
  closeAdminModal();
}

// ✅ 채금 해제
function unmuteUser() {
  if (!targetUser) return;
  
  const ws = channelWebSockets.get(activeChannelId);
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'admin_action',
      action: 'unmute',
      channelId: activeChannelId,
      targetUserId: targetUser.discordId
    }));
  }
  
  closeAdminModal();
}

// ✅ 시스템 메시지 추가
function addSystemMessage(channelId, content) {
  addMessage(channelId, {
    author: '시스템',
    avatar: null,
    content: content,
    timestamp: new Date(),
    isSystem: true
  });
}

// [+] 채널 추가 버튼 생성
function createAddChannelButton() {
  const addBtn = document.createElement('button');
  addBtn.className = 'tab add-tab-btn';
  addBtn.textContent = '+';
  addBtn.title = '채널 추가';
  addBtn.addEventListener('click', openChannelSelectModal);
  document.getElementById('tabs').appendChild(addBtn);
}

// 채널 추가
function addChannel(channelData) {
  if (channels.find(ch => ch.id === channelData.id)) {
    switchChannel(channelData.id);
    return;
  }
  
  channels.push(channelData);
  channelMembers.set(channelData.id, []);
  
  // 탭 생성
  const tab = document.createElement('button');
  tab.className = 'tab';
  tab.dataset.channelId = channelData.id;
  
  if (channelData.isPrivate) {
    tab.innerHTML = '<span class="lock-icon">🔒</span> ';
  }
  
  tab.innerHTML += channelData.name;
  
  // 인원수 표시
  const userCount = document.createElement('span');
  userCount.className = 'user-count';
  userCount.dataset.channelId = channelData.id;
  userCount.textContent = `(${channelData.memberCount || 0})`;
  tab.appendChild(userCount);
  
  // 탭 닫기 버튼
  const closeBtn = document.createElement('span');
  closeBtn.className = 'tab-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeChannel(channelData.id);
  });
  tab.appendChild(closeBtn);
  
  tab.addEventListener('click', () => switchChannel(channelData.id));
  
  const tabsContainer = document.getElementById('tabs');
  const addBtn = tabsContainer.querySelector('.add-tab-btn');
  tabsContainer.insertBefore(tab, addBtn);
  
  // 탭 패널 생성
  const panel = document.createElement('div');
  panel.className = 'tab-panel';
  panel.dataset.channelId = channelData.id;
  
  const messages = document.createElement('div');
  messages.className = 'messages';
  messages.id = `messages-${channelData.id}`;
  
  const inputArea = document.createElement('div');
  inputArea.className = 'input-area';
  
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'message-input';
  input.placeholder = 'Enter로 전송';
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      sendMessage(channelData.id, input.value.trim());
      input.value = '';
    }
  });
  
  inputArea.appendChild(input);
  panel.appendChild(messages);
  panel.appendChild(inputArea);
  
  document.getElementById('chatContent').appendChild(panel);
  
  connectToChannel(channelData);
  
  if (channels.length === 1) {
    switchChannel(channelData.id);
  }
}

// 채널 전환
function switchChannel(channelId) {
  activeChannelId = channelId;
  
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
  
  const tab = document.querySelector(`.tab[data-channel-id="${channelId}"]`);
  const panel = document.querySelector(`.tab-panel[data-channel-id="${channelId}"]`);
  
  if (tab) tab.classList.add('active');
  if (panel) panel.classList.add('active');
  
  // 참여자 목록 업데이트
  if (document.getElementById('membersSidebar').style.display !== 'none') {
    updateMembersList(channelId);
  }
}

// 채널 제거
function removeChannel(channelId) {
  const index = channels.findIndex(ch => ch.id === channelId);
  if (index > -1) channels.splice(index, 1);
  
  channelMembers.delete(channelId);
  
  // ✅ 해당 채널의 WebSocket 닫기
  const ws = channelWebSockets.get(channelId);
  if (ws) {
    ws.close();
    channelWebSockets.delete(channelId);
  }
  
  const tab = document.querySelector(`.tab[data-channel-id="${channelId}"]`);
  if (tab) tab.remove();
  
  const panel = document.querySelector(`.tab-panel[data-channel-id="${channelId}"]`);
  if (panel) panel.remove();
  
  if (activeChannelId === channelId && channels.length > 0) {
    switchChannel(channels[0].id);
  }
  
  if (channels.length === 0) {
    ipcRenderer.send('close-chat-overlay');
  }
}

// ✅ WebSocket 연결 (채널별) - Discord ID만 전송
function connectToChannel(channelData) {
  // 이미 해당 채널에 연결되어 있으면 스킵
  if (channelWebSockets.has(channelData.id)) {
    console.log('⏭️ 이미 연결된 채널:', channelData.id);
    return;
  }
  
  if (!currentUser || !currentUser.discordId) {
    console.error('❌ Discord ID 없음');
    addSystemMessage(channelData.id, '⚠️ 로그인 정보가 없습니다. 다시 로그인해주세요.');
    return;
  }
  
  try {
    const wsBaseUrl = API_BASE.replace('/api', '').replace('https:', 'wss:').replace('http:', 'ws:');
    const wsUrl = `${wsBaseUrl}/ws/channel/${channelData.id}`;
    
    console.log('🔌 WebSocket 연결 시도:', wsUrl);
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('✅ WebSocket 연결 성공:', channelData.id);
      
      ws.channelId = channelData.id;
      channelWebSockets.set(channelData.id, ws);
      
      // ✅ Discord ID만 전송 - 서버에서 나머지 정보 조회
      const joinData = {
        type: 'join',
        channelId: channelData.id,
        discordId: currentUser.discordId
      };
      
      console.log('📤 Join 데이터 전송:', joinData);
      ws.send(JSON.stringify(joinData));
      
      // ✅ Ping 간격 설정 (30초)
      ws.pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(channelData.id, data);
      } catch (error) {
        console.error('메시지 파싱 오류:', error);
      }
    };
    
    ws.onerror = (error) => {
      console.error('❌ WebSocket 오류:', error);
      addSystemMessage(channelData.id, '⚠️ 서버 연결 실패. 잠시 후 다시 시도해주세요.');
    };
    
    ws.onclose = () => {
      console.log('🔌 WebSocket 연결 종료:', channelData.id);
      if (ws.pingInterval) clearInterval(ws.pingInterval);
      channelWebSockets.delete(channelData.id);
    };
    
  } catch (error) {
    console.error('❌ WebSocket 연결 실패:', error);
    addSystemMessage(channelData.id, '⚠️ 서버 연결에 실패했습니다.');
  }
}

// ✅ WebSocket 메시지 처리
function handleWebSocketMessage(channelId, data) {
  console.log('📩 메시지 수신:', data.type, data);
  
  switch (data.type) {
    case 'joined':
      // ✅ 서버에서 받은 본인 정보로 currentUser 업데이트
      if (data.user) {
        currentUser = {
          ...currentUser,
          ...data.user
        };
        console.log('👤 사용자 정보 업데이트:', currentUser);
      }
      addSystemMessage(channelId, `${channels.find(c => c.id === channelId)?.name || '채널'}에 입장하셨습니다.`);
      break;
      
    case 'message':
      addMessage(channelId, data);
      break;
      
    case 'member_count':
      updateMemberCount(data.channelId || channelId, data.count);
      break;
      
    case 'members_list':
      channelMembers.set(channelId, data.members || []);
      updateMembersList(channelId);
      updateMemberCount(channelId, (data.members || []).length);
      break;
      
    case 'user_joined':
      const members = channelMembers.get(channelId) || [];
      if (!members.find(m => m.visitorId === data.user.visitorId)) {
        members.push(data.user);
        channelMembers.set(channelId, members);
      }
      updateMembersList(channelId);
      updateMemberCount(channelId, members.length);
      addSystemMessage(channelId, `${data.user.nickname}님이 입장하셨습니다.`);
      break;
      
    case 'user_left':
      const currentMembers = channelMembers.get(channelId) || [];
      const idx = currentMembers.findIndex(m => m.visitorId === data.visitorId);
      if (idx > -1) currentMembers.splice(idx, 1);
      channelMembers.set(channelId, currentMembers);
      updateMembersList(channelId);
      updateMemberCount(channelId, currentMembers.length);
      addSystemMessage(channelId, `${data.nickname}님이 퇴장하셨습니다.`);
      break;
      
    case 'color_changed':
      const colorMembers = channelMembers.get(channelId) || [];
      const colorMember = colorMembers.find(m => m.discordId === data.targetUserId);
      if (colorMember) colorMember.nicknameColor = data.color;
      updateMembersList(channelId);
      addSystemMessage(channelId, '닉네임 색상이 변경되었습니다.');
      break;
      
    case 'kicked':
      if (data.targetUserId === currentUser.discordId) {
        alert('채널에서 추방되었습니다.');
        removeChannel(channelId);
      }
      break;
      
    case 'banned':
      if (data.targetUserId === currentUser.discordId) {
        alert('채널에서 입장금지되었습니다.');
        removeChannel(channelId);
      } else if (data.message) {
        // 입장 시 밴된 경우
        alert(data.message);
        removeChannel(channelId);
      }
      break;
      
    case 'warning':
      addSystemMessage(channelId, data.message);
      break;
      
    case 'error':
      console.error('서버 에러:', data.message);
      addSystemMessage(channelId, `⚠️ ${data.message}`);
      break;
      
    case 'pong':
      // Ping 응답, 무시
      break;
      
    case 'message_history':
      // 메시지 히스토리 로드
      if (data.messages && data.messages.length > 0) {
        data.messages.forEach(msg => {
          addMessage(channelId, {
            author: msg.custom_nickname || msg.user_id,
            authorId: msg.user_id,
            avatar: msg.avatarUrl,
            content: msg.content,
            timestamp: msg.created_at,
            guild: msg.short_name,
            guildColor: msg.short_name_color
          }, true);
        });
      }
      break;
  }
}

// 메시지 추가
function addMessage(channelId, messageData, isHistory = false) {
  const messagesContainer = document.getElementById(`messages-${channelId}`);
  if (!messagesContainer) return;
  
  const message = document.createElement('div');
  message.className = messageData.isSystem ? 'message system' : 'message';
  
  if (!messageData.isSystem) {
    const avatar = document.createElement('img');
    avatar.className = 'avatar';
    avatar.src = messageData.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
    avatar.alt = 'Avatar';
    avatar.onerror = () => { avatar.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; };
    message.appendChild(avatar);
  }
  
  const messageBody = document.createElement('div');
  messageBody.className = 'message-body';
  
  const messageHeader = document.createElement('div');
  messageHeader.className = 'message-header';
  
  const author = document.createElement('span');
  author.className = 'author';
  
  // ✅ 길드 태그 (색상 적용)
  if (messageData.guild && messageData.guild !== '없음' && !messageData.isSystem) {
    const guildTag = document.createElement('span');
    guildTag.className = 'guild-tag';
    guildTag.textContent = `[${messageData.guild}] `;
    guildTag.style.color = messageData.guildColor || '#667eea';
    author.appendChild(guildTag);
  }
  
  const authorName = document.createElement('span');
  authorName.textContent = messageData.author;
  authorName.style.color = messageData.authorColor || (messageData.isSystem ? '#ffd93d' : '#ffffff');
  author.appendChild(authorName);
  
  const timestamp = document.createElement('span');
  timestamp.className = 'timestamp';
  const time = new Date(messageData.timestamp);
  timestamp.textContent = time.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  
  messageHeader.appendChild(author);
  messageHeader.appendChild(timestamp);
  
  const messageContent = document.createElement('div');
  messageContent.className = 'message-content';
  messageContent.textContent = messageData.content;
  
  messageBody.appendChild(messageHeader);
  messageBody.appendChild(messageContent);
  
  message.appendChild(messageBody);
  
  messagesContainer.appendChild(message);
  
  // 히스토리가 아닐 때만 스크롤
  if (!isHistory) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

// ✅ 메시지 전송 - content만 전송 (나머지는 서버 세션에서)
function sendMessage(channelId, content) {
  if (!currentUser || !currentUser.discordId) {
    console.error('❌ 사용자 정보 없음');
    addSystemMessage(channelId, '⚠️ 로그인 정보가 없습니다.');
    return;
  }
  
  const ws = channelWebSockets.get(channelId);
  
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('❌ WebSocket 연결 안됨');
    addSystemMessage(channelId, '⚠️ 서버와 연결되지 않았습니다.');
    return;
  }
  
  // ✅ content만 전송 - 서버 세션에 저장된 정보 사용
  const messageData = {
    type: 'message',
    content: content
  };
  
  console.log('📤 메시지 전송:', content);
  ws.send(JSON.stringify(messageData));
}

// 인원수 업데이트
function updateMemberCount(channelId, count) {
  const userCountEl = document.querySelector(`.user-count[data-channel-id="${channelId}"]`);
  if (userCountEl) {
    userCountEl.textContent = `(${count})`;
  }
  
  // 참여자 목록 카운트도 업데이트
  if (activeChannelId === channelId) {
    document.getElementById('membersCount').textContent = `${count}명`;
  }
  
  // ✅ 메인 창에 인원수 변경 알림 (IPC)
  ipcRenderer.send('update-channel-member-count', { channelId, count });
}

// ✅ 비밀번호 모달 - 개선된 처리
function showPasswordModal() {
  document.getElementById('passwordModal').classList.add('active');
  document.getElementById('passwordInput').value = '';
  document.getElementById('passwordInput').focus();
}

function hidePasswordModal() {
  document.getElementById('passwordModal').classList.remove('active');
  document.getElementById('passwordInput').value = '';
  pendingChannel = null;  // ✅ 취소 시 초기화
}

async function handlePasswordConfirm() {
  const password = document.getElementById('passwordInput').value;
  if (!password || !pendingChannel) {
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/channels/verify-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId: pendingChannel.id, password: password })
    });
    
    const result = await response.json();
    
    if (result.success) {
      const channelToAdd = pendingChannel;
      hidePasswordModal();  // ✅ 성공 시 모달 닫기 + pendingChannel 초기화
      addChannel(channelToAdd);
    } else {
      // ✅ 실패 시 - 모달 유지, 입력만 초기화
      alert(result.error || '비밀번호가 틀렸습니다.');
      document.getElementById('passwordInput').value = '';
      document.getElementById('passwordInput').focus();
    }
  } catch (error) {
    alert('비밀번호 검증에 실패했습니다.');
    document.getElementById('passwordInput').value = '';
    document.getElementById('passwordInput').focus();
  }
}

function addChannelFromList(channel) {
  if (channel.isPrivate) {
    pendingChannel = channel;
    showPasswordModal();
  } else {
    addChannel(channel);
  }
}

// 채널 선택 모달
async function openChannelSelectModal() {
  const modal = document.getElementById('channelSelectModal');
  const list = document.getElementById('channelSelectList');
  
  try {
    const response = await fetch(`${API_BASE}/channels`);
    const allChannels = await response.json();
    
    const openChannelIds = channels.map(ch => ch.id);
    const availableChannels = allChannels.filter(ch => !openChannelIds.includes(ch.id));
    
    list.innerHTML = '';
    
    if (availableChannels.length === 0) {
      list.innerHTML = '<div style="color: white; text-align: center; padding: 20px;">사용 가능한 채널이 없습니다</div>';
    } else {
      availableChannels.forEach(channel => {
        const item = document.createElement('div');
        item.className = 'channel-select-item';
        item.innerHTML = `
          <div class="channel-icon">${channel.has_password ? '🔒' : '#'}</div>
          <div class="channel-info">
            <div class="channel-name">${channel.name}</div>
            <div class="channel-count">${channel.member_count || 0}명 참여중</div>
          </div>
        `;
        
        item.addEventListener('click', () => {
          closeChannelSelectModal();
          addChannelFromList({
            id: channel.id,
            name: channel.name,
            isPrivate: channel.has_password === 1,
            memberCount: channel.member_count || 0,
            ownerId: channel.owner_id
          });
        });
        
        list.appendChild(item);
      });
    }
    
    modal.classList.add('active');
  } catch (error) {
    alert('채널 목록을 불러오는데 실패했습니다.');
  }
}

function closeChannelSelectModal() {
  document.getElementById('channelSelectModal').classList.remove('active');
}
