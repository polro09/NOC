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
  
  const closeProfileModal = document.getElementById('closeProfileModal');
  if (closeProfileModal) {
    closeProfileModal.addEventListener('click', () => {
      closeProfileModal();
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
  
  console.log('✅ UI 초기화 완료');
}

// ✅ 2. 별명 수정 기능
async function editNickname() {
  const newNickname = prompt('새로운 별명을 입력하세요:', currentUser.customNickname);
  
  if (!newNickname || newNickname.trim() === '') {
    return;
  }
  
  if (newNickname === currentUser.customNickname) {
    alert('기존 별명과 동일합니다.');
    return;
  }
  
  try {
    console.log('📡 별명 변경 요청:', newNickname);
    
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
    alert('별명 변경에 실패했습니다: ' + error.message);
  }
}

// ✅ 3. 소속 길드 변경 기능
async function editUserGuild() {
  // 길드 목록 가져오기
  const guilds = JSON.parse(localStorage.getItem('guilds') || '[]');
  
  if (guilds.length === 0) {
    alert('등록된 길드가 없습니다. 먼저 길드를 생성해주세요.');
    return;
  }
  
  // 선택 UI (간단한 프롬프트)
  const guildNames = guilds.map((g, i) => `${i + 1}. ${g.name}`).join('\n');
  const selection = prompt(`소속 길드를 선택하세요:\n\n${guildNames}\n\n번호를 입력하세요 (취소하려면 0):`);
  
  if (!selection || selection === '0') {
    return;
  }
  
  const guildIndex = parseInt(selection) - 1;
  if (isNaN(guildIndex) || guildIndex < 0 || guildIndex >= guilds.length) {
    alert('잘못된 선택입니다.');
    return;
  }
  
  const selectedGuild = guilds[guildIndex];
  
  try {
    console.log('📡 소속 길드 변경 요청:', selectedGuild.name);
    
    const response = await fetch(`${API_BASE}/users/profile`, {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
      },
      body: JSON.stringify({
        discordId: currentUser.discordId,
        guildId: selectedGuild.id
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    console.log('✅ 소속 길드 변경 성공:', result);
    
    // 로컬 데이터 업데이트
    currentUser.guild = selectedGuild.name;
    currentUser.guildId = selectedGuild.id;
    localStorage.setItem('userData', JSON.stringify(currentUser));
    
    // UI 업데이트
    document.getElementById('userGuild').value = selectedGuild.name;
    
    alert(`소속 길드가 [${selectedGuild.name}]으로 변경되었습니다!`);
  } catch (error) {
    console.error('❌ 소속 길드 변경 실패:', error);
    alert('소속 길드 변경에 실패했습니다: ' + error.message);
  }
}

// WebSocket 연결
function connectWebSocket() {
  console.log('WebSocket 연결 준비 중...');
  // TODO: 실제 WebSocket 서버 URL로 변경
}

// ✅ 4. 길드 로드 (API 연동)
async function loadGuilds() {
  try {
    console.log('📡 길드 목록 요청...');
    
    const response = await fetch(`${API_BASE}/guilds`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const guilds = await response.json();
    console.log('✅ 길드 목록 로드:', guilds);
    
    // 로컬스토리지에 저장
    localStorage.setItem('guilds', JSON.stringify(guilds));
    
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
  } catch (error) {
    console.error('❌ 길드 목록 로드 실패:', error);
    
    // 폴백: 로컬스토리지 사용
    const guilds = JSON.parse(localStorage.getItem('guilds') || '[]');
    const guildList = document.getElementById('guildList');
    guildList.innerHTML = '';
    
    guilds.forEach(guild => {
      const guildEl = createGuildElement(guild);
      guildList.appendChild(guildEl);
    });
  }
}

// ✅ 5. 길드 요소 생성 (로고 이미지 표시)
function createGuildElement(guild) {
  const item = document.createElement('div');
  item.className = 'guild-item';
  item.dataset.guildId = guild.id;
  
  const icon = document.createElement('div');
  icon.className = 'guild-icon';
  
  // ✅ 로고 이미지 표시
  if (guild.logo) {
    const img = document.createElement('img');
    img.src = guild.logo; // Base64 또는 URL
    img.alt = guild.name;
    img.onerror = () => {
      console.log('⚠️ 길드 로고 로드 실패:', guild.name);
      icon.textContent = guild.name[0];
    };
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
  
  // 생성자만 수정/삭제 가능
  if (currentUser && guild.owner_id === currentUser.discordId) {
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
      deleteGuild(guild.id);
    };
    
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
  }
  
  item.appendChild(icon);
  item.appendChild(info);
  item.appendChild(actions);
  
  item.addEventListener('click', () => {
    document.querySelectorAll('.guild-item').forEach(el => el.classList.remove('active'));
    item.classList.add('active');
  });
  
  return item;
}

// ✅ 6. 채널 로드 (API 연동 + 인원수 표시)
async function loadChannels() {
  try {
    console.log('📡 채널 목록 요청...');
    const response = await fetch(`${API_BASE}/channels`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const channels = await response.json();
    console.log('✅ 채널 목록 로드:', channels);
    
    // 로컬스토리지에 저장
    localStorage.setItem('channels', JSON.stringify(channels));
    
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
        logo: channel.logo,
        memberCount: channel.member_count || 0,
        ownerId: channel.owner_id
      });
      channelList.appendChild(channelEl);
    });
  } catch (error) {
    console.error('❌ 채널 목록 로드 실패:', error);
    
    // 폴백: 로컬스토리지 사용
    const channels = JSON.parse(localStorage.getItem('channels') || '[]');
    const channelList = document.getElementById('channelList');
    channelList.innerHTML = '';
    
    channels.forEach(channel => {
      const channelEl = createChannelElement(channel);
      channelList.appendChild(channelEl);
    });
  }
}

// ✅ 7. 채널 요소 생성 (로고 + 인원수 표시)
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
  
  // 생성자만 수정/삭제 가능
  if (currentUser && channel.ownerId === currentUser.discordId) {
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
      deleteChannel(channel.id);
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
  
  document.getElementById('profileModal').style.display = 'flex';
}

function closeProfileModalFunc() {
  document.getElementById('profileModal').style.display = 'none';
}

function openGuildModal() {
  guildLogoData = null;
  document.getElementById('addGuildModal').style.display = 'flex';
}

function closeGuildModal() {
  document.getElementById('addGuildModal').style.display = 'none';
  resetGuildForm();
}

function openChannelModal() {
  channelLogoData = null;
  document.getElementById('addChannelModal').style.display = 'flex';
}

function closeChannelModal() {
  document.getElementById('addChannelModal').style.display = 'none';
  resetChannelForm();
}

// 길드 로고 업로드
function handleGuildLogoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    guildLogoData = e.target.result;
    console.log('✅ 길드 로고 업로드 완료');
  };
  reader.readAsDataURL(file);
}

// 채널 로고 업로드
function handleChannelLogoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    channelLogoData = e.target.result;
    console.log('✅ 채널 로고 업로드 완료');
  };
  reader.readAsDataURL(file);
}

// ✅ 10. 길드 제출 (API 연동)
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
    logo: guildLogoData,
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
    
    // 폴백: 로컬스토리지 저장
    const guilds = JSON.parse(localStorage.getItem('guilds') || '[]');
    guilds.push({
      id: `guild_${Date.now()}`,
      ...guildData,
      created_at: new Date().toISOString()
    });
    localStorage.setItem('guilds', JSON.stringify(guilds));
    
    alert('길드가 등록되었습니다! (로컬)');
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
    
    // 폴백: 로컬스토리지 저장
    const channels = JSON.parse(localStorage.getItem('channels') || '[]');
    channels.push({
      id: `channel_${Date.now()}`,
      ...channelData,
      hasPassword: !!password,
      memberCount: 0,
      created_at: new Date().toISOString()
    });
    localStorage.setItem('channels', JSON.stringify(channels));
    
    alert('채널이 등록되었습니다! (로컬)');
    closeChannelModal();
    loadChannels();
  }
}

// 폼 리셋
function resetGuildForm() {
  document.getElementById('guildName').value = '';
  document.getElementById('guildFaction').value = '';
  document.getElementById('guildRecruitment').value = '모집중';
  document.getElementById('guildDescription').value = '';
  document.getElementById('guildContact').value = '';
  document.getElementById('guildLogo').value = '';
  guildLogoData = null;
}

function resetChannelForm() {
  document.getElementById('channelName').value = '';
  document.getElementById('channelPassword').value = '';
  document.getElementById('channelLogo').value = '';
  channelLogoData = null;
}

// ✅ 12. 길드 수정
async function editGuild(guild) {
  const name = prompt('길드명:', guild.name);
  if (!name) return;
  
  const faction = prompt('진영 (소함대, 무역연합, 해적, 안틸리아, 에스파니올, 카이 & 세베리아):', guild.faction);
  if (!faction) return;
  
  const recruitment = confirm('모집 중입니까?') ? '모집중' : '모집 마감';
  
  try {
    const response = await fetch(`${API_BASE}/guilds/${guild.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, faction, recruitment })
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    alert('길드가 수정되었습니다!');
    loadGuilds();
  } catch (error) {
    console.error('❌ 길드 수정 실패:', error);
    
    // 폴백
    const guilds = JSON.parse(localStorage.getItem('guilds') || '[]');
    const index = guilds.findIndex(g => g.id === guild.id);
    if (index > -1) {
      guilds[index] = { ...guilds[index], name, faction, recruitment };
      localStorage.setItem('guilds', JSON.stringify(guilds));
      alert('길드가 수정되었습니다! (로컬)');
      loadGuilds();
    }
  }
}

// ✅ 13. 길드 삭제
async function deleteGuild(guildId) {
  if (!confirm('정말 이 길드를 삭제하시겠습니까?')) return;
  
  try {
    const response = await fetch(`${API_BASE}/guilds/${guildId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    alert('길드가 삭제되었습니다!');
    loadGuilds();
  } catch (error) {
    console.error('❌ 길드 삭제 실패:', error);
    
    // 폴백
    const guilds = JSON.parse(localStorage.getItem('guilds') || '[]');
    const filtered = guilds.filter(g => g.id !== guildId);
    localStorage.setItem('guilds', JSON.stringify(filtered));
    alert('길드가 삭제되었습니다! (로컬)');
    loadGuilds();
  }
}

// ✅ 14. 채널 수정
async function editChannel(channel) {
  const name = prompt('채널명:', channel.name);
  if (!name) return;
  
  const hasPassword = confirm('비밀번호를 설정하시겠습니까?');
  const password = hasPassword ? prompt('비밀번호:') : null;
  
  try {
    const response = await fetch(`${API_BASE}/channels/${channel.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password })
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    alert('채널이 수정되었습니다!');
    loadChannels();
  } catch (error) {
    console.error('❌ 채널 수정 실패:', error);
    
    // 폴백
    const channels = JSON.parse(localStorage.getItem('channels') || '[]');
    const index = channels.findIndex(c => c.id === channel.id);
    if (index > -1) {
      channels[index] = { ...channels[index], name, password, hasPassword: !!password };
      localStorage.setItem('channels', JSON.stringify(channels));
      alert('채널이 수정되었습니다! (로컬)');
      loadChannels();
    }
  }
}

// ✅ 15. 채널 삭제
async function deleteChannel(channelId) {
  if (!confirm('정말 이 채널을 삭제하시겠습니까?')) return;
  
  try {
    const response = await fetch(`${API_BASE}/channels/${channelId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    alert('채널이 삭제되었습니다!');
    loadChannels();
  } catch (error) {
    console.error('❌ 채널 삭제 실패:', error);
    
    // 폴백
    const channels = JSON.parse(localStorage.getItem('channels') || '[]');
    const filtered = channels.filter(c => c.id !== channelId);
    localStorage.setItem('channels', JSON.stringify(filtered));
    alert('채널이 삭제되었습니다! (로컬)');
    loadChannels();
  }
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