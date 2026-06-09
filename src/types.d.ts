type WidgetPingResult = {
  ok: boolean;
  message: string;
};

type AuthStatus = {
  hasToken: boolean;
  canPersistToken: boolean;
  storageBackend: string;
  defaultListId: string | null;
};

type SaveTokenPayload = {
  token: string;
  defaultListId: string | null;
  remember: boolean;
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

type ClickUpSnapshot = {
  user: {
    id: string;
    username: string | null;
  };
  teams: Array<{
    id: string;
    name: string;
  }>;
  tasks: ClickUpTask[];
  activeTask: ClickUpTask | null;
  activeTaskStatuses: ClickUpStatus[];
  activeTaskId: string | null;
  isPaused: boolean;
  isEmpty: boolean;
  source: 'team' | 'list';
  fetchedAt: string;
};

type SetStatusPayload = {
  taskId: string;
  listId: string;
  status: string;
};

type SetStatusResult = {
  taskId: string;
  status: string;
};

type SetActiveTaskPayload = {
  taskId: string;
};

type ActiveTaskState = {
  activeTaskId: string | null;
  isPaused: boolean;
};

type OpenTaskPayload = {
  taskId: string;
};

type OpenTaskResult = {
  taskId: string;
};

type HotkeyStatus = {
  accelerator: string;
  registered: boolean;
  error: string | null;
  options: string[];
};

type SetHotkeyPayload = {
  accelerator: string;
};

type LaunchAtLoginStatus = {
  enabled: boolean;
  supported: boolean;
};

type SetLaunchAtLoginPayload = {
  enabled: boolean;
};

type SetDefaultListIdPayload = {
  defaultListId: string | null;
};

interface Window {
  widget: {
    ping: () => Promise<WidgetPingResult>;
  };
  auth: {
    getStatus: () => Promise<AuthStatus>;
    saveToken: (payload: SaveTokenPayload) => Promise<AuthStatus>;
    clearToken: () => Promise<AuthStatus>;
  };
  clickup: {
    getMyTasks: () => Promise<ClickUpSnapshot>;
    setStatus: (payload: SetStatusPayload) => Promise<SetStatusResult>;
    setActiveTask: (payload: SetActiveTaskPayload) => Promise<ActiveTaskState>;
    openTask: (payload: OpenTaskPayload) => Promise<OpenTaskResult>;
    pause: () => Promise<ActiveTaskState>;
  };
  hotkey: {
    getStatus: () => Promise<HotkeyStatus>;
    set: (payload: SetHotkeyPayload) => Promise<HotkeyStatus>;
  };
  settings: {
    getLaunchAtLogin: () => Promise<LaunchAtLoginStatus>;
    setLaunchAtLogin: (
      payload: SetLaunchAtLoginPayload,
    ) => Promise<LaunchAtLoginStatus>;
    setDefaultListId: (payload: SetDefaultListIdPayload) => Promise<AuthStatus>;
    showOptionsMenu: () => Promise<void>;
    onConfigureList: (callback: () => void) => void;
  };
}
