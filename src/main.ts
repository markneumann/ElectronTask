import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  screen,
  session,
} from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

if (started) {
  app.quit();
}

const WINDOW_WIDTH = 320;
const WINDOW_HEIGHT = 170;

let widgetWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const trayIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="#171717"/>
  <path d="M9 17.5 13.2 22 23 10" fill="none" stroke="#f8fafc" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const createTrayIcon = () => {
  const icon = nativeImage.createFromDataURL(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(trayIconSvg)}`,
  );

  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }

  return icon;
};

const applyContentSecurityPolicy = () => {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
};

const getWidgetPosition = () => {
  if (!tray) {
    const display = screen.getPrimaryDisplay().workArea;

    return {
      x: display.x + display.width - WINDOW_WIDTH - 16,
      y: display.y + 16,
    };
  }

  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: Math.round(trayBounds.x + trayBounds.width / 2),
    y: Math.round(trayBounds.y + trayBounds.height / 2),
  }).workArea;

  const centeredX = Math.round(
    trayBounds.x + trayBounds.width / 2 - WINDOW_WIDTH / 2,
  );
  const x = Math.min(
    Math.max(centeredX, display.x + 8),
    display.x + display.width - WINDOW_WIDTH - 8,
  );

  const opensDown = trayBounds.y < display.y + display.height / 2;
  const y = opensDown
    ? trayBounds.y + trayBounds.height + 8
    : trayBounds.y - WINDOW_HEIGHT - 8;

  return {
    x,
    y: Math.min(
      Math.max(Math.round(y), display.y + 8),
      display.y + display.height - WINDOW_HEIGHT - 8,
    ),
  };
};

const showWidget = () => {
  if (!widgetWindow) {
    return;
  }

  widgetWindow.setBounds({
    ...getWidgetPosition(),
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
  });
  widgetWindow.showInactive();
};

const hideWidget = () => {
  widgetWindow?.hide();
};

const toggleWidget = () => {
  if (widgetWindow?.isVisible()) {
    hideWidget();
    return;
  }

  showWidget();
};

const createWidgetWindow = () => {
  widgetWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  widgetWindow.setAlwaysOnTop(true, 'floating');
  widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    widgetWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    widgetWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  widgetWindow.on('blur', () => {
    hideWidget();
  });

  widgetWindow.on('closed', () => {
    widgetWindow = null;
  });
};

const createTray = () => {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('ClickUp Status Widget');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Toggle Widget', click: toggleWidget },
      { type: 'separator' },
      { label: 'Quit', role: 'quit' },
    ]),
  );
  tray.on('click', toggleWidget);
};

ipcMain.handle('widget:ping', () => ({
  ok: true,
  message: 'main process reachable',
}));

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock?.hide();
  }

  applyContentSecurityPolicy();
  createWidgetWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // Keep the tray utility alive until the user quits from the tray menu.
});

app.on('activate', () => {
  if (!widgetWindow) {
    createWidgetWindow();
  }
});
