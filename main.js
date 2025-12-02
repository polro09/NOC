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
    resizable: true,
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
  
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
  
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
    
    // ✅ 항상 최상단 유지 강제
    chatOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
    
    // ✅ 포커스 잃어도 최상단 유지
    chatOverlayWindow.on('blur', () => {
      if (chatOverlayWindow && !chatOverlayWindow.isDestroyed()) {
        chatOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
      }
    });
    
    chatOverlayWindow.on('closed', () => {
      chatOverlayWindow = null;
    });
    
    chatOverlayWindow.webContents.on('did-finish-load', () => {
      chatOverlayWindow.webContents.send('load-channel', channelData);
    });
    
    chatOverlayWindow.webContents.on('console-message', (event, level, message) => {
      if (message.includes('Electron Security Warning')) {
        event.preventDefault();
      }
    });
  } else {
    chatOverlayWindow.webContents.send('load-channel', channelData);
    chatOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
    chatOverlayWindow.focus();
  }
});

// 채팅 오버레이 창 닫기
ipcMain.on('close-chat-overlay', () => {
  if (chatOverlayWindow) {
    chatOverlayWindow.close();
  }
});

// ✅ 채널 인원수 업데이트 (채팅창 → 메인창)
ipcMain.on('update-channel-member-count', (event, data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('channel-member-count-updated', data);
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

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';