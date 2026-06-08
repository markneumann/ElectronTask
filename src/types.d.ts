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
  source: 'team' | 'list';
  fetchedAt: string;
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
  };
}
