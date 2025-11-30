const { ipcRenderer } = require('electron');
const { API_BASE } = require('../config');

// 채널 데이터
let channels = [];
let activeChannelId = null;
let ws = null;
let currentUser = null;
let pendingChannel = null;

// 초기화
document.addEventListener('DOMContentLoaded', () => {
  loadUserData();
  initializeUI();
  
  // IPC로 채널 정보 받기
  ipcRenderer.on('load-channel', (event, channelData) => {
    addChannel(channelData);
  });
});

// 사용자 데이터 로드
function loadUserData() {
  const userData = localStorage.getItem('userData');
  if (userData) {
    currentUser = JSON.parse(userData);
    console.log('✅ 사용자 데이터 로드:', currentUser);
  }
}

// UI 초기화
function initializeUI() {
  console.log('🔧 채팅 오버레이 UI 초기화 시작...');
  
  // 닫기 버튼
  const closeBtn = document.getElementById('closeBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      console.log('❌ 채팅창 닫기 버튼 클릭');
      ipcRenderer.send('close-chat-overlay');
    });
  }
  
  // [+] 채널 추가 버튼 생성
  createAddChannelButton();
  
  // 비밀번호 모달
  const confirmBtn = document.getElementById('confirmBtn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      console.log('🔐 비밀번호 확인 버튼 클릭');
      handlePasswordConfirm();
    });
  }
  
  const cancelBtn = document.getElementById('cancelBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      console.log('❌ 비밀번호 취소 버튼 클릭');
      hidePasswordModal();
    });
  }
  
  // Enter 키로 비밀번호 확인
  const passwordInput = document.getElementById('passwordInput');
  if (passwordInput) {
    passwordInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handlePasswordConfirm();
      }
    });
  }
  
  // 모달 외부 클릭 시 닫기
  const channelSelectModal = document.getElementById('channelSelectModal');
  if (channelSelectModal) {
    channelSelectModal.addEventListener('click', (e) => {
      if (e.target.id === 'channelSelectModal') {
        closeChannelSelectModal();
      }
    });
  }
  
  console.log('✅ 채팅 오버레이 UI 초기화 완료');
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
  // 이미 존재하는 채널인지 확인
  if (channels.find(ch => ch.id === channelData.id)) {
    switchChannel(channelData.id);
    return;
  }
  
  channels.push(channelData);
  
  // 탭 생성
  const tab = document.createElement('button');
  tab.className = 'tab';
  tab.dataset.channelId = channelData.id;
  
  // 비밀 채널 표시
  if (channelData.isPrivate) {
    const lockIcon = document.createElement('span');
    lockIcon.className = 'lock-icon';
    lockIcon.textContent = '🔒';
    tab.appendChild(lockIcon);
    tab.appendChild(document.createTextNode(' '));
  }
  
  tab.appendChild(document.createTextNode(channelData.name));
  
  // ✅ 인원수 표시 (실시간 업데이트)
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
  
  // [+] 버튼 앞에 삽입
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
  
  // WebSocket 연결
  connectToChannel(channelData);
  
  // 첫 번째 채널이면 활성화
  if (channels.length === 1) {
    switchChannel(channelData.id);
  }
  
  // 실시간 인원수 업데이트 시작
  startMemberCountUpdate(channelData.id);
}

// 채널 전환
function switchChannel(channelId) {
  activeChannelId = channelId;
  
  // 모든 탭 비활성화
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.remove('active');
  });
  
  // 모든 패널 비활성화
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.remove('active');
  });
  
  // 선택한 탭/패널 활성화
  const tab = document.querySelector(`.tab[data-channel-id="${channelId}"]`);
  const panel = document.querySelector(`.tab-panel[data-channel-id="${channelId}"]`);
  
  if (tab) tab.classList.add('active');
  if (panel) panel.classList.add('active');
}

// 채널 제거
function removeChannel(channelId) {
  const index = channels.findIndex(ch => ch.id === channelId);
  if (index > -1) {
    channels.splice(index, 1);
  }
  
  // 탭 제거
  const tab = document.querySelector(`.tab[data-channel-id="${channelId}"]`);
  if (tab) tab.remove();
  
  // 패널 제거
  const panel = document.querySelector(`.tab-panel[data-channel-id="${channelId}"]`);
  if (panel) panel.remove();
  
  // 활성 채널이면 다른 채널로 전환
  if (activeChannelId === channelId && channels.length > 0) {
    switchChannel(channels[0].id);
  }
  
  // 채널이 없으면 창 닫기
  if (channels.length === 0) {
    ipcRenderer.send('close-chat-overlay');
  }
}

// WebSocket 연결
function connectToChannel(channelData) {
  console.log('🔌 WebSocket 연결 시작:', channelData);
  
  // 기존 연결 종료
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
  
  try {
    // WebSocket URL 생성 (/api 제거)
    const wsBaseUrl = API_BASE.replace('/api', '').replace('https:', 'wss:').replace('http:', 'ws:');
    const wsUrl = `${wsBaseUrl}/ws/channel/${channelData.id}`;
    console.log('🔗 WebSocket URL:', wsUrl);
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('✅ WebSocket 연결 성공:', channelData.id);
      
      // 입장 메시지
      addMessage(channelData.id, {
        author: '시스템',
        avatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
        content: `${channelData.name}에 입장하셨습니다.`,
        timestamp: new Date()
      });
    };
    
    ws.onmessage = (event) => {
      console.log('📨 메시지 수신:', event.data);
      try {
        const messageData = JSON.parse(event.data);
        
        // 인원수 업데이트 메시지
        if (messageData.type === 'member_count') {
          updateMemberCount(messageData.channelId, messageData.count);
        } else {
          addMessage(channelData.id, messageData);
        }
      } catch (error) {
        console.error('메시지 파싱 오류:', error);
      }
    };
    
    ws.onerror = (error) => {
      console.error('❌ WebSocket 오류:', error);
      
      // 폴백: 로컬 메시지만 표시
      addMessage(channelData.id, {
        author: '시스템',
        avatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
        content: '⚠️ 서버 연결 실패. 로컬 모드로 작동합니다.',
        timestamp: new Date()
      });
    };
    
    ws.onclose = () => {
      console.log('🔌 WebSocket 연결 종료:', channelData.id);
    };
    
  } catch (error) {
    console.error('❌ WebSocket 연결 실패:', error);
    
    // 폴백: 환영 메시지
    setTimeout(() => {
      addMessage(channelData.id, {
        author: '시스템',
        avatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
        content: `${channelData.name}에 입장하셨습니다. (오프라인 모드)`,
        timestamp: new Date()
      });
    }, 500);
  }
}

// ✅ 메시지 추가 (길드 태그 표시)
function addMessage(channelId, messageData) {
  const messagesContainer = document.getElementById(`messages-${channelId}`);
  if (!messagesContainer) return;
  
  const message = document.createElement('div');
  message.className = 'message';
  
  const avatar = document.createElement('img');
  avatar.className = 'avatar';
  avatar.src = messageData.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
  avatar.alt = 'Avatar';
  
  const messageBody = document.createElement('div');
  messageBody.className = 'message-body';
  
  const messageHeader = document.createElement('div');
  messageHeader.className = 'message-header';
  
  const author = document.createElement('span');
  author.className = 'author';
  
  // ✅ 길드 태그 표시: [길드명] 사용자별명
  if (messageData.guild && messageData.guild !== '없음') {
    const guildTag = document.createElement('span');
    guildTag.className = 'guild-tag';
    guildTag.textContent = `[${messageData.guild}] `;
    guildTag.style.color = '#667eea';
    guildTag.style.fontWeight = '700';
    author.appendChild(guildTag);
  }
  
  const authorName = document.createElement('span');
  authorName.textContent = messageData.author;
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
  
  message.appendChild(avatar);
  message.appendChild(messageBody);
  
  messagesContainer.appendChild(message);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ✅ 메시지 전송 (길드 정보 포함)
function sendMessage(channelId, content) {
  console.log('📤 메시지 전송:', channelId, content);
  
  // ✅ 최신 사용자 데이터 로드 (소속 길드 변경 반영)
  const userData = localStorage.getItem('userData');
  if (userData) {
    currentUser = JSON.parse(userData);
  }
  
  if (!currentUser) {
    console.error('❌ 사용자 정보 없음');
    return;
  }
  
  const extension = currentUser.avatar && currentUser.avatar.startsWith('a_') ? 'gif' : 'png';
  const avatarUrl = currentUser.avatar 
    ? `https://cdn.discordapp.com/avatars/${currentUser.discordId}/${currentUser.avatar}.${extension}?size=128`
    : `https://cdn.discordapp.com/embed/avatars/${parseInt(currentUser.discordId) % 5}.png`;
  
  const messageData = {
    author: currentUser.customNickname || currentUser.discordUsername,
    authorId: currentUser.discordId,
    avatar: avatarUrl,
    guild: currentUser.guild || '없음', // ✅ 길드 정보 포함
    content: content,
    timestamp: new Date()
  };
  
  console.log('📤 메시지 데이터:', messageData);
  
  // WebSocket으로 전송
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log('✅ WebSocket으로 전송');
    ws.send(JSON.stringify(messageData));
  } else {
    console.log('⚠️ WebSocket 연결 없음 - 로컬에만 표시');
  }
  
  // 로컬에 즉시 표시
  addMessage(channelId, messageData);
}

// ✅ 실시간 인원수 업데이트
function startMemberCountUpdate(channelId) {
  setInterval(async () => {
    try {
      const response = await fetch(`${API_BASE}/channels/${channelId}/member-count`);
      
      if (response.ok) {
        const { count } = await response.json();
        updateMemberCount(channelId, count);
      }
    } catch (error) {
      // 조용히 실패
    }
  }, 5000);
}

function updateMemberCount(channelId, count) {
  const userCountEl = document.querySelector(`.user-count[data-channel-id="${channelId}"]`);
  if (userCountEl) {
    userCountEl.textContent = `(${count})`;
  }
}

// 비밀번호 모달
function showPasswordModal() {
  document.getElementById('passwordModal').classList.add('active');
  document.getElementById('passwordInput').focus();
}

function hidePasswordModal() {
  document.getElementById('passwordModal').classList.remove('active');
  document.getElementById('passwordInput').value = '';
}

async function handlePasswordConfirm() {
  const password = document.getElementById('passwordInput').value;
  
  if (!password || !pendingChannel) {
    return;
  }
  
  try {
    console.log('📡 비밀번호 검증 요청:', pendingChannel.id);
    const response = await fetch(`${API_BASE}/channels/verify-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: pendingChannel.id,
        password: password
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    console.log('✅ 비밀번호 검증 결과:', result);
    
    if (result.success) {
      hidePasswordModal();
      addChannel(pendingChannel);
      pendingChannel = null;
    } else {
      alert(result.error || '비밀번호가 틀렸습니다.');
      document.getElementById('passwordInput').value = '';
      document.getElementById('passwordInput').focus();
    }
  } catch (error) {
    console.error('❌ 비밀번호 검증 실패:', error);
    alert('비밀번호 검증에 실패했습니다: ' + error.message);
  }
}

// 채널 추가 (비밀번호 확인)
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
    console.log('📡 채널 목록 요청...');
    const response = await fetch(`${API_BASE}/channels`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const allChannels = await response.json();
    console.log('✅ 채널 목록 로드:', allChannels);
    
    // 이미 열려있는 채널 제외
    const openChannelIds = channels.map(ch => ch.id);
    const availableChannels = allChannels.filter(ch => !openChannelIds.includes(ch.id));
    
    // 목록 렌더링
    list.innerHTML = '';
    
    if (availableChannels.length === 0) {
      list.innerHTML = '<div style="color: white; text-align: center; padding: 20px;">사용 가능한 채널이 없습니다</div>';
    } else {
      availableChannels.forEach(channel => {
        const item = document.createElement('div');
        item.className = 'channel-select-item';
        
        const icon = document.createElement('div');
        icon.className = 'channel-icon';
        icon.textContent = channel.has_password ? '🔒' : '#';
        
        const info = document.createElement('div');
        info.className = 'channel-info';
        
        const name = document.createElement('div');
        name.className = 'channel-name';
        name.textContent = channel.name;
        
        const count = document.createElement('div');
        count.className = 'channel-count';
        count.textContent = `${channel.member_count || 0}명 참여중`;
        
        info.appendChild(name);
        info.appendChild(count);
        
        item.appendChild(icon);
        item.appendChild(info);
        
        item.addEventListener('click', () => {
          closeChannelSelectModal();
          addChannelFromList({
            id: channel.id,
            name: channel.name,
            isPrivate: channel.has_password === 1,
            memberCount: channel.member_count || 0
          });
        });
        
        list.appendChild(item);
      });
    }
    
    modal.classList.add('active');
  } catch (error) {
    console.error('❌ 채널 목록 로드 실패:', error);
    alert('채널 목록을 불러오는데 실패했습니다: ' + error.message);
  }
}

function closeChannelSelectModal() {
  document.getElementById('channelSelectModal').classList.remove('active');
}
