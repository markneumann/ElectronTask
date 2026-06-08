import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  safeStorage,
  screen,
  session,
} from 'electron';
import Store from 'electron-store';
import path from 'node:path';
import started from 'electron-squirrel-startup';

if (started) {
  app.quit();
}

type AppStore = {
  encryptedToken?: string;
  defaultListId?: string;
};

type ClickUpTask = {
  id: string;
  name: string;
  status: string;
  listId: string | null;
  listName: string | null;
  dateUpdated: number;
};

type ClickUpStatus = {
  name: string;
  color: string | null;
};

type ClickUpTeam = {
  id: string;
  name: string;
};

type ClickUpSnapshot = {
  user: {
    id: string;
    username: string | null;
  };
  teams: ClickUpTeam[];
  tasks: ClickUpTask[];
  activeTask: ClickUpTask | null;
  activeTaskStatuses: ClickUpStatus[];
  source: 'team' | 'list';
  fetchedAt: string;
};

const CLICKUP_BASE_URL = 'https://api.clickup.com/api/v2';
const WINDOW_WIDTH = 320;
const WINDOW_HEIGHT = 170;
const TASKS_PAGE_LIMIT = 100;
const MAX_TASK_PAGES = 20;
const isDev = Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL);

const store = new Store<AppStore>({
  name: 'settings',
});

let widgetWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let sessionToken: string | null = null;

interface AuthProvider {
  currentAuthHeader(): Promise<string>;
}

class PersonalTokenProvider implements AuthProvider {
  async currentAuthHeader() {
    const token = getDecryptedToken();

    if (!token) {
      throw new Error('ClickUp token is not configured.');
    }

    return token;
  }
}

// Extension point for a future OAuthProvider. Do not implement OAuth in v1.
const authProvider: AuthProvider = new PersonalTokenProvider();

const trayIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <circle cx="16" cy="16" r="11" fill="#22c55e"/>
  <path d="M10 16.5 14.2 20.4 22.8 11.5" fill="none" stroke="#18181b" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
};

const asArray = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value;
};

const stringValue = (value: unknown) => {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  return null;
};

const trimString = (value: unknown) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
};

const getSafeStorageBackend = () => {
  if (typeof safeStorage.getSelectedStorageBackend !== 'function') {
    return 'unknown';
  }

  return safeStorage.getSelectedStorageBackend();
};

const canPersistToken = () =>
  safeStorage.isEncryptionAvailable() && getSafeStorageBackend() !== 'basic_text';

const getDecryptedToken = () => {
  if (sessionToken) {
    return sessionToken;
  }

  const encryptedToken = store.get('encryptedToken');

  if (!encryptedToken || !canPersistToken()) {
    return null;
  }

  return safeStorage.decryptString(Buffer.from(encryptedToken, 'base64'));
};

const getAuthStatus = () => ({
  hasToken: Boolean(sessionToken || store.get('encryptedToken')),
  canPersistToken: canPersistToken(),
  storageBackend: getSafeStorageBackend(),
  defaultListId: store.get('defaultListId') ?? null,
});

const saveToken = (payload: unknown) => {
  const data = asRecord(payload);
  const token = trimString(data.token);
  const defaultListId = trimString(data.defaultListId);
  const remember = data.remember !== false;

  if (!token) {
    throw new Error('A ClickUp personal token is required.');
  }

  if (defaultListId) {
    store.set('defaultListId', defaultListId);
  } else {
    store.delete('defaultListId');
  }

  if (!remember) {
    sessionToken = token;
    store.delete('encryptedToken');

    return getAuthStatus();
  }

  if (!canPersistToken()) {
    throw new Error(
      'This system is using Electron safeStorage basic_text mode, so the token was not saved. Disable remember token to use it for this session only.',
    );
  }

  const encryptedToken = safeStorage.encryptString(token).toString('base64');
  sessionToken = null;
  store.set('encryptedToken', encryptedToken);

  return getAuthStatus();
};

const clearToken = () => {
  sessionToken = null;
  store.delete('encryptedToken');

  return getAuthStatus();
};

const clickUpFetch = async (pathName: string, init?: RequestInit) => {
  const authorization = await authProvider.currentAuthHeader();
  const response = await fetch(`${CLICKUP_BASE_URL}${pathName}`, {
    ...init,
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    const detail = body ? `: ${body.slice(0, 180)}` : '';

    throw new Error(`ClickUp ${response.status} ${response.statusText}${detail}`);
  }

  return response.json() as Promise<unknown>;
};

const getCurrentUser = async () => {
  const body = asRecord(await clickUpFetch('/user'));
  const user = asRecord(body.user);
  const id = stringValue(user.id);

  if (!id) {
    throw new Error('ClickUp /user response did not include a user id.');
  }

  return {
    id,
    username: stringValue(user.username) ?? stringValue(user.email),
  };
};

const getTeams = async () => {
  const body = asRecord(await clickUpFetch('/team'));

  return asArray(body.teams)
    .map((team) => {
      const record = asRecord(team);
      const id = stringValue(record.id);

      if (!id) {
        return null;
      }

      return {
        id,
        name: stringValue(record.name) ?? 'Workspace',
      };
    })
    .filter((team): team is ClickUpTeam => Boolean(team));
};

const mapTask = (task: unknown): ClickUpTask | null => {
  const record = asRecord(task);
  const id = stringValue(record.id);
  const name = stringValue(record.name);

  if (!id || !name) {
    return null;
  }

  const status = asRecord(record.status);
  const list = asRecord(record.list);
  const dateUpdated = Number(stringValue(record.date_updated) ?? 0);

  return {
    id,
    name,
    status: stringValue(status.status) ?? 'Unknown',
    listId: stringValue(list.id),
    listName: stringValue(list.name),
    dateUpdated: Number.isFinite(dateUpdated) ? dateUpdated : 0,
  };
};

const getPagedTasks = async (pathName: string, params: URLSearchParams) => {
  const tasks: ClickUpTask[] = [];

  for (let page = 0; page < MAX_TASK_PAGES; page += 1) {
    params.set('page', String(page));
    const body = asRecord(await clickUpFetch(`${pathName}?${params.toString()}`));
    const pageTasks = asArray(body.tasks)
      .map(mapTask)
      .filter((task): task is ClickUpTask => Boolean(task));

    tasks.push(...pageTasks);

    if (pageTasks.length < TASKS_PAGE_LIMIT) {
      break;
    }
  }

  return tasks;
};

const getTasksFromList = async (listId: string, userId: string) => {
  const params = new URLSearchParams({
    include_closed: 'false',
    order_by: 'updated',
    reverse: 'true',
  });
  params.append('assignees[]', userId);

  return getPagedTasks(`/list/${encodeURIComponent(listId)}/task`, params);
};

const getTasksFromTeams = async (teams: ClickUpTeam[], userId: string) => {
  const taskGroups = await Promise.all(
    teams.map((team) => {
      const params = new URLSearchParams({
        include_closed: 'false',
        order_by: 'updated',
        reverse: 'true',
      });
      params.append('assignees[]', userId);

      return getPagedTasks(`/team/${encodeURIComponent(team.id)}/task`, params);
    }),
  );

  return taskGroups.flat();
};

const getListStatuses = async (listId: string) => {
  const body = asRecord(await clickUpFetch(`/list/${encodeURIComponent(listId)}`));
  const statuses = asArray(body.statuses)
    .map((status) => {
      const record = asRecord(status);
      const name = stringValue(record.status);

      if (!name) {
        return null;
      }

      return {
        name,
        color: stringValue(record.color),
      };
    })
    .filter((status): status is ClickUpStatus => Boolean(status));

  if (statuses.length === 0) {
    throw new Error(`No statuses were returned for ClickUp list ${listId}.`);
  }

  return statuses;
};

const getMyTasks = async (): Promise<ClickUpSnapshot> => {
  const user = await getCurrentUser();
  const teams = await getTeams();
  const defaultListId = store.get('defaultListId');
  const source = defaultListId ? 'list' : 'team';
  const tasks = defaultListId
    ? await getTasksFromList(defaultListId, user.id)
    : await getTasksFromTeams(teams, user.id);
  const sortedTasks = tasks.sort((left, right) => right.dateUpdated - left.dateUpdated);
  const activeTask = sortedTasks[0] ?? null;
  const activeTaskStatuses = activeTask?.listId
    ? await getListStatuses(activeTask.listId)
    : [];

  return {
    user,
    teams,
    tasks: sortedTasks,
    activeTask,
    activeTaskStatuses,
    source,
    fetchedAt: new Date().toISOString(),
  };
};

const setTaskStatus = async (payload: unknown) => {
  const data = asRecord(payload);
  const taskId = trimString(data.taskId);
  const listId = trimString(data.listId);
  const statusName = trimString(data.status);

  if (!taskId || !listId || !statusName) {
    throw new Error('Task id, list id, and status are required.');
  }

  const statuses = await getListStatuses(listId);
  const requestedStatus = statuses.find((status) => status.name === statusName);

  if (!requestedStatus) {
    throw new Error(`"${statusName}" is not a valid status for list ${listId}.`);
  }

  await clickUpFetch(`/task/${encodeURIComponent(taskId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      status: requestedStatus.name,
    }),
  });

  return {
    taskId,
    status: requestedStatus.name,
  };
};

const createTrayIcon = () => {
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(trayIconSvg)}`,
  );
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

  if (isDev) {
    widgetWindow.center();
    widgetWindow.show();
    widgetWindow.focus();
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

  if (isDev) {
    widgetWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    widgetWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (!isDev) {
    widgetWindow.on('blur', () => {
      hideWidget();
    });
  }

  widgetWindow.on('closed', () => {
    widgetWindow = null;
  });

  if (isDev) {
    widgetWindow.webContents.once('did-finish-load', () => {
      showWidget();
    });
  }
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
ipcMain.handle('auth:getStatus', getAuthStatus);
ipcMain.handle('auth:saveToken', (_event, payload) => saveToken(payload));
ipcMain.handle('auth:clearToken', clearToken);
ipcMain.handle('clickup:getMyTasks', getMyTasks);
ipcMain.handle('clickup:setStatus', (_event, payload) => setTaskStatus(payload));

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
