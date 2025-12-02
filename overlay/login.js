const { ipcRenderer, shell } = require('electron');
const { DISCORD_CONFIG, API_BASE } = require('../config');

console.log('🔐 로그인 페이지 로드됨');

// 페이지 리다이렉트 플래그 (무한 루프 방지)
let isRedirecting = false;
let isCheckingAuth = false;

// 페이지 로드 시 이미 로그인되어 있는지 확인
document.addEventListener('DOMContentLoaded', () => {
  console.log('📋 DOMContentLoaded - 로그인 상태 확인 중...');
  
  if (isCheckingAuth || isRedirecting) {
    return;
  }
  
  isCheckingAuth = true;
  
  const userData = localStorage.getItem('userData');
  
  if (userData) {
    try {
      const user = JSON.parse(userData);
      
      if (user.discordId && user.discordUsername && user.customNickname) {
        console.log('🔄 index.html로 리다이렉트');
        isRedirecting = true;
        setTimeout(() => { window.location.href = 'index.html'; }, 100);
        return;
      } else {
        localStorage.removeItem('userData');
      }
    } catch (e) {
      localStorage.removeItem('userData');
    }
  }
  
  isCheckingAuth = false;
  initializeUI();
});

// UI 초기화
function initializeUI() {
  document.getElementById('loginCloseBtn').addEventListener('click', () => {
    ipcRenderer.send('close-window');
  });

  document.getElementById('discordLoginBtn').addEventListener('click', () => {
    startDiscordOAuth();
  });

  document.getElementById('clearStorageBtn').addEventListener('click', () => {
    if (confirm('모든 로그인 정보가 삭제됩니다. 계속하시겠습니까?')) {
      localStorage.clear();
      sessionStorage.clear();
      alert('초기화 완료! 페이지를 새로고침합니다.');
      location.reload();
    }
  });

  document.getElementById('submitProfile').addEventListener('click', () => {
    submitProfile();
  });

  document.getElementById('nicknameInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('submitProfile').click();
    }
  });
}

// Discord OAuth 상태 저장
let authCheckInterval = null;

// Discord OAuth 시작
function startDiscordOAuth() {
  const state = generateRandomState();
  localStorage.setItem('oauth_state', state);
  
  const authParams = new URLSearchParams({
    client_id: DISCORD_CONFIG.clientId,
    redirect_uri: DISCORD_CONFIG.redirectUri,
    response_type: 'code',
    scope: DISCORD_CONFIG.scopes.join(' '),
    state: state
  });
  
  const authUrl = `${DISCORD_CONFIG.authUrl}?${authParams.toString()}`;
  
  shell.openExternal(authUrl);
  showLoadingState();
  waitForAuthCallback();
}

// 로딩 상태 표시
function showLoadingState() {
  const btn = document.getElementById('discordLoginBtn');
  const spinner = document.getElementById('loginSpinner');
  const btnText = document.getElementById('loginBtnText');
  
  btn.disabled = true;
  btnText.textContent = '로그인 처리중...';
  spinner.style.display = 'inline-block';
}

// 로그인 상태 리셋
function resetLoginState() {
  const btn = document.getElementById('discordLoginBtn');
  const spinner = document.getElementById('loginSpinner');
  const btnText = document.getElementById('loginBtnText');
  
  btn.disabled = false;
  btnText.textContent = '디스코드 로그인';
  spinner.style.display = 'none';
}

// 인증 성공 처리
function handleAuthSuccess(discordUser) {
  const btn = document.getElementById('discordLoginBtn');
  const spinner = document.getElementById('loginSpinner');
  const btnText = document.getElementById('loginBtnText');
  
  spinner.style.display = 'none';
  btnText.textContent = '✓ 로그인 성공!';
  btn.style.background = '#10b981';
  
  setTimeout(() => {
    showProfileSettings(discordUser);
  }, 800);
}

// 인증 콜백 대기
function waitForAuthCallback() {
  let checkCount = 0;
  
  authCheckInterval = setInterval(async () => {
    try {
      checkCount++;
      
      const response = await fetch(`${API_BASE}/auth/check?latest=true`);
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.authenticated && data.sessionId) {
          localStorage.setItem('sessionId', data.sessionId);
          clearInterval(authCheckInterval);
          authCheckInterval = null;
          handleAuthSuccess(data.user);
        }
      }
    } catch (error) {
      console.error('인증 확인 오류:', error);
    }
  }, 2000);
  
  // 5분 후 타임아웃
  setTimeout(() => {
    if (authCheckInterval) {
      clearInterval(authCheckInterval);
      authCheckInterval = null;
      resetLoginState();
      alert('로그인 시간이 만료되었습니다. 다시 시도해주세요.');
    }
  }, 300000);
}

// 랜덤 상태 생성
function generateRandomState() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// ✅ 프로필 설정 표시 (레이아웃 개선)
function showProfileSettings(discordUser) {
  // ✅ 로그인 버튼 및 상단 영역 숨기기
  document.getElementById('discordLoginBtn').style.display = 'none';
  document.querySelector('.app-description').style.display = 'none';
  document.querySelector('.login-box').style.display = 'none';
  document.getElementById('clearStorageBtn').parentElement.style.display = 'none';
  
  // ✅ 컨테이너에 프로필 모드 클래스 추가
  document.getElementById('loginContainer').classList.add('profile-mode');
  
  // 프로필 설정 표시
  document.getElementById('profileSettings').style.display = 'block';
  
  // 닉네임 기본값 설정
  const defaultNickname = discordUser.global_name || discordUser.username;
  document.getElementById('nicknameInput').value = defaultNickname;
  document.getElementById('nicknameInput').focus();
  document.getElementById('nicknameInput').select();
  
  // 사용자 정보 임시 저장
  window.tempUserData = {
    discordId: discordUser.id,
    discordUsername: discordUser.username,
    discordGlobalName: discordUser.global_name,
    avatar: discordUser.avatar,
    email: discordUser.email
  };
}

// 프로필 완료
async function submitProfile() {
  const nickname = document.getElementById('nicknameInput').value.trim();
  
  if (!nickname) {
    alert('닉네임을 입력해주세요.');
    return;
  }
  
  const userData = {
    ...window.tempUserData,
    customNickname: nickname
  };
  
  try {
    const response = await fetch(`${API_BASE}/users/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(userData)
    });
    
    if (response.ok) {
      const result = await response.json();
      
      localStorage.setItem('userData', JSON.stringify(result.user));
      localStorage.setItem('authToken', result.token);
      
      isRedirecting = true;
      setTimeout(() => { window.location.href = 'index.html'; }, 100);
    } else {
      alert('프로필 저장에 실패했습니다.');
    }
  } catch (error) {
    console.error('프로필 저장 오류:', error);
    
    // 폴백: 로컬에만 저장
    localStorage.setItem('userData', JSON.stringify(userData));
    isRedirecting = true;
    setTimeout(() => { window.location.href = 'index.html'; }, 100);
  }
}