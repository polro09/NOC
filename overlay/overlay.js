const { ipcRenderer } = require('electron');
const { API_BASE } = require('../config');

// ✅ 총 관리자 ID
const SUPER_ADMIN_ID = '257097077782216704';

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

// 삭제 대상 저장
let pendingDeleteItem = null;
let pendingDeleteType = null;

// 길드 선택 저장
let selectedGuildIndex = null;

console.log('📄 index.html 로드됨');

// ✅ 총 관리자 여부 확인
function isSuperAdmin() {
  return currentUser && currentUser.discordId === SUPER_ADMIN_ID;
}

// 초기화
document.addEventListener('DOMContentLoaded', () => {
  console.log('📋 DOMContentLoaded - 초기화 시작');
  
  if (isCheckingAuth || isRedirecting) {
    return;
  }
  
  isCheckingAuth = true;
  
  if (!loadUserData()) {
    isCheckingAuth = false;
    return;
  }
  
  isCheckingAuth = false;
  
  initializeUI();
  loadGuilds();
  loadChannels();
  startMemberCountUpdate();
  
  // ✅ 채팅 오버레이에서 인원수 업데이트 수신
  ipcRenderer.on('channel-member-count-updated', (event, data) => {
    const { channelId, count } = data;
    updateChannelMemberCountUI(channelId, count);
  });
});

// ✅ 채널 인원수 UI 업데이트 헬퍼
function updateChannelMemberCountUI(channelId, count) {
  const el = document.querySelector(`.channel-member-count[data-channel-id="${channelId}"]`);
  if (el) {
    el.textContent = `${count}명`;
  }
}

// 사용자 데이터 로드
function loadUserData() {
  if (isRedirecting) return false;
  
  const userData = localStorage.getItem('userData');
  
  if (!userData) {
    isRedirecting = true;
    setTimeout(() => { window.location.href = 'login.html'; }, 100);
    return false;
  }
  
  try {
    currentUser = JSON.parse(userData);
    
    if (!currentUser.discordId || !currentUser.discordUsername || !currentUser.customNickname) {
      localStorage.removeItem('userData');
      isRedirecting = true;
      setTimeout(() => { window.location.href = 'login.html'; }, 100);
      return false;
    }
    
    // ✅ 총 관리자 표시
    if (isSuperAdmin()) {
      console.log('👑 총 관리자로 로그인됨');
    }
    
    updateUserProfile();
    return true;
  } catch (e) {
    localStorage.removeItem('userData');
    isRedirecting = true;
    setTimeout(() => { window.location.href = 'login.html'; }, 100);
    return false;
  }
}

// 사용자 프로필 업데이트
function updateUserProfile() {
  const profileName = document.getElementById('profileName');
  profileName.textContent = currentUser.customNickname || currentUser.discordUsername;
  
  // ✅ 총 관리자 뱃지
  if (isSuperAdmin()) {
    profileName.innerHTML += ' <span style="color: gold; font-size: 12px;">👑</span>';
  }
  
  const avatarImg = document.getElementById('profileAvatar');
  if (currentUser.avatar) {
    const extension = currentUser.avatar.startsWith('a_') ? 'gif' : 'png';
    avatarImg.src = `https://cdn.discordapp.com/avatars/${currentUser.discordId}/${currentUser.avatar}.${extension}?size=128`;
    avatarImg.onerror = () => {
      avatarImg.src = `https://cdn.discordapp.com/embed/avatars/${parseInt(currentUser.discordId) % 5}.png`;
    };
  } else {
    avatarImg.src = `https://cdn.discordapp.com/embed/avatars/${parseInt(currentUser.discordId) % 5}.png`;
  }
}

// UI 초기화
function initializeUI() {
  // 닫기 버튼
  document.getElementById('closeBtn').addEventListener('click', () => {
    ipcRenderer.send('close-window');
  });
  
  // 프로필 클릭
  document.getElementById('userProfile').addEventListener('click', openProfileModal);
  document.getElementById('closeProfileModal').addEventListener('click', closeProfileModal);
  
  // 닉네임 변경 버튼
  document.getElementById('editDiscordBtn').addEventListener('click', openNicknameModal);
  
  // 길드 변경 버튼
  document.getElementById('editGuildBtn').addEventListener('click', openGuildSelectModal);
  
  // 닉네임 모달 이벤트
  document.getElementById('closeNicknameModal').addEventListener('click', closeNicknameModal);
  document.getElementById('cancelNicknameBtn').addEventListener('click', closeNicknameModal);
  document.getElementById('confirmNicknameBtn').addEventListener('click', confirmNicknameChange);
  document.getElementById('newNicknameInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') confirmNicknameChange();
  });
  
  // 길드 선택 모달 이벤트
  document.getElementById('closeGuildSelectModal').addEventListener('click', closeGuildSelectModal);
  document.getElementById('cancelGuildSelectBtn').addEventListener('click', closeGuildSelectModal);
  document.getElementById('confirmGuildSelectBtn').addEventListener('click', confirmGuildSelect);
  
  // 로그아웃
  document.getElementById('logoutBtn').addEventListener('click', logout);
  
  // 길드 추가 버튼
  document.getElementById('addGuildBtn').addEventListener('click', openGuildModal);
  document.getElementById('closeGuildModal').addEventListener('click', closeGuildModal);
  document.getElementById('submitGuild').addEventListener('click', submitGuild);
  document.getElementById('guildLogo').addEventListener('change', handleGuildLogoUpload);
  
  // 채널 추가 버튼
  document.getElementById('addChannelBtn').addEventListener('click', openChannelModal);
  document.getElementById('closeChannelModal').addEventListener('click', closeChannelModal);
  document.getElementById('submitChannel').addEventListener('click', submitChannel);
  document.getElementById('channelLogo').addEventListener('change', handleChannelLogoUpload);
  
  // 삭제 확인 모달
  document.getElementById('closeDeleteModal').addEventListener('click', closeDeleteModal);
  document.getElementById('cancelDelete').addEventListener('click', closeDeleteModal);
  document.getElementById('confirmDelete').addEventListener('click', executeDelete);
  
  // 길드 상세 모달
  document.getElementById('closeGuildDetailModal').addEventListener('click', closeGuildDetailModal);
}

// ========== 프로필 관련 ==========

function openProfileModal() {
  document.getElementById('discordId').value = currentUser.discordId;
  document.getElementById('discordNickname').value = currentUser.customNickname;
  document.getElementById('userGuild').value = currentUser.guild || '없음';
  
  const profileDetailAvatar = document.getElementById('profileDetailAvatar');
  if (currentUser.avatar) {
    const extension = currentUser.avatar.startsWith('a_') ? 'gif' : 'png';
    profileDetailAvatar.src = `https://cdn.discordapp.com/avatars/${currentUser.discordId}/${currentUser.avatar}.${extension}?size=256`;
  } else {
    profileDetailAvatar.src = `https://cdn.discordapp.com/embed/avatars/${parseInt(currentUser.discordId) % 5}.png`;
  }
  
  document.getElementById('profileModal').style.display = 'flex';
}

function closeProfileModal() {
  document.getElementById('profileModal').style.display = 'none';
}

function openNicknameModal() {
  document.getElementById('newNicknameInput').value = currentUser.customNickname || '';
  document.getElementById('nicknameModal').style.display = 'flex';
  
  setTimeout(() => {
    document.getElementById('newNicknameInput').focus();
    document.getElementById('newNicknameInput').select();
  }, 100);
}

function closeNicknameModal() {
  document.getElementById('nicknameModal').style.display = 'none';
}

function confirmNicknameChange() {
  const newNickname = document.getElementById('newNicknameInput').value.trim();
  
  if (!newNickname) {
    alert('닉네임을 입력해주세요.');
    return;
  }
  
  if (newNickname === currentUser.customNickname) {
    closeNicknameModal();
    return;
  }
  
  currentUser.customNickname = newNickname;
  localStorage.setItem('userData', JSON.stringify(currentUser));
  
  document.getElementById('profileName').textContent = newNickname;
  if (isSuperAdmin()) {
    document.getElementById('profileName').innerHTML += ' <span style="color: gold; font-size: 12px;">👑</span>';
  }
  document.getElementById('discordNickname').value = newNickname;
  
  closeNicknameModal();
  alert('닉네임이 변경되었습니다!');
  
  fetch(`${API_BASE}/users/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ discordId: currentUser.discordId, customNickname: newNickname })
  }).catch(err => console.log('서버 동기화 실패:', err.message));
}

function openGuildSelectModal() {
  const guilds = JSON.parse(localStorage.getItem('guilds') || '[]');
  const guildSelectList = document.getElementById('guildSelectList');
  guildSelectList.innerHTML = '';
  
  selectedGuildIndex = null;
  
  // "없음" 옵션
  const noneItem = document.createElement('div');
  noneItem.className = 'guild-select-item';
  noneItem.dataset.index = '-1';
  noneItem.innerHTML = `
    <input type="radio" name="guildSelect" id="guildSelect_none" value="-1">
    <label for="guildSelect_none">
      <span class="guild-select-icon">❌</span>
      <span class="guild-select-name">없음 (길드 탈퇴)</span>
    </label>
  `;
  noneItem.addEventListener('click', () => selectGuildItem(-1));
  guildSelectList.appendChild(noneItem);
  
  if (!currentUser.guild || currentUser.guild === '없음') {
    noneItem.classList.add('selected');
    noneItem.querySelector('input').checked = true;
    selectedGuildIndex = -1;
  }
  
  guilds.forEach((guild, index) => {
    const item = document.createElement('div');
    item.className = 'guild-select-item';
    item.dataset.index = index;
    
    const shortName = guild.shortName || guild.short_name || guild.name;
    const shortNameColor = guild.shortNameColor || guild.short_name_color || '#667eea';
    const isCurrentGuild = currentUser.guild === shortName;
    
    if (isCurrentGuild) {
      item.classList.add('selected');
      selectedGuildIndex = index;
    }
    
    item.innerHTML = `
      <input type="radio" name="guildSelect" id="guildSelect_${index}" value="${index}" ${isCurrentGuild ? 'checked' : ''}>
      <label for="guildSelect_${index}">
        <span class="guild-select-icon">${guild.logo ? `<img src="${guild.logo}" alt="${shortName}">` : '🏰'}</span>
        <span class="guild-select-info">
          <span class="guild-select-short" style="color: ${shortNameColor};">[${shortName}]</span>
          <span class="guild-select-name">${guild.name}</span>
        </span>
      </label>
    `;
    item.addEventListener('click', () => selectGuildItem(index));
    guildSelectList.appendChild(item);
  });
  
  if (guilds.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.cssText = 'padding: 20px; text-align: center; color: #999;';
    emptyMsg.textContent = '등록된 길드가 없습니다.';
    guildSelectList.appendChild(emptyMsg);
  }
  
  document.getElementById('guildSelectModal').style.display = 'flex';
}

function selectGuildItem(index) {
  selectedGuildIndex = index;
  
  document.querySelectorAll('.guild-select-item').forEach(item => {
    item.classList.remove('selected');
    item.querySelector('input').checked = false;
  });
  
  const selectedItem = document.querySelector(`.guild-select-item[data-index="${index}"]`);
  if (selectedItem) {
    selectedItem.classList.add('selected');
    selectedItem.querySelector('input').checked = true;
  }
}

function closeGuildSelectModal() {
  document.getElementById('guildSelectModal').style.display = 'none';
  selectedGuildIndex = null;
}

function confirmGuildSelect() {
  if (selectedGuildIndex === null) {
    alert('길드를 선택해주세요.');
    return;
  }
  
  const guilds = JSON.parse(localStorage.getItem('guilds') || '[]');
  
  let guildShortName, guildShortNameColor, guildId;
  
  if (selectedGuildIndex === -1) {
    guildShortName = '없음';
    guildShortNameColor = '#ffffff';
    guildId = null;
  } else {
    const selectedGuild = guilds[selectedGuildIndex];
    guildShortName = selectedGuild.shortName || selectedGuild.short_name || selectedGuild.name;
    guildShortNameColor = selectedGuild.shortNameColor || selectedGuild.short_name_color || '#667eea';
    guildId = selectedGuild.id;
  }
  
  currentUser.guild = guildShortName;
  currentUser.guildColor = guildShortNameColor;
  currentUser.guildId = guildId;
  localStorage.setItem('userData', JSON.stringify(currentUser));
  
  document.getElementById('userGuild').value = guildShortName;
  
  closeGuildSelectModal();
  alert(`소속 길드가 [${guildShortName}](으)로 변경되었습니다!`);
  
  fetch(`${API_BASE}/users/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ discordId: currentUser.discordId, guildId: guildId })
  }).catch(err => console.log('서버 동기화 실패:', err.message));
}

// ========== 길드 관련 ==========

// ✅ 길드 로드 - 서버 우선, 정규화 적용
function loadGuilds() {
  // 먼저 서버에서 로드 시도
  fetch(`${API_BASE}/guilds`)
    .then(res => {
      if (!res.ok) throw new Error('서버 응답 오류');
      return res.json();
    })
    .then(serverGuilds => {
      // ✅ 서버 데이터를 정규화 (snake_case -> camelCase)
      const normalizedGuilds = (serverGuilds || []).map(sg => ({
        id: sg.id,
        shortName: sg.short_name || sg.shortName || '',
        shortNameColor: sg.short_name_color || sg.shortNameColor || '#667eea',
        name: sg.name,
        faction: sg.faction,
        recruitment: sg.recruitment,
        description: sg.description,
        contact: sg.contact,
        logo: sg.logo,
        owner_id: sg.owner_id
      }));
      
      localStorage.setItem('guilds', JSON.stringify(normalizedGuilds));
      renderGuilds(normalizedGuilds);
      console.log('✅ 서버에서 길드 로드 완료:', normalizedGuilds.length);
    })
    .catch(err => {
      console.log('⚠️ 서버 길드 로드 실패, 로컬 사용:', err.message);
      const localGuilds = JSON.parse(localStorage.getItem('guilds') || '[]');
      renderGuilds(localGuilds);
    });
}

function renderGuilds(guilds) {
  const guildList = document.getElementById('guildList');
  guildList.innerHTML = '';
  
  if (!guilds || guilds.length === 0) {
    guildList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">등록된 길드가 없습니다</div>';
    return;
  }
  
  guilds.forEach(guild => {
    guildList.appendChild(createGuildElement(guild));
  });
}

function createGuildElement(guild) {
  const item = document.createElement('div');
  item.className = 'guild-item';
  item.dataset.guildId = guild.id;
  
  const shortName = guild.shortName || guild.short_name || guild.name;
  const shortNameColor = guild.shortNameColor || guild.short_name_color || '#667eea';
  
  const icon = document.createElement('div');
  icon.className = 'guild-icon';
  if (guild.logo) {
    const img = document.createElement('img');
    img.src = guild.logo;
    img.onerror = () => { icon.textContent = (shortName || 'G')[0]; };
    icon.appendChild(img);
  } else {
    icon.textContent = (shortName || 'G')[0];
  }
  
  const info = document.createElement('div');
  info.className = 'guild-info';
  
  // ✅ 약어 색상 적용
  if (shortName) {
    const shortNameEl = document.createElement('div');
    shortNameEl.className = 'guild-short-name';
    shortNameEl.textContent = `[${shortName}]`;
    shortNameEl.style.color = shortNameColor;
    info.appendChild(shortNameEl);
  }
  
  const nameEl = document.createElement('div');
  nameEl.className = 'guild-name';
  nameEl.textContent = guild.name || '-';
  info.appendChild(nameEl);
  
  const factionEl = document.createElement('div');
  factionEl.className = 'guild-faction';
  factionEl.textContent = guild.faction || '-';
  info.appendChild(factionEl);
  
  const actions = document.createElement('div');
  actions.className = 'item-actions';
  
  // ✅ 총 관리자 또는 소유자만 수정/삭제 가능
  const isOwner = currentUser && String(guild.owner_id) === String(currentUser.discordId);
  const canManage = isOwner || isSuperAdmin();
  
  if (canManage) {
    const editBtn = document.createElement('button');
    editBtn.className = 'action-btn';
    editBtn.textContent = '✏️';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      editGuild(guild);
    });
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'action-btn delete';
    deleteBtn.textContent = '🗑️';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmDelete('guild', guild);
    });
    
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
  }
  
  item.appendChild(icon);
  item.appendChild(info);
  item.appendChild(actions);
  
  item.addEventListener('click', () => {
    document.querySelectorAll('.guild-item').forEach(el => el.classList.remove('active'));
    item.classList.add('active');
    openGuildDetailModal(guild);
  });
  
  return item;
}

function openGuildModal() {
  guildLogoData = null;
  
  document.getElementById('guildModalTitle').textContent = '길드 게시판 등록';
  document.getElementById('guildEditId').value = '';
  document.getElementById('guildShortName').value = '';
  document.getElementById('guildShortNameColor').value = '#667eea';
  document.getElementById('guildName').value = '';
  document.getElementById('guildFaction').value = '';
  document.getElementById('guildRecruitment').value = '모집중';
  document.getElementById('guildDescription').value = '';
  document.getElementById('guildContact').value = '';
  document.getElementById('guildLogo').value = '';
  
  const preview = document.getElementById('guildLogoPreview');
  if (preview) preview.style.display = 'none';
  
  document.getElementById('addGuildModal').style.display = 'flex';
  
  setTimeout(() => {
    document.getElementById('guildShortName').focus();
  }, 100);
}

function closeGuildModal() {
  document.getElementById('addGuildModal').style.display = 'none';
}

function handleGuildLogoUpload(event) {
  const file = event.target.files[0];
  if (!file) {
    guildLogoData = null;
    document.getElementById('guildLogoPreview').style.display = 'none';
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (e) => {
    guildLogoData = e.target.result;
    document.getElementById('guildLogoPreviewImg').src = guildLogoData;
    document.getElementById('guildLogoPreview').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

function submitGuild() {
  if (!currentUser) {
    alert('로그인이 필요합니다.');
    return;
  }
  
  const editId = document.getElementById('guildEditId').value;
  const shortName = document.getElementById('guildShortName').value.trim();
  const shortNameColor = document.getElementById('guildShortNameColor').value;
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
    shortNameColor, 
    name, 
    faction, 
    recruitment, 
    description, 
    contact, 
    logo: guildLogoData, 
    ownerId: currentUser.discordId 
  };
  
  const url = editId ? `${API_BASE}/guilds/${editId}` : `${API_BASE}/guilds`;
  const method = editId ? 'PUT' : 'POST';
  
  // ✅ 서버에 먼저 저장
  fetch(url, { 
    method, 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(guildData) 
  })
    .then(res => {
      if (!res.ok) throw new Error('서버 저장 실패');
      return res.json();
    })
    .then(result => {
      closeGuildModal();
      alert(editId ? '길드가 수정되었습니다!' : '길드가 등록되었습니다!');
      // ✅ 서버에서 새로 로드 (동기화 보장)
      loadGuilds();
    })
    .catch(err => {
      console.error('서버 저장 실패:', err);
      
      // ✅ 서버 실패 시 로컬에만 저장 (오프라인 모드)
      const guilds = JSON.parse(localStorage.getItem('guilds') || '[]');
      
      if (editId) {
        const index = guilds.findIndex(g => String(g.id) === String(editId));
        if (index > -1) {
          guilds[index] = { ...guilds[index], ...guildData };
        }
      } else {
        guilds.push({
          id: `local_${Date.now()}`,
          ...guildData,
          owner_id: currentUser.discordId,
          created_at: new Date().toISOString()
        });
      }
      
      localStorage.setItem('guilds', JSON.stringify(guilds));
      closeGuildModal();
      renderGuilds(guilds);
      alert((editId ? '길드가 수정되었습니다!' : '길드가 등록되었습니다!') + '\n(오프라인 - 나중에 동기화됩니다)');
    });
}

function editGuild(guild) {
  guildLogoData = guild.logo || null;
  
  const shortName = guild.shortName || guild.short_name || '';
  const shortNameColor = guild.shortNameColor || guild.short_name_color || '#667eea';
  
  document.getElementById('guildModalTitle').textContent = '길드 게시판 수정';
  document.getElementById('guildEditId').value = guild.id;
  document.getElementById('guildShortName').value = shortName;
  document.getElementById('guildShortNameColor').value = shortNameColor;
  document.getElementById('guildName').value = guild.name || '';
  document.getElementById('guildFaction').value = guild.faction || '';
  document.getElementById('guildRecruitment').value = guild.recruitment || '모집중';
  document.getElementById('guildDescription').value = guild.description || '';
  document.getElementById('guildContact').value = guild.contact || '';
  
  if (guild.logo) {
    document.getElementById('guildLogoPreviewImg').src = guild.logo;
    document.getElementById('guildLogoPreview').style.display = 'block';
  } else {
    document.getElementById('guildLogoPreview').style.display = 'none';
  }
  
  document.getElementById('addGuildModal').style.display = 'flex';
}

function openGuildDetailModal(guild) {
  const logoEl = document.getElementById('guildDetailLogo');
  logoEl.innerHTML = '';
  
  const shortName = guild.shortName || guild.short_name || '';
  const shortNameColor = guild.shortNameColor || guild.short_name_color || '#667eea';
  
  if (guild.logo) {
    const img = document.createElement('img');
    img.src = guild.logo;
    logoEl.appendChild(img);
  } else {
    logoEl.textContent = (shortName || guild.name || 'G')[0];
  }
  
  const shortEl = document.getElementById('guildDetailShort');
  shortEl.textContent = shortName || '';
  shortEl.style.color = shortNameColor;
  
  document.getElementById('guildDetailFull').textContent = guild.name || '-';
  document.getElementById('guildDetailFull').style.display = shortName ? 'block' : 'none';
  document.getElementById('guildDetailFaction').textContent = guild.faction || '-';
  document.getElementById('guildDetailRecruitment').textContent = guild.recruitment || '-';
  document.getElementById('guildDetailDescription').textContent = guild.description || '-';
  document.getElementById('guildDetailContact').textContent = guild.contact || '-';
  
  document.getElementById('guildDetailModal').style.display = 'flex';
}

function closeGuildDetailModal() {
  document.getElementById('guildDetailModal').style.display = 'none';
}

// ========== 채널 관련 ==========

// ✅ 채널 로드 - 서버 우선
function loadChannels() {
  fetch(`${API_BASE}/channels`)
    .then(res => {
      if (!res.ok) throw new Error('서버 응답 오류');
      return res.json();
    })
    .then(serverChannels => {
      localStorage.setItem('channels', JSON.stringify(serverChannels || []));
      renderChannels(serverChannels || []);
      console.log('✅ 서버에서 채널 로드 완료:', (serverChannels || []).length);
    })
    .catch(err => {
      console.log('⚠️ 서버 채널 로드 실패, 로컬 사용:', err.message);
      const localChannels = JSON.parse(localStorage.getItem('channels') || '[]');
      renderChannels(localChannels);
    });
}

function renderChannels(channels) {
  const channelList = document.getElementById('channelList');
  channelList.innerHTML = '';
  
  if (!channels || channels.length === 0) {
    channelList.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">등록된 채널이 없습니다</div>';
    return;
  }
  
  channels.forEach(channel => {
    channelList.appendChild(createChannelElement({
      id: channel.id,
      name: channel.name,
      hasPassword: channel.has_password === 1 || channel.hasPassword,
      logo: channel.logo,
      memberCount: channel.member_count || channel.memberCount || 0,
      ownerId: channel.owner_id || channel.ownerId
    }));
  });
}

function createChannelElement(channel) {
  const item = document.createElement('div');
  item.className = 'channel-item';
  item.dataset.channelId = channel.id;
  
  const icon = document.createElement('div');
  icon.className = 'channel-icon';
  if (channel.logo) {
    const img = document.createElement('img');
    img.src = channel.logo;
    img.onerror = () => { icon.textContent = '#'; };
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
    name.innerHTML += ' <span class="channel-lock">🔒</span>';
  }
  info.appendChild(name);
  
  const memberCount = document.createElement('div');
  memberCount.className = 'channel-member-count';
  memberCount.textContent = `${channel.memberCount}명`;
  memberCount.dataset.channelId = channel.id;
  info.appendChild(memberCount);
  
  const actions = document.createElement('div');
  actions.className = 'item-actions';
  
  // ✅ 총 관리자 또는 소유자만 수정/삭제 가능
  const isOwner = currentUser && String(channel.ownerId) === String(currentUser.discordId);
  const canManage = isOwner || isSuperAdmin();
  
  if (canManage) {
    const editBtn = document.createElement('button');
    editBtn.className = 'action-btn';
    editBtn.textContent = '✏️';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      editChannel(channel);
    });
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'action-btn delete';
    deleteBtn.textContent = '🗑️';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmDelete('channel', channel);
    });
    
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
  }
  
  item.appendChild(icon);
  item.appendChild(info);
  item.appendChild(actions);
  
  item.addEventListener('click', () => {
    if (channel.hasPassword) {
      joinPasswordProtectedChannel(channel);
    } else {
      joinChannel(channel);
    }
  });
  
  return item;
}

function openChannelModal() {
  channelLogoData = null;
  
  document.getElementById('channelModalTitle').textContent = '채팅 채널 등록';
  document.getElementById('channelEditId').value = '';
  document.getElementById('channelName').value = '';
  document.getElementById('channelPassword').value = '';
  document.getElementById('channelLogo').value = '';
  
  const preview = document.getElementById('channelLogoPreview');
  if (preview) preview.style.display = 'none';
  
  document.getElementById('addChannelModal').style.display = 'flex';
  
  setTimeout(() => {
    document.getElementById('channelName').focus();
  }, 100);
}

function closeChannelModal() {
  document.getElementById('addChannelModal').style.display = 'none';
}

function handleChannelLogoUpload(event) {
  const file = event.target.files[0];
  if (!file) {
    channelLogoData = null;
    document.getElementById('channelLogoPreview').style.display = 'none';
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (e) => {
    channelLogoData = e.target.result;
    document.getElementById('channelLogoPreviewImg').src = channelLogoData;
    document.getElementById('channelLogoPreview').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

function submitChannel() {
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
  
  const url = editId ? `${API_BASE}/channels/${editId}` : `${API_BASE}/channels`;
  const method = editId ? 'PUT' : 'POST';
  
  // ✅ 서버에 먼저 저장
  fetch(url, { 
    method, 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(channelData) 
  })
    .then(res => {
      if (!res.ok) throw new Error('서버 저장 실패');
      return res.json();
    })
    .then(result => {
      closeChannelModal();
      alert(editId ? '채널이 수정되었습니다!' : '채널이 등록되었습니다!');
      // ✅ 서버에서 새로 로드 (동기화 보장)
      loadChannels();
    })
    .catch(err => {
      console.error('서버 저장 실패:', err);
      
      // ✅ 서버 실패 시 로컬에만 저장 (오프라인 모드)
      const channels = JSON.parse(localStorage.getItem('channels') || '[]');
      
      if (editId) {
        const index = channels.findIndex(c => String(c.id) === String(editId));
        if (index > -1) {
          channels[index] = {
            ...channels[index],
            name,
            password: password || null,
            hasPassword: !!password,
            has_password: password ? 1 : 0,
            logo: channelLogoData || channels[index].logo
          };
        }
      } else {
        channels.push({
          id: `local_${Date.now()}`,
          name,
          password: password || null,
          hasPassword: !!password,
          has_password: password ? 1 : 0,
          logo: channelLogoData,
          owner_id: currentUser.discordId,
          memberCount: 0,
          member_count: 0,
          created_at: new Date().toISOString()
        });
      }
      
      localStorage.setItem('channels', JSON.stringify(channels));
      closeChannelModal();
      renderChannels(channels);
      alert((editId ? '채널이 수정되었습니다!' : '채널이 등록되었습니다!') + '\n(오프라인 - 나중에 동기화됩니다)');
    });
}

function editChannel(channel) {
  channelLogoData = channel.logo || null;
  
  document.getElementById('channelModalTitle').textContent = '채팅 채널 수정';
  document.getElementById('channelEditId').value = channel.id;
  document.getElementById('channelName').value = channel.name || '';
  document.getElementById('channelPassword').value = '';
  
  if (channel.logo) {
    document.getElementById('channelLogoPreviewImg').src = channel.logo;
    document.getElementById('channelLogoPreview').style.display = 'block';
  } else {
    document.getElementById('channelLogoPreview').style.display = 'none';
  }
  
  document.getElementById('addChannelModal').style.display = 'flex';
}

function joinPasswordProtectedChannel(channel) {
  const password = prompt(`🔒 비밀번호를 입력하세요 (채널: ${channel.name})`);
  if (!password) return;
  
  const channels = JSON.parse(localStorage.getItem('channels') || '[]');
  const localChannel = channels.find(c => String(c.id) === String(channel.id));
  
  if (localChannel && localChannel.password === password) {
    joinChannel(channel);
    return;
  }
  
  fetch(`${API_BASE}/channels/verify-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId: channel.id, password })
  })
    .then(res => res.json())
    .then(result => {
      if (result.success) joinChannel(channel);
      else alert('❌ 비밀번호가 틀렸습니다.');
    })
    .catch(() => alert('비밀번호 검증에 실패했습니다.'));
}

function joinChannel(channel) {
  // ✅ 현재 사용자의 길드 정보도 함께 전달
  const guilds = JSON.parse(localStorage.getItem('guilds') || '[]');
  const userGuild = guilds.find(g => 
    (g.shortName || g.short_name) === currentUser.guild || 
    g.name === currentUser.guild
  );
  
  const guildColor = userGuild 
    ? (userGuild.shortNameColor || userGuild.short_name_color || '#667eea')
    : '#667eea';
  
  ipcRenderer.send('open-chat-overlay', {
    id: channel.id,
    name: channel.name,
    isPrivate: channel.hasPassword,
    memberCount: channel.memberCount || 0,
    logo: channel.logo,
    ownerId: channel.ownerId,
    // ✅ 사용자 정보
    user: {
      discordId: currentUser.discordId,
      nickname: currentUser.customNickname,
      avatar: currentUser.avatar,
      guild: currentUser.guild,
      guildColor: guildColor,
      isSuperAdmin: isSuperAdmin()
    }
  });
  
  document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
  const channelItem = document.querySelector(`[data-channel-id="${channel.id}"]`);
  if (channelItem) channelItem.classList.add('active');
}

// ========== 삭제 관련 ==========

function confirmDelete(type, item) {
  pendingDeleteType = type;
  pendingDeleteItem = item;
  
  const message = type === 'guild' 
    ? `정말 [${item.name}] 길드를 삭제하시겠습니까?`
    : `정말 [${item.name}] 채널을 삭제하시겠습니까?`;
  
  document.getElementById('deleteConfirmMessage').textContent = message;
  document.getElementById('deleteConfirmModal').style.display = 'flex';
}

function executeDelete() {
  if (!pendingDeleteItem || !pendingDeleteType) {
    closeDeleteModal();
    return;
  }
  
  const type = pendingDeleteType;
  const item = pendingDeleteItem;
  
  closeDeleteModal();
  
  if (type === 'guild') deleteGuild(item.id);
  else if (type === 'channel') deleteChannel(item.id);
}

function closeDeleteModal() {
  document.getElementById('deleteConfirmModal').style.display = 'none';
  pendingDeleteItem = null;
  pendingDeleteType = null;
}

function deleteGuild(guildId) {
  // ✅ 서버에서 먼저 삭제 시도
  fetch(`${API_BASE}/guilds/${guildId}`, { method: 'DELETE' })
    .then(res => {
      if (!res.ok) throw new Error('서버 삭제 실패');
      return res.json();
    })
    .then(() => {
      alert('길드가 삭제되었습니다!');
      loadGuilds(); // 서버에서 새로 로드
    })
    .catch(err => {
      console.log('서버 삭제 실패, 로컬만 삭제:', err.message);
      
      const guilds = JSON.parse(localStorage.getItem('guilds') || '[]');
      const filtered = guilds.filter(g => String(g.id) !== String(guildId));
      localStorage.setItem('guilds', JSON.stringify(filtered));
      renderGuilds(filtered);
      alert('길드가 삭제되었습니다! (오프라인)');
    });
}

function deleteChannel(channelId) {
  // ✅ 서버에서 먼저 삭제 시도
  fetch(`${API_BASE}/channels/${channelId}`, { method: 'DELETE' })
    .then(res => {
      if (!res.ok) throw new Error('서버 삭제 실패');
      return res.json();
    })
    .then(() => {
      alert('채널이 삭제되었습니다!');
      loadChannels(); // 서버에서 새로 로드
    })
    .catch(err => {
      console.log('서버 삭제 실패, 로컬만 삭제:', err.message);
      
      const channels = JSON.parse(localStorage.getItem('channels') || '[]');
      const filtered = channels.filter(c => String(c.id) !== String(channelId));
      localStorage.setItem('channels', JSON.stringify(filtered));
      renderChannels(filtered);
      alert('채널이 삭제되었습니다! (오프라인)');
    });
}

// ========== 기타 ==========

function startMemberCountUpdate() {
  // ✅ 5초마다 업데이트
  memberCountUpdateInterval = setInterval(() => {
    fetch(`${API_BASE}/channels/member-counts`)
      .then(res => res.ok ? res.json() : [])
      .then(counts => {
        (counts || []).forEach(({ channelId, count }) => {
          updateChannelMemberCountUI(channelId, count);
        });
      })
      .catch(() => {});
  }, 5000);
  
  // 즉시 1회 실행
  fetch(`${API_BASE}/channels/member-counts`)
    .then(res => res.ok ? res.json() : [])
    .then(counts => {
      (counts || []).forEach(({ channelId, count }) => {
        updateChannelMemberCountUI(channelId, count);
      });
    })
    .catch(() => {});
}

function logout() {
  if (!confirm('로그아웃 하시겠습니까?')) return;
  
  localStorage.removeItem('userData');
  localStorage.removeItem('authToken');
  
  if (ws) ws.close();
  if (memberCountUpdateInterval) clearInterval(memberCountUpdateInterval);
  
  window.location.href = 'login.html';
}