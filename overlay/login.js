const { ipcRenderer, shell } = require('electron');
const { DISCORD_CONFIG, API_BASE } = require('../config');

console.log('🔐 로그인 페이지 로드됨');

// 페이지 리다이렉트 플래그 (무한 루프 방지)
let isRedirecting = false;
let isCheckingAuth = false;

// 페이지 로드 시 이미 로그인되어 있는지 확인
document.addEventListener('DOMContentLoaded', () => {
  console.log('📋 DOMContentLoaded - 로그인 상태 확인 중...');
  
  // 이미 체크 중이면 중단
  if (isCheckingAuth || isRedirecting) {
    console.log('⏳ 이미 인증 체크 중이거나 리다이렉트 중...');
    return;
  }
  
  isCheckingAuth = true;
  
  const userData = localStorage.getItem('userData');
  console.log('📊 localStorage userData:', userData ? '존재함' : '없음');
  
  if (userData) {
    try {
      const user = JSON.parse(userData);
      console.log('✅ 유효한 사용자 데이터 발견:', user.discordUsername);
      
      // 필수 필드 검증
      if (user.discordId && user.discordUsername && user.customNickname) {
        console.log('🔄 index.html로 리다이렉트');
        isRedirecting = true;
        
        // 약간의 지연 후 리다이렉트 (DOM 준비 보장)
        setTimeout(() => {
          window.location.href = 'index.html';
        }, 100);
        return;
      } else {
        console.log('⚠️ 사용자 데이터 불완전 - 로그인 필요');
        localStorage.removeItem('userData');
      }
    } catch (e) {
      console.error('❌ userData 파싱 오류:', e);
      console.log('🗑️ 손상된 userData 제거');
      localStorage.removeItem('userData');
    }
  } else {
    console.log('ℹ️ 로그인되지 않음 - 로그인 페이지 유지');
  }
  
  isCheckingAuth = false;
  
  // UI 이벤트 리스너 등록
  initializeUI();
});

// UI 초기화
function initializeUI() {
  // 창 닫기 버튼
  document.getElementById('loginCloseBtn').addEventListener('click', () => {
    ipcRenderer.send('close-window');
  });

  // 디스코드 로그인 버튼
  document.getElementById('discordLoginBtn').addEventListener('click', async () => {
    startDiscordOAuth();
  });

  // localStorage 초기화 버튼 (문제 해결용)
  document.getElementById('clearStorageBtn').addEventListener('click', () => {
    console.log('🗑️ localStorage 초기화 버튼 클릭');
    
    if (confirm('모든 로그인 정보가 삭제됩니다. 계속하시겠습니까?')) {
      localStorage.clear();
      sessionStorage.clear();
      console.log('✅ localStorage/sessionStorage 초기화 완료');
      alert('초기화 완료! 페이지를 새로고침합니다.');
      location.reload();
    }
  });

  // 프로필 제출 버튼
  document.getElementById('submitProfile').addEventListener('click', async () => {
    await submitProfile();
  });

  // 엔터키로 완료
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
  
  // 외부 브라우저에서 인증 진행
  shell.openExternal(authUrl);
  
  // UI 상태 변경
  showLoadingState();
  
  // 콜백 대기
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
  
  // 체크 마크로 변경
  spinner.style.display = 'none';
  btnText.textContent = '✓ 로그인 성공!';
  btn.style.background = '#10b981';
  
  // 1초 후 프로필 설정으로 이동
  setTimeout(() => {
    showProfileSettings(discordUser);
  }, 1000);
}

// 인증 콜백 대기
function waitForAuthCallback() {
  let checkCount = 0;
  
  authCheckInterval = setInterval(async () => {
    try {
      checkCount++;
      console.log(`인증 확인 시도 ${checkCount}회`);
      
      // 최근 세션 조회
      const response = await fetch(`${API_BASE}/auth/check?latest=true`);
      
      console.log('인증 확인 응답:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        console.log('인증 데이터:', data);
        
        if (data.authenticated && data.sessionId) {
          // 세션 ID 저장
          localStorage.setItem('sessionId', data.sessionId);
          
          clearInterval(authCheckInterval);
          authCheckInterval = null;
          handleAuthSuccess(data.user);
        } else {
          console.log('세션 대기 중... (아직 인증 안됨)');
        }
      } else {
        const errorText = await response.text();
        console.log('인증 실패:', errorText);
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

// 프로필 설정 표시
function showProfileSettings(discordUser) {
  // 로그인 버튼 숨기기
  document.getElementById('discordLoginBtn').style.display = 'none';
  
  // 프로필 설정 표시
  document.getElementById('profileSettings').style.display = 'block';
  
  // 닉네임 입력 필드에 Discord 닉네임 기본값 설정
  const defaultNickname = discordUser.global_name || discordUser.username;
  document.getElementById('nicknameInput').value = defaultNickname;
  document.getElementById('nicknameInput').focus();
  
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
    console.log('📡 프로필 업데이트 요청:', userData);
    
    // 서버로 사용자 정보 전송
    const response = await fetch(`${API_BASE}/users/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(userData)
    });
    
    console.log('📡 서버 응답 상태:', response.status);
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ 서버 응답 데이터:', result);
      console.log('💾 저장할 사용자 데이터:', result.user);
      
      // 로컬 스토리지에 저장
      localStorage.setItem('userData', JSON.stringify(result.user));
      localStorage.setItem('authToken', result.token);
      
      console.log('✅ localStorage에 저장 완료');
      console.log('📊 저장된 userData:', localStorage.getItem('userData'));
      
      // 메인 화면으로 이동
      console.log('🔄 index.html로 이동...');
      isRedirecting = true;
      
      // 약간의 지연 후 리다이렉트
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 100);
    } else {
      const errorText = await response.text();
      console.error('❌ 서버 응답 오류:', response.status, errorText);
      alert('프로필 저장에 실패했습니다.');
    }
  } catch (error) {
    console.error('❌ 프로필 저장 오류:', error);
    alert('프로필 저장 중 오류가 발생했습니다.');
  }
}