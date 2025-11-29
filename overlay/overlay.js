const { ipcRenderer } = require('electron');
const { API_BASE } = require('../config');

// 사용자 데이터
let currentUser = null;
let currentChannel = null;
let ws = null;

// 페이지 리다이렉트 플래그 (무한 루프 방지)
let isRedirecting = false;

console.log('📄 index.html 로드됨');

// 초기화
document.addEventListener('DOMContentLoaded', () => {
  console.log('📋 DOMContentLoaded - 초기화 시작');
  
  // 사용자 데이터 로드 (없으면 여기서 중단)
  if (!loadUserData()) {
    console.log('⏹️ 사용자 데이터 없음 - 초기화 중단');
    return;
  }
  
  // 사용자 데이터 있을 때만 나머지 초기화
  console.log('▶️ 사용자 데이터 확인 완료 - 앱 초기화 계속');
  initializeUI();
  connectWebSocket();
  loadGuilds();
  loadChannels();
});

// 사용자 데이터 로드
function loadUserData() {
  console.log('🔍 사용자 데이터 확인 중...');
  
  if (isRedirecting) {
    console.log('⏳ 이미 리다이렉트 중...');
    return false;
  }
  
  const userData = localStorage.getItem('userData');
  console.log('📊 localStorage userData:', userData);
  
  if (!userData) {
    console.error('❌ 사용자 데이터 없음 - 로그인 페이지로 이동');
    isRedirecting = true;
    
    // 즉시 리다이렉트 (지연 없음!)
    window.location.href = 'login.html';
    return false;
  }
  
  try {
    currentUser = JSON.parse(userData);
    console.log('✅ 사용자 데이터 로드 완료:', currentUser);
    
    // 필수 필드 검증
    if (!currentUser.discordId || !currentUser.discordUsername) {
      console.error('❌ 사용자 데이터 불완전:', currentUser);
      console.log('🗑️ 손상된 userData 제거');
      localStorage.removeItem('userData');
      isRedirecting = true;
      
      window.location.href = 'login.html';
      return false;
    }
    
    updateUserProfile();
    return true;
  } catch (e) {
    console.error('❌ userData 파싱 오류:', e);
    console.log('🗑️ 손상된 userData 제거');
    localStorage.removeItem('userData');
    isRedirecting = true;
    
    window.location.href = 'login.html';
    return false;
  }
}

// 사용자 프로필 업데이트
function updateUserProfile() {
  console.log('🖼️ 프로필 업데이트 시작:', currentUser);
  
  document.getElementById('profileName').textContent = currentUser.customNickname || currentUser.discordUsername;
  
  // 디스코드 프로필 이미지 설정
  const avatarImg = document.getElementById('profileAvatar');
  if (currentUser.avatar) {
    const extension = currentUser.avatar.startsWith('a_') ? 'gif' : 'png';
    const avatarUrl = `https://cdn.discordapp.com/avatars/${currentUser.discordId}/${currentUser.avatar}.${extension}?size=128`;
    console.log('📷 프로필 이미지 URL:', avatarUrl);
    avatarImg.src = avatarUrl;
  } else {
    // 기본 디스코드 아바타
    const defaultAvatar = parseInt(currentUser.discordId) % 5;
    const defaultUrl = `https://cdn.discordapp.com/embed/avatars/${defaultAvatar}.png`;
    console.log('📷 기본 프로필 이미지 URL:', defaultUrl);
    avatarImg.src = defaultUrl;
  }
  
  console.log('✅ 프로필 업데이트 완료');
}

// UI 초기화
function initializeUI() {
  console.log('🔧 UI 초기화 시작...');
  
  // 헤더 컨트롤
  const closeBtn = document.getElementById('closeBtn');
  console.log('closeBtn:', closeBtn);
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      console.log('❌ 닫기 버튼 클릭');
      ipcRenderer.send('close-window');
    });
  }
  
  // 일반 채팅 참여 버튼
  const joinGeneralChatBtn = document.getElementById('joinGeneralChatBtn');
  console.log('joinGeneralChatBtn:', joinGeneralChatBtn);
  if (joinGeneralChatBtn) {
    joinGeneralChatBtn.addEventListener('click', () => {
      console.log('💬 일반 채팅 참여 버튼 클릭');
      joinGeneralChat();
    });
  }
  
  // 프로필 모달
  const userProfile = document.getElementById('userProfile');
  console.log('userProfile:', userProfile);
  if (userProfile) {
    userProfile.addEventListener('click', () => {
      console.log('👤 프로필 클릭');
      openProfileModal();
    });
  }
  
  const closeProfileModal = document.getElementById('closeProfileModal');
  if (closeProfileModal) {
    closeProfileModal.addEventListener('click', () => {
      closeProfileModal();
    });
  }
  
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      console.log('🚪 로그아웃 버튼 클릭');
      logout();
    });
  }
  
  // 길드 추가
  const addGuildBtn = document.getElementById('addGuildBtn');
  console.log('addGuildBtn:', addGuildBtn);
  if (addGuildBtn) {
    addGuildBtn.addEventListener('click', () => {
      console.log('➕ 길드 추가 버튼 클릭');
      openGuildModal();
    });
  }
  
  const closeGuildModal = document.getElementById('closeGuildModal');
  if (closeGuildModal) {
    closeGuildModal.addEventListener('click', () => {
      closeGuildModal();
    });
  }
  
  const submitGuild = document.getElementById('submitGuild');
  if (submitGuild) {
    submitGuild.addEventListener('click', () => {
      console.log('✅ 길드 제출 버튼 클릭');
      submitGuild();
    });
  }
  
  // 채널 추가
  const addChannelBtn = document.getElementById('addChannelBtn');
  console.log('addChannelBtn:', addChannelBtn);
  if (addChannelBtn) {
    addChannelBtn.addEventListener('click', () => {
      console.log('➕ 채널 추가 버튼 클릭');
      openChannelModal();
    });
  }
  
  const closeChannelModalBtn = document.getElementById('closeChannelModal');
  if (closeChannelModalBtn) {
    closeChannelModalBtn.addEventListener('click', () => {
      closeChannelModal();
    });
  }
  
  const submitChannelBtn = document.getElementById('submitChannel');
  if (submitChannelBtn) {
    submitChannelBtn.addEventListener('click', () => {
      console.log('✅ 채널 제출 버튼 클릭');
      submitChannel();
    });
  }
  
  // 채팅 전송 (제거 - 메인 페이지에는 채팅 없음)
  // const sendBtn = document.getElementById('sendBtn');
  // const chatInput = document.getElementById('chatInput');
  
  // 클릭 무시 상태 업데이트 (제거 - 더 이상 사용 안함)
  // ipcRenderer.on('click-through-status', (event, isClickThrough) => {
  //   ...
  // });
  
  console.log('✅ UI 초기화 완료');
}

// WebSocket 연결
function connectWebSocket() {
  // TODO: 실제 WebSocket 서버 URL로 변경
  // ws = new WebSocket('wss://sdt-ad.xyz/ws');
  
  // 임시 데모용 (실제로는 위의 코드 사용)
  console.log('WebSocket 연결 준비 중...');
  
  // ws.onopen = () => {
  //   console.log('WebSocket 연결됨');
  //   // 인증 메시지 전송
  //   ws.send(JSON.stringify({
  //     type: 'auth',
  //     token: currentUser.token
  //   }));
  // };
  
  // ws.onmessage = (event) => {
  //   const data = JSON.parse(event.data);
  //   handleWebSocketMessage(data);
  // };
  
  // ws.onerror = (error) => {
  //   console.error('WebSocket 오류:', error);
  // };
  
  // ws.onclose = () => {
  //   console.log('WebSocket 연결 종료');
  //   // 재연결 시도
  //   setTimeout(connectWebSocket, 5000);
  // };
}

// WebSocket 메시지 처리
function handleWebSocketMessage(data) {
  switch (data.type) {
    case 'message':
      addChatMessage(data);
      break;
    case 'user_joined':
      // 사용자 입장 알림
      break;
    case 'user_left':
      // 사용자 퇴장 알림
      break;
  }
}

// 채팅 메시지 전송
function sendMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  
  if (!message) return;
  
  if (!currentChannel) {
    alert('채널을 먼저 선택해주세요.');
    return;
  }
  
  // TODO: WebSocket으로 메시지 전송
  // ws.send(JSON.stringify({
  //   type: 'message',
  //   channelId: currentChannel.id,
  //   content: message
  // }));
  
  // 임시: 로컬에서 메시지 추가
  addChatMessage({
    author: currentUser.customNickname,
    authorColor: '#667eea',
    content: message,
    timestamp: new Date()
  });
  
  input.value = '';
}

// 채팅 메시지 추가
function addChatMessage(data) {
  const messagesContainer = document.getElementById('chatMessages');
  
  const messageEl = document.createElement('div');
  messageEl.className = 'chat-message';
  
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  
  const content = document.createElement('div');
  content.className = 'message-content';
  
  const header = document.createElement('div');
  header.className = 'message-header';
  
  const author = document.createElement('span');
  author.className = 'message-author';
  author.textContent = data.author;
  author.style.color = data.authorColor || '#fff';
  
  const time = document.createElement('span');
  time.className = 'message-time';
  time.textContent = formatTime(data.timestamp);
  
  const text = document.createElement('div');
  text.className = 'message-text';
  text.textContent = data.content;
  
  header.appendChild(author);
  header.appendChild(time);
  content.appendChild(header);
  content.appendChild(text);
  messageEl.appendChild(avatar);
  messageEl.appendChild(content);
  
  messagesContainer.appendChild(messageEl);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// 시간 포맷
function formatTime(date) {
  const d = new Date(date);
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

// 길드 로드
function loadGuilds() {
  // TODO: 서버에서 길드 목록 가져오기
  // const response = await fetch('https://sdt-ad.xyz/api/guilds');
  // const guilds = await response.json();
  
  // 임시 데모 데이터
  const demoGuilds = [
    {
      id: '1',
      name: '테스트 길드',
      faction: '소함대',
      recruitment: '모집중',
      logo: null
    }
  ];
  
  const guildList = document.getElementById('guildList');
  guildList.innerHTML = '';
  
  demoGuilds.forEach(guild => {
    const guildEl = createGuildElement(guild);
    guildList.appendChild(guildEl);
  });
}

// 길드 요소 생성
function createGuildElement(guild) {
  const item = document.createElement('div');
  item.className = 'guild-item';
  item.dataset.guildId = guild.id;
  
  const icon = document.createElement('div');
  icon.className = 'guild-icon';
  if (guild.logo) {
    const img = document.createElement('img');
    img.src = guild.logo;
    icon.appendChild(img);
  } else {
    icon.textContent = guild.name[0];
  }
  
  const info = document.createElement('div');
  info.className = 'guild-info';
  
  const name = document.createElement('div');
  name.className = 'guild-name';
  name.textContent = guild.name;
  
  const faction = document.createElement('div');
  faction.className = 'guild-faction';
  faction.textContent = guild.faction;
  
  info.appendChild(name);
  info.appendChild(faction);
  
  const actions = document.createElement('div');
  actions.className = 'item-actions';
  
  // 생성자만 수정/삭제 가능 (currentUser 체크 추가)
  if (currentUser && guild.ownerId === currentUser.discordId) {
    const editBtn = document.createElement('button');
    editBtn.className = 'action-btn';
    editBtn.textContent = '✏️';
    editBtn.onclick = (e) => {
      e.stopPropagation();
      editGuild(guild);
    };
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'action-btn delete';
    deleteBtn.textContent = '🗑️';
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      deleteGuild(guild.id);
    };
    
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
  }
  
  item.appendChild(icon);
  item.appendChild(info);
  item.appendChild(actions);
  
  item.addEventListener('click', () => {
    // 길드 선택
    document.querySelectorAll('.guild-item').forEach(el => el.classList.remove('active'));
    item.classList.add('active');
  });
  
  return item;
}

// 채널 로드
async function loadChannels() {
  try {
    console.log('📡 채널 목록 요청...');
    const response = await fetch(`${API_BASE}/channels`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const channels = await response.json();
    console.log('✅ 채널 목록 로드:', channels);
    
    const channelList = document.getElementById('channelList');
    channelList.innerHTML = '';
    
    if (channels.length === 0) {
      channelList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">등록된 채널이 없습니다</div>';
      return;
    }
    
    channels.forEach(channel => {
      const channelEl = createChannelElement({
        id: channel.id,
        name: channel.name,
        hasPassword: channel.has_password === 1,
        logo: null,
        memberCount: channel.member_count || 0,
        ownerId: channel.owner_id
      });
      channelList.appendChild(channelEl);
    });
  } catch (error) {
    console.error('❌ 채널 목록 로드 실패:', error);
    
    // 폴백: 데모 데이터
    console.log('⚠️ 데모 데이터 사용');
    const demoChannels = [
      {
        id: 'general',
        name: '일반 채팅',
        hasPassword: false,
        logo: null,
        memberCount: 127,
        ownerId: null
      },
      {
        id: 'guild',
        name: '길드모집',
        hasPassword: false,
        logo: null,
        memberCount: 43,
        ownerId: currentUser?.discordId
      },
      {
        id: 'trade',
        name: '거래',
        hasPassword: false,
        logo: null,
        memberCount: 89,
        ownerId: null
      },
      {
        id: 'secret',
        name: '비밀방',
        hasPassword: true,
        logo: null,
        memberCount: 5,
        ownerId: null
      }
    ];
    
    const channelList = document.getElementById('channelList');
    channelList.innerHTML = '';
    
    demoChannels.forEach(channel => {
      const channelEl = createChannelElement(channel);
      channelList.appendChild(channelEl);
    });
  }
}

// 채널 요소 생성
function createChannelElement(channel) {
  const item = document.createElement('div');
  item.className = 'channel-item';
  item.dataset.channelId = channel.id;
  
  const icon = document.createElement('div');
  icon.className = 'channel-icon';
  if (channel.logo) {
    const img = document.createElement('img');
    img.src = channel.logo;
    icon.appendChild(img);
  } else {
    icon.textContent = '#';
  }
  
  const info = document.createElement('div');
  info.className = 'channel-info';
  
  const name = document.createElement('div');
  name.className = 'channel-name';
  name.textContent = channel.name;
  
  if (channel.hasPassword) {
    const lock = document.createElement('span');
    lock.className = 'channel-lock';
    lock.textContent = ' 🔒';
    name.appendChild(lock);
  }
  
  info.appendChild(name);
  
  // 인원수 표시
  if (channel.memberCount !== undefined) {
    const memberCount = document.createElement('div');
    memberCount.className = 'channel-member-count';
    memberCount.textContent = `👥 ${channel.memberCount}명`;
    info.appendChild(memberCount);
  }
  
  const actions = document.createElement('div');
  actions.className = 'item-actions';
  
  // 생성자만 수정/삭제 가능 (currentUser 체크 추가)
  if (currentUser && channel.ownerId === currentUser.discordId) {
    const editBtn = document.createElement('button');
    editBtn.className = 'action-btn';
    editBtn.textContent = '✏️';
    editBtn.onclick = (e) => {
      e.stopPropagation();
      editChannel(channel);
    };
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'action-btn delete';
    deleteBtn.textContent = '🗑️';
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      deleteChannel(channel.id);
    };
    
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
  }
  
  item.appendChild(icon);
  item.appendChild(info);
  item.appendChild(actions);
  
  item.addEventListener('click', () => {
    joinChannel(channel);
  });
  
  return item;
}

// 일반 채팅 참여
function joinGeneralChat() {
  // 기본 "일반 채팅" 채널로 오버레이 창 열기
  ipcRenderer.send('open-chat-overlay', {
    id: 'general',
    name: '일반 채팅',
    isPrivate: false,
    memberCount: 0,
    logo: null
  });
}

// 채널 참여
function joinChannel(channel) {
  // 비밀 채널이면 비밀번호 확인 (임시)
  if (channel.hasPassword) {
    const password = prompt('채널 비밀번호를 입력하세요:');
    if (!password) return;
    
    // TODO: 서버에 비밀번호 검증 요청
    // 임시로 항상 통과
  }
  
  // 채팅 오버레이 창 열기
  ipcRenderer.send('open-chat-overlay', {
    id: channel.id,
    name: channel.name,
    isPrivate: channel.hasPassword,
    memberCount: channel.memberCount || 0,
    logo: channel.logo
  });
  
  // 활성 상태 표시
  document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
  const channelItem = document.querySelector(`[data-channel-id="${channel.id}"]`);
  if (channelItem) {
    channelItem.classList.add('active');
  }
}

// 모달 열기/닫기
function openProfileModal() {
  document.getElementById('discordId').value = currentUser.discordId;
  document.getElementById('discordNickname').value = currentUser.customNickname;
  document.getElementById('userGuild').value = currentUser.guild || '없음';
  document.getElementById('profileModal').style.display = 'flex';
}

function closeProfileModal() {
  document.getElementById('profileModal').style.display = 'none';
}

function openGuildModal() {
  document.getElementById('addGuildModal').style.display = 'flex';
}

function closeGuildModal() {
  document.getElementById('addGuildModal').style.display = 'none';
  resetGuildForm();
}

function openChannelModal() {
  document.getElementById('addChannelModal').style.display = 'flex';
}

function closeChannelModal() {
  document.getElementById('addChannelModal').style.display = 'none';
  resetChannelForm();
}

// 길드 제출
async function submitGuild() {
  if (!currentUser) {
    alert('로그인이 필요합니다.');
    return;
  }
  
  const name = document.getElementById('guildName').value.trim();
  const faction = document.getElementById('guildFaction').value;
  const recruitment = document.getElementById('guildRecruitment').value;
  const description = document.getElementById('guildDescription').value.trim();
  const contact = document.getElementById('guildContact').value.trim();
  
  if (!name || !faction) {
    alert('필수 항목을 입력해주세요.');
    return;
  }
  
  const guildData = {
    name,
    faction,
    recruitment,
    description,
    contact,
    ownerId: currentUser.discordId
  };
  
  try {
    console.log('📡 길드 생성 요청:', guildData);
    const response = await fetch(`${API_BASE}/guilds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(guildData)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    console.log('✅ 길드 생성 성공:', result);
    
    alert('길드가 등록되었습니다!');
    closeGuildModal();
    loadGuilds();
  } catch (error) {
    console.error('❌ 길드 생성 실패:', error);
    alert('길드 등록에 실패했습니다: ' + error.message);
  }
}

// 채널 제출
async function submitChannel() {
  if (!currentUser) {
    alert('로그인이 필요합니다.');
    return;
  }
  
  const name = document.getElementById('channelName').value.trim();
  const password = document.getElementById('channelPassword').value;
  
  if (!name) {
    alert('채널명을 입력해주세요.');
    return;
  }
  
  const channelData = {
    name,
    password: password || null,
    ownerId: currentUser.discordId
  };
  
  try {
    console.log('📡 채널 생성 요청:', channelData);
    const response = await fetch(`${API_BASE}/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(channelData)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    console.log('✅ 채널 생성 성공:', result);
    
    alert('채널이 등록되었습니다!');
    closeChannelModal();
    loadChannels();
  } catch (error) {
    console.error('❌ 채널 생성 실패:', error);
    alert('채널 등록에 실패했습니다: ' + error.message);
  }
}

// 폼 리셋
function resetGuildForm() {
  document.getElementById('guildName').value = '';
  document.getElementById('guildFaction').value = '';
  document.getElementById('guildRecruitment').value = '모집중';
  document.getElementById('guildDescription').value = '';
  document.getElementById('guildContact').value = '';
}

function resetChannelForm() {
  document.getElementById('channelName').value = '';
  document.getElementById('channelPassword').value = '';
}

// 길드/채널 수정/삭제
function editGuild(guild) {
  // TODO: 길드 수정 모달 열기
  console.log('길드 수정:', guild);
}

function deleteGuild(guildId) {
  if (!confirm('정말 이 길드를 삭제하시겠습니까?')) return;
  
  // TODO: 서버로 삭제 요청
  loadGuilds();
}

function editChannel(channel) {
  // TODO: 채널 수정 모달 열기
  console.log('채널 수정:', channel);
}

function deleteChannel(channelId) {
  if (!confirm('정말 이 채널을 삭제하시겠습니까?')) return;
  
  // TODO: 서버로 삭제 요청
  loadChannels();
}

// 로그아웃
function logout() {
  if (!confirm('로그아웃 하시겠습니까?')) return;
  
  localStorage.removeItem('userData');
  
  // WebSocket 연결 종료
  if (ws) {
    ws.close();
  }
  
  window.location.href = 'login.html';
}
