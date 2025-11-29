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
    resizable: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('overlay/login.html');
  
  // 메인 페이지 로드 시 오버레이 모드로 전환
  mainWindow.webContents.on('did-finish-load', () => {
    const currentURL = mainWindow.webContents.getURL();
    if (currentURL.includes('index.html')) {
      // 오버레이 모드로 전환
      mainWindow.setSize(400, 600);
      mainWindow.setPosition(width - 420, 20);
      mainWindow.setAlwaysOnTop(true);
      mainWindow.setResizable(true);
    }
  });
  
  // 개발자 도구 자동 열기 (디버깅용)
  mainWindow.webContents.openDevTools({ mode: 'detach' });
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
        contextIsolation: false
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
