const { ipcRenderer } = require('electron');
const { API_BASE } = require('../config');

// 사용자 데이터
let currentUser = null;
let currentChannel = null;
let ws = null;

// 로고 이미지 데이터
let guildLogoData = null;
let channelLogoData = null;

// 실시간 유저 수 업데이트 인터벌
let memberCountUpdateInterval = null;

// 페이지 리다이렉트 플래그
let isRedirecting = false;
let isCheckingAuth = false;

console.log('📄 index.html 로드됨');

// 초기화
document.addEventListener('DOMContentLoaded', () => {
  console.log('📋 DOMContentLoaded - 초기화 시작');
  
  if (isCheckingAuth || isRedirecting) {
    console.log('⏳ 이미 인증 체크 중이거나 리다이렉트 중...');
    return;
  }
  
  isCheckingAuth = true;
  
  if (!loadUserData()) {
    console.log('⏹️ 사용자 데이터 없음 - 초기화 중단');
    isCheckingAuth = false;
    return;
  }
  
  isCheckingAuth = false;
  
  console.log('▶️ 사용자 데이터 확인 완료 - 앱 초기화 계속');
  initializeUI();
  connectWebSocket();
  loadGuilds();
  loadChannels();
  
  // 실시간 유저 수 업데이트 시작
  startMemberCountUpdate();
});

// 사용자 데이터 로드
function loadUserData() {
  console.log('🔍 사용자 데이터 확인 중...');
  
  if (isRedirecting) {
    console.log('⏳ 이미 리다이렉트 중...');
    return false;
  }
  
  const userData = localStorage.getItem('userData');
  console.log('📊 localStorage userData:', userData ? '존재함' : '없음');
  
  if (!userData) {
    console.error('❌ 사용자 데이터 없음 - 로그인 페이지로 이동');
    isRedirecting = true;
    
    setTimeout(() => {
      window.location.href = 'login.html';
    }, 100);
    return false;
  }
  
  try {
    currentUser = JSON.parse(userData);
    console.log('✅ 사용자 데이터 로드 완료:', currentUser.discordUsername);
    console.log('✅ 현재 사용자 ID:', currentUser.discordId);
    
    if (!currentUser.discordId || !currentUser.discordUsername || !currentUser.customNickname) {
      console.error('❌ 사용자 데이터 불완전:', currentUser);
      console.log('🗑️ 손상된 userData 제거');
      localStorage.removeItem('userData');
      isRedirecting = true;
      
      setTimeout(() => {
        window.location.href = 'login.html';
      }, 100);
      return false;
    }
    
    updateUserProfile();
    return true;
  } catch (e) {
    console.error('❌ userData 파싱 오류:', e);
    console.log('🗑️ 손상된 userData 제거');
    localStorage.removeItem('userData');
    isRedirecting = true;
    
    setTimeout(() => {
      window.location.href = 'login.html';
    }, 100);
    return false;
  }
}

// ✅ 1. 사용자 프로필 업데이트 (Discord 이미지 수정)
function updateUserProfile() {
  console.log('🖼️ 프로필 업데이트 시작:', currentUser);
  
  // 닉네임 표시
  document.getElementById('profileName').textContent = currentUser.customNickname || currentUser.discordUsername;
  
  // ✅ Discord 프로필 이미지 올바르게 설정
  const avatarImg = document.getElementById('profileAvatar');
  if (currentUser.avatar) {
    const extension = currentUser.avatar.startsWith('a_') ? 'gif' : 'png';
    const avatarUrl = `https://cdn.discordapp.com/avatars/${currentUser.discordId}/${currentUser.avatar}.${extension}?size=128`;
    console.log('📷 Discord 프로필 이미지 URL:', avatarUrl);
    
    avatarImg.src = avatarUrl;
    avatarImg.onerror = () => {
      console.log('⚠️ 프로필 이미지 로드 실패 - 기본 이미지 사용');
      const defaultAvatar = parseInt(currentUser.discordId) % 5;
      avatarImg.src = `https://cdn.discordapp.com/embed/avatars/${defaultAvatar}.png`;
    };
  } else {
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
  
  // 닫기 버튼
  const closeBtn = document.getElementById('closeBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      console.log('❌ 닫기 버튼 클릭');
      ipcRenderer.send('close-window');
    });
  }
  
  // 프로필 모달
  const userProfile = document.getElementById('userProfile');
  if (userProfile) {
    userProfile.addEventListener('click', () => {
      console.log('👤 프로필 클릭');
      openProfileModal();
    });
  }
  
  // ✅ 수정: 프로필 모달 닫기 버튼 (함수명 충돌 해결)
  const closeProfileModalBtn = document.getElementById('closeProfileModal');
  if (closeProfileModalBtn) {
    closeProfileModalBtn.addEventListener('click', () => {
      closeProfileModalFunc();
    });
  }
  
  // ✅ 2. 별명 수정 버튼
  const editNicknameBtn = document.getElementById('editDiscordBtn');
  if (editNicknameBtn) {
    editNicknameBtn.addEventListener('click', () => {
      console.log('✏️ 별명 수정 버튼 클릭');
      editNickname();
    });
  }
  
  // ✅ 3. 소속 길드 변경 버튼
  const editGuildBtn = document.getElementById('editGuildBtn');
  if (editGuildBtn) {
    editGuildBtn.addEventListener('click', () => {
      console.log('🏰 소속 길드 변경 버튼 클릭');
      editUserGuild();
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
  if (addGuildBtn) {
    addGuildBtn.addEventListener('click', () => {
      console.log('➕ 길드 추가 버튼 클릭');
      openGuildModal();
    });
  }
  
  const closeGuildModalBtn = document.getElementById('closeGuildModal');
  if (closeGuildModalBtn) {
    closeGuildModalBtn.addEventListener('click', () => {
      closeGuildModal();
    });
  }
  
  const submitGuildBtn = document.getElementById('submitGuild');
  if (submitGuildBtn) {
    submitGuildBtn.addEventListener('click', () => {
      console.log('✅ 길드 제출 버튼 클릭');
      submitGuild();
    });
  }
  
  // 길드 로고 업로드
  const guildLogoInput = document.getElementById('guildLogo');
  if (guildLogoInput) {
    guildLogoInput.addEventListener('change', handleGuildLogoUpload);
  }
  
  // 채널 추가
  const addChannelBtn = document.getElementById('addChannelBtn');
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
  
  // 채널 로고 업로드
  const channelLogoInput = document.getElementById('channelLogo');
  if (channelLogoInput) {
    channelLogoInput.addEventListener('change', handleChannelLogoUpload);
  }
  
  // 삭제 확인 모달
  const closeDeleteModalBtn = document.getElementById('closeDeleteModal');
  if (closeDeleteModalBtn) {
    closeDeleteModalBtn.addEventListener('click', () => {
      closeDeleteModal();
    });
  }
  
  const cancelDeleteBtn = document.getElementById('cancelDelete');
  if (cancelDeleteBtn) {
    cancelDeleteBtn.addEventListener('click', () => {
      closeDeleteModal();
    });
  }
  
  // 길드 상세 모달 닫기
  const closeGuildDetailModalBtn = document.getElementById('closeGuildDetailModal');
  if (closeGuildDetailModalBtn) {
    closeGuildDetailModalBtn.addEventListener('click', () => {
      closeGuildDetailModal();
    });
  }
  
  console.log('✅ UI 초기화 완료');
}

// ✅ 2. 별명 수정 기능 (수정됨)
async function editNickname() {
  const newNickname = prompt('새로운 별명을 입력하세요:', currentUser.customNickname);
  
  if (!newNickname || newNickname.trim() === '') {
    return;
  }
  
  if (newNickname.trim() === currentUser.customNickname) {
    alert('기존 별명과 동일합니다.');
    return;
  }
  
  try {
    console.log('📡 별명 변경 요청:', newNickname.trim());
    
    const response = await fetch(`${API_BASE}/users/profile`, {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
      },
      body: JSON.stringify({
        discordId: currentUser.discordId,
        customNickname: newNickname.trim()
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    console.log('✅ 별명 변경 성공:', result);
    
    // 로컬 데이터 업데이트
    currentUser.customNickname = newNickname.trim();
    localStorage.setItem('userData', JSON.stringify(currentUser));
    
    // UI 업데이트
    document.getElementById('profileName').textContent = newNickname.trim();
    document.getElementById('discordNickname').value = newNickname.trim();
    
    alert('별명이 변경되었습니다!');
  } catch (error) {
    console.error('❌ 별명 변경 실패:', error);
    
    // ✅ 폴백: 로컬에서만 변경
    currentUser.customNickname = newNickname.trim();
    localStorage.setItem('userData', JSON.stringify(currentUser));
    
    // UI 업데이트
    document.getElementById('profileName').textContent = newNickname.trim();
    document.getElementById('discordNickname').value = newNickname.trim();
    
    alert('별명이 변경되었습니다!');
  }
}

// ✅ 3. 소속 길드 변경 기능 (수정됨)
async function editUserGuild() {
  // 길드 목록 가져오기 (로컬스토리지에서)
  let guilds = JSON.parse(localStorage.getItem('guilds') || '[]');
  
  console.log('📋 길드 목록:', guilds);
  
  if (!guilds || guilds.length === 0) {
    alert('등록된 길드가 없습니다. 먼저 길드를 생성해주세요.');
    return;
  }
  
  // 선택 UI (약어와 이름 함께 표시)
  const guildNames = ['0. 없음 (길드 탈퇴)'].concat(
    guilds.map((g, i) => `${i + 1}. [${g.shortName || g.name}] ${g.name}`)
  ).join('\n');
  const selection = prompt(`소속 길드를 선택하세요:\n\n${guildNames}\n\n번호를 입력하세요 (취소하려면 빈칸):`);
  
  if (selection === null || selection === '') {
    return;
  }
  
  const guildIndex = parseInt(selection);
  
  if (isNaN(guildIndex) || guildIndex < 0 || guildIndex > guilds.length) {
    alert('잘못된 선택입니다.');
    return;
  }
  
  // 0 선택시 길드 탈퇴
  const selectedGuild = guildIndex === 0 ? null : guilds[guildIndex - 1];
  // ✅ 약어 사용 (shortName이 없으면 name 사용)
  const guildShortName = selectedGuild ? (selectedGuild.shortName || selectedGuild.name) : '없음';
  const guildName = selectedGuild ? selectedGuild.name : '없음';
  const guildId = selectedGuild ? selectedGuild.id : null;
  
  console.log('📋 선택된 길드:', guildShortName, guildName, guildId);
  
  // 로컬 데이터 먼저 업데이트 (약어 저장)
  currentUser.guild = guildShortName;
  currentUser.guildName = guildName;
  currentUser.guildId = guildId;
  localStorage.setItem('userData', JSON.stringify(currentUser));
  
  // UI 업데이트 (약어 표시)
  document.getElementById('userGuild').value = guildShortName;
  
  try {
    console.log('📡 소속 길드 변경 요청:', guildShortName);
    
    const response = await fetch(`${API_BASE}/users/profile`, {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
      },
      body: JSON.stringify({
        discordId: currentUser.discordId,
        guildId: guildId
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    console.log('✅ 서버 동기화 성공');
  } catch (error) {
    console.log('⚠️ 서버 동기화 실패 (로컬은 저장됨):', error.message);
  }
  
  alert(`소속 길드가 [${guildShortName}](으)로 변경되었습니다!`);
}

// WebSocket 연결
function connectWebSocket() {
  console.log('WebSocket 연결 준비 중...');
  // TODO: 실제 WebSocket 서버 URL로 변경
}

// ✅ 4. 길드 로드 (API 연동)
async function loadGuilds() {
  // 먼저 로컬 데이터 로드
  const localGuilds = JSON.parse(localStorage.getItem('guilds') || '[]');
  
  try {
    console.log('📡 길드 목록 요청...');
    
    const response = await fetch(`${API_BASE}/guilds`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const serverGuilds = await response.json();
    console.log('✅ 서버 길드 목록:', serverGuilds);
    
    // ✅ 서버 데이터가 있으면 서버 데이터 사용, 없으면 로컬 데이터 유지
    if (serverGuilds && serverGuilds.length > 0) {
      localStorage.setItem('guilds', JSON.stringify(serverGuilds));
      renderGuilds(serverGuilds);
    } else if (localGuilds.length > 0) {
      console.log('ℹ️ 서버 데이터 없음, 로컬 데이터 사용:', localGuilds.length, '개');
      renderGuilds(localGuilds);
    } else {
      renderGuilds([]);
    }
  } catch (error) {
    console.error('❌ 길드 목록 로드 실패:', error);
    console.log('ℹ️ 로컬 데이터 사용:', localGuilds.length, '개');
    renderGuilds(localGuilds);
  }
}

// ✅ 길드 렌더링 분리
function renderGuilds(guilds) {
  const guildList = document.getElementById('guildList');
  guildList.innerHTML = '';
  
  if (guilds.length === 0) {
    guildList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">등록된 길드가 없습니다</div>';
    return;
  }
  
  guilds.forEach(guild => {
    const guildEl = createGuildElement(guild);
    guildList.appendChild(guildEl);
  });
}

// ✅ 5. 길드 요소 생성 (3줄 레이아웃: 약어, 이름, 진영)
function createGuildElement(guild) {
  const item = document.createElement('div');
  item.className = 'guild-item';
  item.dataset.guildId = guild.id;
  
  const icon = document.createElement('div');
  icon.className = 'guild-icon';
  
  // ✅ 로고 이미지 표시
  if (guild.logo) {
    const img = document.createElement('img');
    img.src = guild.logo;
    img.alt = guild.shortName || guild.name;
    img.onerror = () => {
      console.log('⚠️ 길드 로고 로드 실패:', guild.name);
      icon.textContent = (guild.shortName || guild.name || 'G')[0];
    };
    icon.appendChild(img);
  } else {
    icon.textContent = (guild.shortName || guild.name || 'G')[0];
  }
  
  const info = document.createElement('div');
  info.className = 'guild-info';
  
  // 첫 번째 줄: 약어 (있을 때만)
  if (guild.shortName && guild.shortName !== guild.name) {
    const shortName = document.createElement('div');
    shortName.className = 'guild-short-name';
    shortName.textContent = `[${guild.shortName}]`;
    info.appendChild(shortName);
  }
  
  // 두 번째 줄: 전체 이름
  const fullName = document.createElement('div');
  fullName.className = 'guild-name';
  fullName.textContent = guild.name || '-';
  info.appendChild(fullName);
  
  // 세 번째 줄: 진영
  const faction = document.createElement('div');
  faction.className = 'guild-faction';
  faction.textContent = guild.faction || '-';
  info.appendChild(faction);
  
  const actions = document.createElement('div');
  actions.className = 'item-actions';
  
  // ✅ 수정: owner_id 비교 (문자열 비교)
  const isOwner = currentUser && (String(guild.owner_id) === String(currentUser.discordId));
  console.log(`길드 [${guild.shortName || guild.name}] owner_id: ${guild.owner_id}, currentUser.discordId: ${currentUser?.discordId}, isOwner: ${isOwner}`);
  
  if (isOwner) {
    const editBtn = document.createElement('button');
    editBtn.className = 'action-btn';
    editBtn.textContent = '✏️';
    editBtn.title = '수정';
    editBtn.onclick = (e) => {
      e.stopPropagation();
      editGuild(guild);
    };
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'action-btn delete';
    deleteBtn.textContent = '🗑️';
    deleteBtn.title = '삭제';
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      confirmDeleteGuild(guild);
    };
    
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
  }
  
  item.appendChild(icon);
  item.appendChild(info);
  item.appendChild(actions);
  
  // ✅ 클릭 시 길드 상세 페이지 표시
  item.addEventListener('click', () => {
    document.querySelectorAll('.guild-item').forEach(el => el.classList.remove('active'));
    item.classList.add('active');
    openGuildDetailModal(guild);
  });
  
  return item;
}

// ✅ 6. 채널 로드 (API 연동 + 인원수 표시)
async function loadChannels() {
  // 먼저 로컬 데이터 로드
  const localChannels = JSON.parse(localStorage.getItem('channels') || '[]');
  
  try {
    console.log('📡 채널 목록 요청...');
    const response = await fetch(`${API_BASE}/channels`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const serverChannels = await response.json();
    console.log('✅ 서버 채널 목록:', serverChannels);
    
    // ✅ 서버 데이터가 있으면 서버 데이터 사용, 없으면 로컬 데이터 유지
    if (serverChannels && serverChannels.length > 0) {
      localStorage.setItem('channels', JSON.stringify(serverChannels));
      renderChannels(serverChannels);
    } else if (localChannels.length > 0) {
      console.log('ℹ️ 서버 데이터 없음, 로컬 데이터 사용:', localChannels.length, '개');
      renderChannels(localChannels);
    } else {
      renderChannels([]);
    }
  } catch (error) {
    console.error('❌ 채널 목록 로드 실패:', error);
    console.log('ℹ️ 로컬 데이터 사용:', localChannels.length, '개');
    renderChannels(localChannels);
  }
}

// ✅ 채널 렌더링 분리
function renderChannels(channels) {
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
      hasPassword: channel.has_password === 1 || channel.hasPassword,
      logo: channel.logo,
      memberCount: channel.member_count || channel.memberCount || 0,
      ownerId: channel.owner_id || channel.ownerId
    });
    channelList.appendChild(channelEl);
  });
}

// ✅ 7. 채널 요소 생성 (수정됨 - ownerId 비교 수정)
function createChannelElement(channel) {
  const item = document.createElement('div');
  item.className = 'channel-item';
  item.dataset.channelId = channel.id;
  
  const icon = document.createElement('div');
  icon.className = 'channel-icon';
  
  // ✅ 로고 이미지 표시
  if (channel.logo) {
    const img = document.createElement('img');
    img.src = channel.logo; // Base64 또는 URL
    img.alt = channel.name;
    img.onerror = () => {
      console.log('⚠️ 채널 로고 로드 실패:', channel.name);
      icon.textContent = '#';
    };
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
  
  // ✅ 인원수 표시
  if (channel.memberCount !== undefined) {
    const memberCount = document.createElement('div');
    memberCount.className = 'channel-member-count';
    memberCount.textContent = `${channel.memberCount}명`;
    memberCount.dataset.channelId = channel.id;
    info.appendChild(memberCount);
  }
  
  const actions = document.createElement('div');
  actions.className = 'item-actions';
  
  // ✅ 수정: ownerId 비교 (문자열 비교)
  const isOwner = currentUser && (String(channel.ownerId) === String(currentUser.discordId));
  console.log(`채널 [${channel.name}] ownerId: ${channel.ownerId}, currentUser.discordId: ${currentUser?.discordId}, isOwner: ${isOwner}`);
  
  if (isOwner) {
    const editBtn = document.createElement('button');
    editBtn.className = 'action-btn';
    editBtn.textContent = '✏️';
    editBtn.title = '수정';
    editBtn.onclick = (e) => {
      e.stopPropagation();
      editChannel(channel);
    };
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'action-btn delete';
    deleteBtn.textContent = '🗑️';
    deleteBtn.title = '삭제';
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      confirmDeleteChannel(channel);
    };
    
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
  }
  
  item.appendChild(icon);
  item.appendChild(info);
  item.appendChild(actions);
  
  // ✅ 8. 채널 클릭 시 비밀번호 확인
  item.addEventListener('click', () => {
    if (channel.hasPassword) {
      joinPasswordProtectedChannel(channel);
    } else {
      joinChannel(channel);
    }
  });
  
  return item;
}

// ✅ 8. 비밀번호 보호 채널 입장
async function joinPasswordProtectedChannel(channel) {
  const password = prompt(`🔒 비밀번호를 입력하세요 (채널: ${channel.name})`);
  
  if (!password) {
    return;
  }
  
  try {
    console.log('📡 비밀번호 검증 요청:', channel.id);
    
    const response = await fetch(`${API_BASE}/channels/verify-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: channel.id,
        password: password
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    console.log('✅ 비밀번호 검증 결과:', result);
    
    if (result.success) {
      joinChannel(channel);
    } else {
      alert('❌ 비밀번호가 틀렸습니다.');
    }
  } catch (error) {
    console.error('❌ 비밀번호 검증 실패:', error);
    alert('비밀번호 검증에 실패했습니다: ' + error.message);
  }
}

// 채널 참여
function joinChannel(channel) {
  console.log('💬 채널 참여:', channel.name);
  
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

// ✅ 9. 실시간 인원수 업데이트
function startMemberCountUpdate() {
  // 5초마다 업데이트
  memberCountUpdateInterval = setInterval(async () => {
    try {
      const response = await fetch(`${API_BASE}/channels/member-counts`);
      
      if (!response.ok) {
        return;
      }
      
      const counts = await response.json();
      // counts = [{ channelId: 'general', count: 127 }, ...]
      
      counts.forEach(({ channelId, count }) => {
        const memberCountEl = document.querySelector(`.channel-member-count[data-channel-id="${channelId}"]`);
        if (memberCountEl) {
          memberCountEl.textContent = `${count}명`;
        }
      });
    } catch (error) {
      // 조용히 실패
    }
  }, 5000);
}

// 모달 열기/닫기
function openProfileModal() {
  document.getElementById('discordId').value = currentUser.discordId;
  document.getElementById('discordNickname').value = currentUser.customNickname;
  document.getElementById('userGuild').value = currentUser.guild || '없음';
  
  // 프로필 이미지 표시
  const profileDetailAvatar = document.getElementById('profileDetailAvatar');
  if (currentUser.avatar) {
    const extension = currentUser.avatar.startsWith('a_') ? 'gif' : 'png';
    const avatarUrl = `https://cdn.discordapp.com/avatars/${currentUser.discordId}/${currentUser.avatar}.${extension}?size=256`;
    profileDetailAvatar.src = avatarUrl;
  } else {
    const defaultAvatar = parseInt(currentUser.discordId) % 5;
    profileDetailAvatar.src = `https://cdn.discordapp.com/embed/avatars/${defaultAvatar}.png`;
  }
  
  // ✅ 버튼 이벤트 직접 연결
  document.getElementById('editDiscordBtn').onclick = function() {
    console.log('✏️ 닉네임 변경 클릭');
    editNickname();
  };
  
  document.getElementById('editGuildBtn').onclick = function() {
    console.log('🏰 길드 변경 클릭');
    editUserGuild();
  };
  
  document.getElementById('profileModal').style.display = 'flex';
}

// ✅ 함수명 변경 (충돌 해결)
function closeProfileModalFunc() {
  document.getElementById('profileModal').style.display = 'none';
}

function openGuildModal() {
  guildLogoData = null;
  document.getElementById('guildModalTitle').textContent = '길드 게시판 등록';
  document.getElementById('guildEditId').value = '';
  resetGuildForm();
  document.getElementById('addGuildModal').style.display = 'flex';
}

function closeGuildModal() {
  document.getElementById('addGuildModal').style.display = 'none';
  resetGuildForm();
}

function openChannelModal() {
  channelLogoData = null;
  document.getElementById('channelModalTitle').textContent = '채팅 채널 등록';
  document.getElementById('channelEditId').value = '';
  resetChannelForm();
  document.getElementById('addChannelModal').style.display = 'flex';
}

function closeChannelModal() {
  document.getElementById('addChannelModal').style.display = 'none';
  resetChannelForm();
}

// ✅ 길드 상세 모달
function openGuildDetailModal(guild) {
  console.log('📋 길드 상세 보기:', guild);
  
  // 로고
  const logoEl = document.getElementById('guildDetailLogo');
  logoEl.innerHTML = '';
  if (guild.logo) {
    const img = document.createElement('img');
    img.src = guild.logo;
    img.alt = guild.shortName || guild.name;
    logoEl.appendChild(img);
  } else {
    logoEl.textContent = (guild.shortName || guild.name || 'G')[0];
  }
  
  // 이름 정보 - 약어와 이름이 다를 때만 둘 다 표시
  const shortText = guild.shortName || '';
  const fullText = guild.name || '-';
  
  if (shortText && shortText !== fullText) {
    // 약어와 이름이 다르면 둘 다 표시
    document.getElementById('guildDetailShort').textContent = shortText;
    document.getElementById('guildDetailFull').textContent = fullText;
    document.getElementById('guildDetailFull').style.display = 'block';
  } else {
    // 약어가 없거나 같으면 이름만 표시
    document.getElementById('guildDetailShort').textContent = fullText;
    document.getElementById('guildDetailFull').style.display = 'none';
  }
  
  document.getElementById('guildDetailFaction').textContent = guild.faction || '-';
  
  // 상세 정보
  document.getElementById('guildDetailRecruitment').textContent = guild.recruitment || '-';
  document.getElementById('guildDetailDescription').textContent = guild.description || '-';
  document.getElementById('guildDetailContact').textContent = guild.contact || '-';
  
  document.getElementById('guildDetailModal').style.display = 'flex';
}

function closeGuildDetailModal() {
  document.getElementById('guildDetailModal').style.display = 'none';
}

// ✅ 삭제 확인 모달
let deleteTarget = null;
let deleteType = null;

function confirmDeleteGuild(guild) {
  deleteTarget = guild;
  deleteType = 'guild';
  document.getElementById('deleteConfirmMessage').textContent = `정말 [${guild.name}] 길드를 삭제하시겠습니까?`;
  document.getElementById('deleteConfirmModal').style.display = 'flex';
  
  // 삭제 버튼에 이벤트 연결
  document.getElementById('confirmDelete').onclick = () => {
    deleteGuild(guild.id);
    closeDeleteModal();
  };
}

function confirmDeleteChannel(channel) {
  deleteTarget = channel;
  deleteType = 'channel';
  document.getElementById('deleteConfirmMessage').textContent = `정말 [${channel.name}] 채널을 삭제하시겠습니까?`;
  document.getElementById('deleteConfirmModal').style.display = 'flex';
  
  // 삭제 버튼에 이벤트 연결
  document.getElementById('confirmDelete').onclick = () => {
    deleteChannel(channel.id);
    closeDeleteModal();
  };
}

function closeDeleteModal() {
  document.getElementById('deleteConfirmModal').style.display = 'none';
  deleteTarget = null;
  deleteType = null;
}

// 길드 로고 업로드 + 미리보기
function handleGuildLogoUpload(event) {
  const file = event.target.files[0];
  if (!file) {
    // 파일 선택 취소 시 미리보기 숨김
    const preview = document.getElementById('guildLogoPreview');
    if (preview) preview.style.display = 'none';
    guildLogoData = null;
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (e) => {
    guildLogoData = e.target.result;
    console.log('✅ 길드 로고 업로드 완료');
    
    // 미리보기 표시
    const preview = document.getElementById('guildLogoPreview');
    const previewImg = document.getElementById('guildLogoPreviewImg');
    if (preview && previewImg) {
      previewImg.src = guildLogoData;
      preview.style.display = 'block';
    }
  };
  reader.readAsDataURL(file);
}

// 채널 로고 업로드 + 미리보기
function handleChannelLogoUpload(event) {
  const file = event.target.files[0];
  if (!file) {
    // 파일 선택 취소 시 미리보기 숨김
    const preview = document.getElementById('channelLogoPreview');
    if (preview) preview.style.display = 'none';
    channelLogoData = null;
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (e) => {
    channelLogoData = e.target.result;
    console.log('✅ 채널 로고 업로드 완료');
    
    // 미리보기 표시
    const preview = document.getElementById('channelLogoPreview');
    const previewImg = document.getElementById('channelLogoPreviewImg');
    if (preview && previewImg) {
      previewImg.src = channelLogoData;
      preview.style.display = 'block';
    }
  };
  reader.readAsDataURL(file);
}

// ✅ 10. 길드 제출 (API 연동)
async function submitGuild() {
  if (!currentUser) {
    alert('로그인이 필요합니다.');
    return;
  }
  
  const editId = document.getElementById('guildEditId').value;
  const shortName = document.getElementById('guildShortName').value.trim();
  const name = document.getElementById('guildName').value.trim();
  const faction = document.getElementById('guildFaction').value;
  const recruitment = document.getElementById('guildRecruitment').value;
  const description = document.getElementById('guildDescription').value.trim();
  const contact = document.getElementById('guildContact').value.trim();
  
  if (!shortName || !name || !faction) {
    alert('필수 항목(길드 약어, 길드 이름, 진영)을 입력해주세요.');
    return;
  }
  
  const guildData = {
    shortName,
    name,
    faction,
    recruitment,
    description,
    contact,
    logo: guildLogoData,
    ownerId: currentUser.discordId
  };
  
  console.log('📡 길드 데이터:', guildData);
  
  try {
    let response;
    
    if (editId) {
      // 수정
      console.log('📡 길드 수정 요청:', editId);
      response = await fetch(`${API_BASE}/guilds/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(guildData)
      });
    } else {
      // 생성
      console.log('📡 길드 생성 요청');
      response = await fetch(`${API_BASE}/guilds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(guildData)
      });
    }
    
    console.log('📡 서버 응답:', response.status);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    console.log('✅ 길드 저장 성공:', result);
    
    alert(editId ? '길드가 수정되었습니다!' : '길드가 등록되었습니다!');
    closeGuildModal();
    loadGuilds();
  } catch (error) {
    console.error('❌ 길드 저장 실패:', error);
    
    // 폴백: 로컬스토리지 저장
    const guilds = JSON.parse(localStorage.getItem('guilds') || '[]');
    
    if (editId) {
      const index = guilds.findIndex(g => String(g.id) === String(editId));
      if (index > -1) {
        guilds[index] = { ...guilds[index], ...guildData, owner_id: currentUser.discordId };
      }
    } else {
      // ✅ 새 길드 생성 - owner_id 필드 추가
      const newGuild = {
        id: Date.now(), // 숫자 ID 사용
        shortName,
        name,
        faction,
        recruitment,
        description,
        contact,
        logo: guildLogoData,
        owner_id: currentUser.discordId, // ✅ owner_id로 저장
        created_at: new Date().toISOString()
      };
      guilds.push(newGuild);
      console.log('✅ 로컬 길드 생성:', newGuild);
    }
    
    localStorage.setItem('guilds', JSON.stringify(guilds));
    
    alert(editId ? '길드가 수정되었습니다!' : '길드가 등록되었습니다!');
    closeGuildModal();
    loadGuilds();
  }
}

// ✅ 11. 채널 제출 (API 연동)
async function submitChannel() {
  if (!currentUser) {
    alert('로그인이 필요합니다.');
    return;
  }
  
  const editId = document.getElementById('channelEditId').value;
  const name = document.getElementById('channelName').value.trim();
  const password = document.getElementById('channelPassword').value;
  
  if (!name) {
    alert('채널명을 입력해주세요.');
    return;
  }
  
  const channelData = {
    name,
    password: password || null,
    logo: channelLogoData,
    ownerId: currentUser.discordId
  };
  
  console.log('📡 채널 데이터:', channelData);
  
  try {
    let response;
    
    if (editId) {
      // 수정
      console.log('📡 채널 수정 요청:', editId);
      response = await fetch(`${API_BASE}/channels/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(channelData)
      });
    } else {
      // 생성
      console.log('📡 채널 생성 요청');
      response = await fetch(`${API_BASE}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(channelData)
      });
    }
    
    console.log('📡 서버 응답:', response.status);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    console.log('✅ 채널 저장 성공:', result);
    
    alert(editId ? '채널이 수정되었습니다!' : '채널이 등록되었습니다!');
    closeChannelModal();
    loadChannels();
  } catch (error) {
    console.error('❌ 채널 저장 실패:', error);
    
    // 폴백: 로컬스토리지 저장
    const channels = JSON.parse(localStorage.getItem('channels') || '[]');
    
    if (editId) {
      const index = channels.findIndex(c => String(c.id) === String(editId));
      if (index > -1) {
        channels[index] = { ...channels[index], ...channelData, hasPassword: !!password, owner_id: currentUser.discordId };
      }
    } else {
      // ✅ 새 채널 생성 - owner_id 필드 추가
      const newChannel = {
        id: Date.now(), // 숫자 ID 사용
        name,
        password: password || null,
        logo: channelLogoData,
        hasPassword: !!password,
        has_password: password ? 1 : 0,
        owner_id: currentUser.discordId, // ✅ owner_id로 저장
        memberCount: 0,
        member_count: 0,
        created_at: new Date().toISOString()
      };
      channels.push(newChannel);
      console.log('✅ 로컬 채널 생성:', newChannel);
    }
    
    localStorage.setItem('channels', JSON.stringify(channels));
    
    alert(editId ? '채널이 수정되었습니다!' : '채널이 등록되었습니다!');
    closeChannelModal();
    loadChannels();
  }
}

// 폼 리셋
function resetGuildForm() {
  document.getElementById('guildShortName').value = '';
  document.getElementById('guildName').value = '';
  document.getElementById('guildFaction').value = '';
  document.getElementById('guildRecruitment').value = '모집중';
  document.getElementById('guildDescription').value = '';
  document.getElementById('guildContact').value = '';
  document.getElementById('guildLogo').value = '';
  guildLogoData = null;
  
  // 미리보기 숨김
  const preview = document.getElementById('guildLogoPreview');
  if (preview) preview.style.display = 'none';
}

function resetChannelForm() {
  document.getElementById('channelName').value = '';
  document.getElementById('channelPassword').value = '';
  document.getElementById('channelLogo').value = '';
  channelLogoData = null;
  
  // 미리보기 숨김
  const preview = document.getElementById('channelLogoPreview');
  if (preview) preview.style.display = 'none';
}

// ✅ 12. 길드 수정 (모달 방식으로 변경)
function editGuild(guild) {
  console.log('✏️ 길드 수정:', guild);
  
  document.getElementById('guildModalTitle').textContent = '길드 게시판 수정';
  document.getElementById('guildEditId').value = guild.id;
  document.getElementById('guildShortName').value = guild.shortName || '';
  document.getElementById('guildName').value = guild.name || '';
  document.getElementById('guildFaction').value = guild.faction || '';
  document.getElementById('guildRecruitment').value = guild.recruitment || '모집중';
  document.getElementById('guildDescription').value = guild.description || '';
  document.getElementById('guildContact').value = guild.contact || '';
  
  guildLogoData = guild.logo || null;
  
  // 로고 미리보기 표시
  if (guild.logo) {
    const preview = document.getElementById('guildLogoPreview');
    const previewImg = document.getElementById('guildLogoPreviewImg');
    if (preview && previewImg) {
      previewImg.src = guild.logo;
      preview.style.display = 'block';
    }
  }
  
  document.getElementById('addGuildModal').style.display = 'flex';
}

// ✅ 13. 길드 삭제
async function deleteGuild(guildId) {
  console.log('🗑️ 길드 삭제 시작:', guildId);
  
  try {
    const response = await fetch(`${API_BASE}/guilds/${guildId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    console.log('✅ 서버 삭제 성공');
  } catch (error) {
    console.log('⚠️ 서버 삭제 실패 (로컬에서 삭제):', error.message);
  }
  
  // ✅ 항상 로컬에서도 삭제 (문자열 비교)
  const guilds = JSON.parse(localStorage.getItem('guilds') || '[]');
  const filtered = guilds.filter(g => String(g.id) !== String(guildId));
  localStorage.setItem('guilds', JSON.stringify(filtered));
  
  alert('길드가 삭제되었습니다!');
  loadGuilds();
}

// ✅ 14. 채널 수정 (모달 방식으로 변경)
function editChannel(channel) {
  console.log('✏️ 채널 수정:', channel);
  
  document.getElementById('channelModalTitle').textContent = '채팅 채널 수정';
  document.getElementById('channelEditId').value = channel.id;
  document.getElementById('channelName').value = channel.name || '';
  document.getElementById('channelPassword').value = ''; // 비밀번호는 보안상 비움
  
  channelLogoData = channel.logo || null;
  
  document.getElementById('addChannelModal').style.display = 'flex';
}

// ✅ 15. 채널 삭제
async function deleteChannel(channelId) {
  console.log('🗑️ 채널 삭제 시작:', channelId);
  
  try {
    const response = await fetch(`${API_BASE}/channels/${channelId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    console.log('✅ 서버 삭제 성공');
  } catch (error) {
    console.log('⚠️ 서버 삭제 실패 (로컬에서 삭제):', error.message);
  }
  
  // ✅ 항상 로컬에서도 삭제 (문자열 비교)
  const channels = JSON.parse(localStorage.getItem('channels') || '[]');
  const filtered = channels.filter(c => String(c.id) !== String(channelId));
  localStorage.setItem('channels', JSON.stringify(filtered));
  
  alert('채널이 삭제되었습니다!');
  loadChannels();
}

// 로그아웃
function logout() {
  if (!confirm('로그아웃 하시겠습니까?')) return;
  
  localStorage.removeItem('userData');
  localStorage.removeItem('authToken');
  
  if (ws) {
    ws.close();
  }
  
  if (memberCountUpdateInterval) {
    clearInterval(memberCountUpdateInterval);
  }
  
  window.location.href = 'login.html';
}

// ✅ 전역 함수 노출 (onclick에서 호출 가능하도록)
window.editNickname = editNickname;
window.editUserGuild = editUserGuild;
window.openGuildDetailModal = openGuildDetailModal;
window.closeGuildDetailModal = closeGuildDetailModal;
