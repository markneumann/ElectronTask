import './index.css';

type AppState =
  | { view: 'loading'; status: AuthStatus | null; message: string }
  | { view: 'setup'; status: AuthStatus; error: string | null }
  | {
      view: 'tasks';
      status: AuthStatus;
      snapshot: ClickUpSnapshot;
      toast: ToastState | null;
    }
  | { view: 'error'; status: AuthStatus; error: string };

type ToastState = {
  kind: 'info' | 'error';
  message: string;
};

const root = document.getElementById('app');
const nodeBlocked =
  !('process' in globalThis) && !('require' in globalThis);

const escapeHtml = (value: string | null) =>
  (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderShell = (content: string) => {
  if (!root) {
    return;
  }

  root.innerHTML = `<main class="widget-shell">${content}</main>`;
};

const renderLoading = (message: string) => {
  renderShell(`
    <section class="task-summary centered" aria-label="Loading">
      <div class="status-row">
        <span class="status-dot" aria-hidden="true"></span>
        <span class="status-label">M1 read path</span>
      </div>
      <h1>ClickUp Status</h1>
      <p class="task-name">${escapeHtml(message)}</p>
    </section>
  `);
};

const renderSetup = (status: AuthStatus, error: string | null) => {
  renderShell(`
    <form id="token-form" class="setup-form" autocomplete="off">
      <div class="status-row">
        <span class="status-dot ${status.canPersistToken ? '' : 'warn'}" aria-hidden="true"></span>
        <span class="status-label">Connect ClickUp</span>
      </div>
      <input
        id="token"
        name="token"
        type="password"
        placeholder="Personal API token"
        autocomplete="off"
        required
      />
      <input
        id="default-list-id"
        name="defaultListId"
        type="text"
        placeholder="Optional list id"
        autocomplete="off"
        value="${escapeHtml(status.defaultListId)}"
      />
      <label class="remember-row">
        <input id="remember" name="remember" type="checkbox" ${status.canPersistToken ? 'checked' : ''} />
        <span>${status.canPersistToken ? 'Remember token' : 'Use for this session only'}</span>
      </label>
      <button type="submit">Connect</button>
      ${
        status.canPersistToken
          ? ''
          : `<p class="notice">Storage backend ${escapeHtml(status.storageBackend)} cannot safely persist tokens.</p>`
      }
      ${error ? `<p class="notice error">${escapeHtml(error)}</p>` : ''}
    </form>
  `);

  document
    .getElementById('token-form')
    ?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget as HTMLFormElement);
      const token = String(form.get('token') ?? '');
      const defaultListId = String(form.get('defaultListId') ?? '').trim() || null;
      const remember = Boolean(form.get('remember')) && status.canPersistToken;

      await saveTokenAndLoadTasks({
        token,
        defaultListId,
        remember,
      });
    });
};

const taskWithStatus = (task: ClickUpTask, status: string): ClickUpTask => ({
  ...task,
  status,
});

const snapshotWithStatus = (
  snapshot: ClickUpSnapshot,
  taskId: string,
  status: string,
): ClickUpSnapshot => ({
  ...snapshot,
  activeTask:
    snapshot.activeTask?.id === taskId
      ? taskWithStatus(snapshot.activeTask, status)
      : snapshot.activeTask,
  tasks: snapshot.tasks.map((task) =>
    task.id === taskId ? taskWithStatus(task, status) : task,
  ),
});

const renderTasks = (
  status: AuthStatus,
  snapshot: ClickUpSnapshot,
  toast: ToastState | null,
) => {
  const activeTask = snapshot.activeTask;
  const sourceLabel =
    snapshot.source === 'list' ? 'Configured list' : `${snapshot.teams.length} workspace`;
  const canChangeStatus = Boolean(
    activeTask?.listId && snapshot.activeTaskStatuses.length > 0,
  );
  const options = snapshot.activeTaskStatuses
    .map(
      (statusOption) =>
        `<option value="${escapeHtml(statusOption.name)}" ${
          statusOption.name === activeTask?.status ? 'selected' : ''
        }>${escapeHtml(statusOption.name)}</option>`,
    )
    .join('');

  renderShell(`
    <section class="task-summary" aria-label="Current ClickUp task">
      <div class="status-row">
        <span class="status-dot" aria-hidden="true"></span>
        <span class="status-label">${escapeHtml(activeTask?.status ?? 'No open task')}</span>
      </div>
      <h1>${escapeHtml(activeTask?.name ?? 'No assigned task')}</h1>
      <p class="task-name">
        ${escapeHtml(activeTask?.listName ?? sourceLabel)}
      </p>
    </section>
    ${
      canChangeStatus
        ? `<label class="status-control">
            <span>Status</span>
            <select id="status-select" aria-label="Change task status">${options}</select>
          </label>`
        : `<p class="notice">No list statuses available for this task.</p>`
    }
    <section class="footer-row">
      <span>${snapshot.tasks.length} tasks &middot; Node ${nodeBlocked ? 'blocked' : 'exposed'}</span>
      <button id="disconnect" class="ghost-button" type="button">Forget</button>
    </section>
    ${toast ? `<p class="toast ${toast.kind}">${escapeHtml(toast.message)}</p>` : ''}
  `);

  document.getElementById('status-select')?.addEventListener('change', async (event) => {
    const select = event.currentTarget as HTMLSelectElement;
    const nextStatus = select.value;

    if (!activeTask?.listId || nextStatus === activeTask.status) {
      return;
    }

    const previousSnapshot = snapshot;
    const optimisticSnapshot = snapshotWithStatus(snapshot, activeTask.id, nextStatus);
    renderTasks(status, optimisticSnapshot, {
      kind: 'info',
      message: 'Updating status...',
    });

    try {
      await window.clickup.setStatus({
        taskId: activeTask.id,
        listId: activeTask.listId,
        status: nextStatus,
      });
      renderTasks(status, optimisticSnapshot, {
        kind: 'info',
        message: 'Status updated.',
      });
    } catch (error) {
      renderTasks(status, previousSnapshot, {
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'Could not update status.',
      });
    }
  });

  document.getElementById('disconnect')?.addEventListener('click', async () => {
    const nextStatus = await window.auth.clearToken();
    renderSetup(nextStatus, null);
  });
};

const renderError = (status: AuthStatus, error: string) => {
  renderShell(`
    <section class="task-summary" aria-label="Error">
      <div class="status-row">
        <span class="status-dot warn" aria-hidden="true"></span>
        <span class="status-label">ClickUp error</span>
      </div>
      <h1>Could not load tasks</h1>
      <p class="task-name">${escapeHtml(error)}</p>
    </section>
    <section class="action-row">
      <button id="retry" type="button">Retry</button>
      <button id="disconnect" class="ghost-button" type="button">Forget token</button>
    </section>
  `);

  document.getElementById('retry')?.addEventListener('click', loadApp);
  document.getElementById('disconnect')?.addEventListener('click', async () => {
    const nextStatus = await window.auth.clearToken();
    renderSetup(nextStatus, null);
  });
};

const render = (state: AppState) => {
  switch (state.view) {
    case 'loading':
      renderLoading(state.message);
      break;
    case 'setup':
      renderSetup(state.status, state.error);
      break;
    case 'tasks':
      renderTasks(state.status, state.snapshot, state.toast);
      break;
    case 'error':
      renderError(state.status, state.error);
      break;
  }
};

const loadTasks = async (status: AuthStatus) => {
  render({ view: 'loading', status, message: 'Loading assigned tasks...' });

  try {
    const snapshot = await window.clickup.getMyTasks();
    render({ view: 'tasks', status, snapshot, toast: null });
  } catch (error) {
    render({
      view: 'error',
      status,
      error: error instanceof Error ? error.message : 'Unknown ClickUp error.',
    });
  }
};

const saveTokenAndLoadTasks = async (payload: SaveTokenPayload) => {
  const status = await window.auth.getStatus();
  render({ view: 'loading', status, message: 'Saving token...' });

  try {
    const nextStatus = await window.auth.saveToken(payload);
    await loadTasks(nextStatus);
  } catch (error) {
    renderSetup(
      status,
      error instanceof Error ? error.message : 'Could not save the token.',
    );
  }
};

const loadApp = async () => {
  renderLoading('Checking auth...');
  const status = await window.auth.getStatus();

  if (!status.hasToken) {
    render({ view: 'setup', status, error: null });
    return;
  }

  await loadTasks(status);
};

window.widget
  .ping()
  .then(loadApp)
  .catch(() => renderLoading('Main process unavailable.'));
