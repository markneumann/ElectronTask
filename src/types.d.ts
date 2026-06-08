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
  };
}
