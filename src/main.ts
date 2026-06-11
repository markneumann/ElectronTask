import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  globalShortcut,
  ipcMain,
  nativeImage,
  safeStorage,
  screen,
  session,
  shell,
} from 'electron';
import Store from 'electron-store';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import started from 'electron-squirrel-startup';

if (started) {
  app.quit();
}

type AppStore = {
  encryptedToken?: string;
  defaultListId?: string;
  activeTaskId?: string;
  isPaused?: boolean;
  hotkey?: string;
  launchAtLogin?: boolean;
  appearance?: AppearanceTheme;
  snapPosition?: SnapPosition;
};

type ClickUpTask = {
  id: string;
  name: string;
  status: string;
  teamId: string | null;
  listId: string | null;
  listName: string | null;
  dateUpdated: number;
  timeTrackedMs: number;
};

type ClickUpStatus = {
  name: string;
  color: string | null;
};

type ClickUpTeam = {
  id: string;
  name: string;
};

type AppearanceTheme = 'black' | 'white' | 'bright';
type SnapPosition = 'top' | 'bottom';

type ClickUpSnapshot = {
  user: {
    id: string;
    username: string | null;
  };
  teams: ClickUpTeam[];
  tasks: ClickUpTask[];
  activeTask: ClickUpTask | null;
  activeTaskStatuses: ClickUpStatus[];
  activeTaskId: string | null;
  isPaused: boolean;
  isEmpty: boolean;
  source: 'team' | 'list';
  fetchedAt: string;
};

const CLICKUP_BASE_URL = 'https://api.clickup.com/api/v2';
const WINDOW_WIDTH = 1260;
const WINDOW_HEIGHT = 30;
const DEV_WINDOW_HEIGHT = WINDOW_HEIGHT;
const TASKS_PAGE_LIMIT = 100;
const MAX_TASK_PAGES = 20;
const MAX_FETCH_ATTEMPTS = 3;
const DEFAULT_HOTKEY = 'CommandOrControl+Shift+K';
const HOTKEY_OPTIONS = [
  DEFAULT_HOTKEY,
  'CommandOrControl+Shift+Space',
  'CommandOrControl+Alt+C',
  'Alt+Shift+C',
] as const;
const APPEARANCE_THEMES = ['black', 'white', 'bright'] as const;
const SNAP_POSITIONS = ['top', 'bottom'] as const;
const isDev = Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL);

const store = new Store<AppStore>({
  name: 'settings',
});

let widgetWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let sessionToken: string | null = null;
let registeredHotkey: string | null = null;
let hotkeyError: string | null = null;

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

  try {
    const token = safeStorage.decryptString(Buffer.from(encryptedToken, 'base64'));
    sessionToken = token;

    return token;
  } catch {
    return null;
  }
};

const getAuthStatus = () => ({
  hasToken: Boolean(getDecryptedToken()),
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
  sessionToken = token;
  store.set('encryptedToken', encryptedToken);

  return getAuthStatus();
};

const clearToken = () => {
  sessionToken = null;
  store.delete('encryptedToken');

  return getAuthStatus();
};

const setDefaultListId = (payload: unknown) => {
  const data = asRecord(payload);
  const defaultListId = trimString(data.defaultListId);

  if (defaultListId) {
    store.set('defaultListId', defaultListId);
  } else {
    store.delete('defaultListId');
  }

  store.delete('activeTaskId');
  store.set('isPaused', false);

  return getAuthStatus();
};

const delay = (milliseconds: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const isRetryableStatus = (status: number) =>
  status === 429 || status === 408 || status >= 500;

const clickUpFetch = async (pathName: string, init?: RequestInit) => {
  const authorization = await authProvider.currentAuthHeader();

  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${CLICKUP_BASE_URL}${pathName}`, {
        ...init,
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
      });

      if (response.ok) {
        const text = await response.text();

        return text ? (JSON.parse(text) as unknown) : {};
      }

      const body = await response.text();
      const detail = body ? `: ${body.slice(0, 180)}` : '';

      if (isRetryableStatus(response.status) && attempt < MAX_FETCH_ATTEMPTS - 1) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : 500 * 2 ** attempt;

        await delay(waitMs);
        continue;
      }

      throw new Error(`ClickUp ${response.status} ${response.statusText}${detail}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('ClickUp ')) {
        throw error;
      }

      if (attempt < MAX_FETCH_ATTEMPTS - 1) {
        await delay(500 * 2 ** attempt);
        continue;
      }

      if (error instanceof TypeError) {
        throw new Error('Network unavailable. Check your connection and retry.');
      }

      throw error;
    }
  }

  throw new Error('ClickUp request failed after retries.');
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

const mapTask = (task: unknown, fallbackTeamId: string | null = null): ClickUpTask | null => {
  const record = asRecord(task);
  const id = stringValue(record.id);
  const name = stringValue(record.name);

  if (!id || !name) {
    return null;
  }

  const status = asRecord(record.status);
  const list = asRecord(record.list);
  const dateUpdated = Number(stringValue(record.date_updated) ?? 0);
  const timeTrackedMs = Number(stringValue(record.time_spent) ?? record.time_spent ?? 0);

  return {
    id,
    name,
    status: stringValue(status.status) ?? 'Unknown',
    teamId: stringValue(record.team_id) ?? fallbackTeamId,
    listId: stringValue(list.id),
    listName: stringValue(list.name),
    dateUpdated: Number.isFinite(dateUpdated) ? dateUpdated : 0,
    timeTrackedMs: Number.isFinite(timeTrackedMs) ? timeTrackedMs : 0,
  };
};

const getPagedTasks = async (
  pathName: string,
  params: URLSearchParams,
  fallbackTeamId: string | null = null,
) => {
  const tasks: ClickUpTask[] = [];

  for (let page = 0; page < MAX_TASK_PAGES; page += 1) {
    params.set('page', String(page));
    const body = asRecord(await clickUpFetch(`${pathName}?${params.toString()}`));
    const pageTasks = asArray(body.tasks)
      .map((task) => mapTask(task, fallbackTeamId))
      .filter((task): task is ClickUpTask => Boolean(task));

    tasks.push(...pageTasks);

    if (pageTasks.length < TASKS_PAGE_LIMIT) {
      break;
    }
  }

  return tasks;
};

const getTasksFromList = async (
  listId: string,
  userId: string,
  fallbackTeamId: string | null,
) => {
  const params = new URLSearchParams({
    include_closed: 'false',
    order_by: 'updated',
    reverse: 'true',
  });
  params.append('assignees[]', userId);

  return getPagedTasks(`/list/${encodeURIComponent(listId)}/task`, params, fallbackTeamId);
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

      return getPagedTasks(`/team/${encodeURIComponent(team.id)}/task`, params, team.id);
    }),
  );

  return taskGroups.flat();
};

const getTaskById = async (
  taskId: string,
  fallbackTeamId: string | null,
): Promise<ClickUpTask | null> => {
  const body = await clickUpFetch(`/task/${encodeURIComponent(taskId)}`);

  return mapTask(body, fallbackTeamId);
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
  const fallbackTeamId = teams[0]?.id ?? null;
  const tasks = defaultListId
    ? await getTasksFromList(defaultListId, user.id, fallbackTeamId)
    : await getTasksFromTeams(teams, user.id);
  const sortedTasks = tasks.sort((left, right) => right.dateUpdated - left.dateUpdated);
  const isPaused = store.get('isPaused') === true;
  const storedActiveTaskId = store.get('activeTaskId') ?? null;
  const selectedTask = storedActiveTaskId
    ? sortedTasks.find((task) => task.id === storedActiveTaskId) ?? null
    : null;
  const activeTask = isPaused ? null : selectedTask ?? sortedTasks[0] ?? null;
  const activeTaskDetail = activeTask
    ? await getTaskById(activeTask.id, activeTask.teamId ?? fallbackTeamId)
    : null;
  const currentActiveTask = activeTaskDetail ?? activeTask;
  const currentTasks = activeTaskDetail
    ? sortedTasks.map((task) =>
        task.id === activeTaskDetail.id ? activeTaskDetail : task,
      )
    : sortedTasks;
  const activeTaskStatuses = currentActiveTask?.listId
    ? await getListStatuses(currentActiveTask.listId)
    : [];

  if (!isPaused && currentActiveTask && currentActiveTask.id !== storedActiveTaskId) {
    store.set('activeTaskId', currentActiveTask.id);
  }

  return {
    user,
    teams,
    tasks: currentTasks,
    activeTask: currentActiveTask,
    activeTaskStatuses,
    activeTaskId: currentActiveTask?.id ?? null,
    isPaused,
    isEmpty: currentTasks.length === 0,
    source,
    fetchedAt: new Date().toISOString(),
  };
};

const setActiveTask = (payload: unknown) => {
  const data = asRecord(payload);
  const taskId = trimString(data.taskId);

  if (!taskId) {
    throw new Error('Task id is required.');
  }

  store.set('activeTaskId', taskId);
  store.set('isPaused', false);

  return {
    activeTaskId: taskId,
    isPaused: false,
  };
};

const openTask = async (payload: unknown) => {
  const data = asRecord(payload);
  const taskId = trimString(data.taskId);

  if (!taskId || !/^[A-Za-z0-9_-]+$/.test(taskId)) {
    throw new Error('A valid ClickUp task id is required.');
  }

  await shell.openExternal(`https://app.clickup.com/t/${encodeURIComponent(taskId)}`);

  return {
    taskId,
  };
};

const pauseActiveTask = () => {
  store.set('isPaused', true);

  return {
    activeTaskId: store.get('activeTaskId') ?? null,
    isPaused: true,
  };
};

const getConfiguredHotkey = () => {
  const storedHotkey = store.get('hotkey');

  if (storedHotkey && HOTKEY_OPTIONS.includes(storedHotkey as typeof HOTKEY_OPTIONS[number])) {
    return storedHotkey;
  }

  return DEFAULT_HOTKEY;
};

const getHotkeyStatus = () => ({
  accelerator: getConfiguredHotkey(),
  registered: registeredHotkey === getConfiguredHotkey(),
  error: hotkeyError,
  options: [...HOTKEY_OPTIONS],
});

const registerConfiguredHotkey = () => {
  const accelerator = getConfiguredHotkey();

  if (registeredHotkey) {
    globalShortcut.unregister(registeredHotkey);
    registeredHotkey = null;
  }

  const registered = globalShortcut.register(accelerator, toggleWidget);
  hotkeyError = registered ? null : `${accelerator} is unavailable.`;
  registeredHotkey = registered ? accelerator : null;

  return getHotkeyStatus();
};

const setHotkey = (payload: unknown) => {
  const data = asRecord(payload);
  const accelerator = trimString(data.accelerator);

  if (
    !accelerator ||
    !HOTKEY_OPTIONS.includes(accelerator as typeof HOTKEY_OPTIONS[number])
  ) {
    throw new Error('Choose one of the supported hotkey presets.');
  }

  store.set('hotkey', accelerator);

  return registerConfiguredHotkey();
};

const linuxAutostartPath = () =>
  path.join(os.homedir(), '.config', 'autostart', 'clickup-status-widget.desktop');

const getLaunchAtLoginStatus = () => {
  if (process.platform === 'linux') {
    return {
      enabled: fs.existsSync(linuxAutostartPath()),
      supported: true,
    };
  }

  return {
    enabled: app.getLoginItemSettings().openAtLogin,
    supported: true,
  };
};

const writeLinuxAutostartEntry = () => {
  const autostartPath = linuxAutostartPath();
  fs.mkdirSync(path.dirname(autostartPath), { recursive: true });
  fs.writeFileSync(
    autostartPath,
    [
      '[Desktop Entry]',
      'Type=Application',
      'Name=ClickUp Status Widget',
      `Exec="${process.execPath}"`,
      'Hidden=false',
      'NoDisplay=false',
      'X-GNOME-Autostart-enabled=true',
      '',
    ].join('\n'),
    'utf8',
  );
};

const setLaunchAtLogin = (payload: unknown) => {
  const data = asRecord(payload);
  const enabled = data.enabled === true;
  store.set('launchAtLogin', enabled);

  if (process.platform === 'linux') {
    if (enabled) {
      writeLinuxAutostartEntry();
    } else if (fs.existsSync(linuxAutostartPath())) {
      fs.unlinkSync(linuxAutostartPath());
    }

    return getLaunchAtLoginStatus();
  }

  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
  });

  return getLaunchAtLoginStatus();
};

const getAppearanceTheme = (): AppearanceTheme => {
  const appearance = store.get('appearance');

  return APPEARANCE_THEMES.includes(appearance as AppearanceTheme)
    ? (appearance as AppearanceTheme)
    : 'black';
};

const setAppearanceTheme = (payload: unknown) => {
  const data = asRecord(payload);
  const theme = trimString(data.theme);

  if (!theme || !APPEARANCE_THEMES.includes(theme as AppearanceTheme)) {
    throw new Error('Choose one of the supported appearance themes.');
  }

  store.set('appearance', theme as AppearanceTheme);
  widgetWindow?.webContents.send('settings:appearanceChanged', theme);

  return {
    theme: theme as AppearanceTheme,
  };
};

const getSnapPosition = (): SnapPosition => {
  const snapPosition = store.get('snapPosition');

  return SNAP_POSITIONS.includes(snapPosition as SnapPosition)
    ? (snapPosition as SnapPosition)
    : 'top';
};

const setSnapPosition = (payload: unknown) => {
  const data = asRecord(payload);
  const position = trimString(data.position);

  if (!position || !SNAP_POSITIONS.includes(position as SnapPosition)) {
    throw new Error('Choose one of the supported snap positions.');
  }

  store.set('snapPosition', position as SnapPosition);

  if (widgetWindow?.isVisible()) {
    widgetWindow.setBounds(getWidgetBounds(true));
  }

  return {
    position: position as SnapPosition,
  };
};

const showOptionsMenu = (window: BrowserWindow | null) => {
  const activeHotkey = getConfiguredHotkey();
  const activeAppearance = getAppearanceTheme();
  const activeSnapPosition = getSnapPosition();
  const launchAtLogin = getLaunchAtLoginStatus();
  const menu = Menu.buildFromTemplate([
    {
      label: 'Show / hide hotkey',
      submenu: HOTKEY_OPTIONS.map((accelerator) => ({
        label: accelerator,
        type: 'radio',
        checked: accelerator === activeHotkey,
        click: () => {
          setHotkey({ accelerator });
        },
      })),
    },
    {
      label: 'Configure List...',
      click: () => {
        window?.webContents.send('settings:configureList');
      },
    },
    {
      label: 'Appearance',
      submenu: [
        { label: 'Black default', theme: 'black' },
        { label: 'White background', theme: 'white' },
        { label: 'Bright yellow', theme: 'bright' },
      ].map(({ label, theme }) => ({
        label,
        type: 'radio',
        checked: theme === activeAppearance,
        click: () => {
          setAppearanceTheme({ theme });
        },
      })),
    },
    {
      label: 'Snap Position',
      submenu: [
        { label: 'Top of display', position: 'top' },
        { label: 'Bottom of display', position: 'bottom' },
      ].map(({ label, position }) => ({
        label,
        type: 'radio',
        checked: position === activeSnapPosition,
        click: () => {
          setSnapPosition({ position });
        },
      })),
    },
    { type: 'separator' },
    {
      label: 'Launch on Startup',
      type: 'checkbox',
      checked: launchAtLogin.enabled,
      enabled: launchAtLogin.supported,
      click: (item) => {
        setLaunchAtLogin({ enabled: item.checked });
      },
    },
  ]);

  menu.popup({
    window: window ?? undefined,
  });
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

const recordTaskTimeTracked = async (payload: unknown) => {
  const data = asRecord(payload);
  const taskId = trimString(data.taskId);
  const teamId = trimString(data.teamId);
  const elapsedMs = Number(data.elapsedMs);
  const startedAt = Number(data.startedAt);

  if (!taskId || !teamId) {
    return {
      recorded: false,
      reason: 'missing-task-context',
    };
  }

  if (!Number.isFinite(elapsedMs) || elapsedMs < 60_000) {
    return {
      recorded: false,
      reason: 'elapsed-too-short',
    };
  }

  const duration = Math.floor(elapsedMs);
  const start = Number.isFinite(startedAt) ? Math.floor(startedAt) : Date.now() - duration;

  await clickUpFetch(`/team/${encodeURIComponent(teamId)}/time_entries`, {
    method: 'POST',
    body: JSON.stringify({
      start,
      duration,
      tid: taskId,
      billable: false,
    }),
  });

  return {
    recorded: true,
    taskId,
    elapsedMs: duration,
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
  const snapPosition = getSnapPosition();

  if (!tray) {
    const display = screen.getPrimaryDisplay().workArea;

    return {
      x: display.x + Math.round((display.width - WINDOW_WIDTH) / 2),
      y:
        snapPosition === 'bottom'
          ? display.y + display.height - WINDOW_HEIGHT - 8
          : display.y + 8,
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

  return {
    x,
    y:
      snapPosition === 'bottom'
        ? display.y + display.height - WINDOW_HEIGHT - 8
        : display.y + 8,
  };
};

const getWidgetBounds = (preserveCurrentX = false) => {
  const position = getWidgetPosition();
  const currentBounds = widgetWindow?.getBounds();

  return {
    ...position,
    x: preserveCurrentX && currentBounds ? currentBounds.x : position.x,
    width: WINDOW_WIDTH,
    height: isDev ? DEV_WINDOW_HEIGHT : WINDOW_HEIGHT,
  };
};

const showWidget = () => {
  if (!widgetWindow) {
    return;
  }

  widgetWindow.setBounds(getWidgetBounds());

  if (isDev) {
    widgetWindow.show();
    widgetWindow.focus();
    return;
  }

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
    height: isDev ? DEV_WINDOW_HEIGHT : WINDOW_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: !isDev,
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
ipcMain.handle('clickup:recordTimeTracked', (_event, payload) =>
  recordTaskTimeTracked(payload),
);
ipcMain.handle('clickup:setActiveTask', (_event, payload) => setActiveTask(payload));
ipcMain.handle('clickup:openTask', (_event, payload) => openTask(payload));
ipcMain.handle('clickup:pause', pauseActiveTask);
ipcMain.handle('hotkey:getStatus', getHotkeyStatus);
ipcMain.handle('hotkey:set', (_event, payload) => setHotkey(payload));
ipcMain.handle('settings:getLaunchAtLogin', getLaunchAtLoginStatus);
ipcMain.handle('settings:setLaunchAtLogin', (_event, payload) =>
  setLaunchAtLogin(payload),
);
ipcMain.handle('settings:getAppearance', () => ({
  theme: getAppearanceTheme(),
}));
ipcMain.handle('settings:setAppearance', (_event, payload) =>
  setAppearanceTheme(payload),
);
ipcMain.handle('settings:getSnapPosition', () => ({
  position: getSnapPosition(),
}));
ipcMain.handle('settings:setSnapPosition', (_event, payload) =>
  setSnapPosition(payload),
);
ipcMain.handle('settings:setDefaultListId', (_event, payload) =>
  setDefaultListId(payload),
);
ipcMain.handle('settings:showOptionsMenu', (event) => {
  showOptionsMenu(BrowserWindow.fromWebContents(event.sender));
});

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock?.hide();
  }

  applyContentSecurityPolicy();
  createWidgetWindow();
  createTray();
  registerConfiguredHotkey();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Keep the tray utility alive until the user quits from the tray menu.
});

app.on('activate', () => {
  if (!widgetWindow) {
    createWidgetWindow();
  }
});
