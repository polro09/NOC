const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

let mainWindow;
let chatOverlayWindow = null;
let isClickThrough = false;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  mainWindow = new BrowserWindow({
    width: 550,
    height: 700,
    x: Math.floor((width - 550) / 2),
    y: Math.floor((height - 700) / 2),
    transparent: false,
    frame: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: true, // 크기 조절 가능하도록 변경
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: false,
      sandbox: false,
      webSecurity: false
    }
  });

  mainWindow.loadFile('overlay/login.html');
  
  // 위치 강제 이동 코드 완전 제거
  // 사용자가 원하는 위치에 자유롭게 배치 가능
  
  // 개발 중에만 개발자 도구 열기
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
  
  // 보안 경고 무시 (개발 환경)
  mainWindow.webContents.on('console-message', (event, level, message) => {
    if (message.includes('Electron Security Warning')) {
      event.preventDefault();
    }
  });
}

// 클릭 무시 모드 토글
ipcMain.on('toggle-click-through', (event) => {
  isClickThrough = !isClickThrough;
  mainWindow.setIgnoreMouseEvents(isClickThrough, { forward: true });
  event.reply('click-through-status', isClickThrough);
});

// 창 최소화
ipcMain.on('minimize-window', () => {
  mainWindow.minimize();
});

// 창 닫기
ipcMain.on('close-window', () => {
  app.quit();
});

// 채팅 오버레이 창 열기
ipcMain.on('open-chat-overlay', (event, channelData) => {
  if (!chatOverlayWindow) {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    
    chatOverlayWindow = new BrowserWindow({
      width: 450,
      height: 600,
      x: width - 470,
      y: 20,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: false,
      resizable: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: false,
        sandbox: false,
        webSecurity: false
      }
    });
    
    chatOverlayWindow.loadFile('overlay/chat-overlay.html');
    
    chatOverlayWindow.on('closed', () => {
      chatOverlayWindow = null;
    });
    
    // 창이 로드되면 채널 데이터 전송
    chatOverlayWindow.webContents.on('did-finish-load', () => {
      chatOverlayWindow.webContents.send('load-channel', channelData);
    });
    
    // 보안 경고 무시 (개발 환경)
    chatOverlayWindow.webContents.on('console-message', (event, level, message) => {
      if (message.includes('Electron Security Warning')) {
        event.preventDefault();
      }
    });
  } else {
    // 이미 열려있으면 채널 추가
    chatOverlayWindow.webContents.send('load-channel', channelData);
    chatOverlayWindow.focus();
  }
});

// 채팅 오버레이 창 닫기
ipcMain.on('close-chat-overlay', () => {
  if (chatOverlayWindow) {
    chatOverlayWindow.close();
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 보안 경고 무시 설정
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';