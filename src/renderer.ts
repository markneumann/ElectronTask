import './index.css';

document.body.classList.toggle('dev-window', Boolean(import.meta.env.DEV));

type AppState =
  | { view: 'loading'; status: AuthStatus | null; message: string }
  | { view: 'setup'; status: AuthStatus; error: string | null }
  | {
      view: 'tasks';
      status: AuthStatus;
      snapshot: ClickUpSnapshot;
      hotkey: HotkeyStatus;
      launchAtLogin: LaunchAtLoginStatus;
      toast: ToastState | null;
    }
  | {
      view: 'error';
      status: AuthStatus;
      hotkey: HotkeyStatus | null;
      error: string;
    };

type ToastState = {
  kind: 'info' | 'error';
  message: string;
};

const root = document.getElementById('app');

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

const daysSinceUpdateLabel = (dateUpdated: number) => {
  if (!Number.isFinite(dateUpdated) || dateUpdated <= 0) {
    return 'unknown';
  }

  const elapsedMs = Date.now() - dateUpdated;
  const elapsedDays = Math.max(0, Math.floor(elapsedMs / 86_400_000));

  return elapsedDays === 1 ? '1 day' : `${elapsedDays} days`;
};

const renderTasks = (
  status: AuthStatus,
  snapshot: ClickUpSnapshot,
  hotkey: HotkeyStatus,
  launchAtLogin: LaunchAtLoginStatus,
  toast: ToastState | null,
) => {
  const activeTask = snapshot.activeTask;
  const sourceLabel =
    snapshot.source === 'list' ? 'Configured list' : `${snapshot.teams.length} workspace`;
  const canChangeStatus = Boolean(
    activeTask?.listId && snapshot.activeTaskStatuses.length > 0,
  );
  const taskOptions = snapshot.tasks
    .map(
      (task) =>
        `<option value="${escapeHtml(task.id)}" ${
          task.id === snapshot.activeTaskId ? 'selected' : ''
        }>${escapeHtml(
          `${task.status} - ${task.name} - ${daysSinceUpdateLabel(task.dateUpdated)}`,
        )}</option>`,
    )
    .join('');
  const options = snapshot.activeTaskStatuses
    .map(
      (statusOption) =>
        `<option value="${escapeHtml(statusOption.name)}" ${
          statusOption.name === activeTask?.status ? 'selected' : ''
        }>${escapeHtml(statusOption.name)}</option>`,
    )
    .join('');
  const hotkeyOptions = hotkey.options
    .map(
      (option) =>
        `<option value="${escapeHtml(option)}" ${
          option === hotkey.accelerator ? 'selected' : ''
        }>${escapeHtml(option)}</option>`,
    )
    .join('');

  renderShell(`
    <section class="task-summary" aria-label="Current ClickUp task">
      <div class="status-row">
        <span class="status-dot ${snapshot.isPaused ? 'warn' : ''}" aria-hidden="true"></span>
        <span class="status-label">${escapeHtml(
          snapshot.isEmpty
            ? 'Empty'
            : snapshot.isPaused
              ? 'Paused'
              : activeTask?.status ?? 'No open task',
        )}</span>
      </div>
      <h1>${escapeHtml(
        snapshot.isEmpty
          ? 'No assigned tasks'
          : snapshot.isPaused
            ? 'No active task'
            : activeTask?.name ?? 'No assigned task',
      )}</h1>
      ${
        activeTask && !snapshot.isPaused
          ? `<button id="open-task-title" class="task-open-link" type="button">Open in ClickUp</button>`
          : ''
      }
      <p class="task-name">
        ${escapeHtml(
          snapshot.isEmpty
            ? 'Refresh when ClickUp has assigned work.'
            : snapshot.isPaused
              ? 'Paused until you choose a task'
              : activeTask?.listName ?? sourceLabel,
        )}
      </p>
    </section>
    ${
      snapshot.tasks.length > 0
        ? `<label class="task-picker">
            <span>Task</span>
            <select id="task-select" aria-label="Switch active task">
              <option value="" ${snapshot.isPaused ? 'selected' : ''}>Paused</option>
              ${taskOptions}
            </select>
          </label>`
        : ''
    }
    ${
      canChangeStatus
        ? `<label class="status-control">
            <span>Status</span>
            <select id="status-select" aria-label="Change task status">${options}</select>
          </label>`
        : `<p class="notice">No list statuses available for this task.</p>`
    }
    <section class="footer-row">
      <select id="hotkey-select" class="hotkey-select" aria-label="Global hotkey" title="Global hotkey">
        ${hotkeyOptions}
      </select>
      <div class="footer-actions">
        <button id="refresh" class="icon-button" type="button" title="Refresh">R</button>
        <button id="open-task" class="icon-button" type="button" title="Open selected task in ClickUp">O</button>
        <button id="launch-login" class="icon-button ${launchAtLogin.enabled ? 'active' : ''}" type="button" title="Launch at login">L</button>
        <button id="pause" class="icon-button" type="button" title="${snapshot.isPaused ? 'Resume first task' : 'Pause'}">${snapshot.isPaused ? 'Play' : 'Pause'}</button>
        <button id="disconnect" class="icon-button" type="button" title="Forget token">X</button>
      </div>
    </section>
    ${
      hotkey.error
        ? `<p class="toast error">${escapeHtml(hotkey.error)}</p>`
        : toast
          ? `<p class="toast ${toast.kind}">${escapeHtml(toast.message)}</p>`
          : ''
    }
  `);

  document.getElementById('task-select')?.addEventListener('change', async (event) => {
    const select = event.currentTarget as HTMLSelectElement;
    const taskId = select.value;

    renderTasks(status, snapshot, hotkey, launchAtLogin, {
      kind: 'info',
      message: taskId ? 'Switching task...' : 'Pausing...',
    });

    try {
      if (taskId) {
        await window.clickup.setActiveTask({ taskId });
      } else {
        await window.clickup.pause();
      }

      await loadTasks(status);
    } catch (error) {
      renderTasks(status, snapshot, hotkey, launchAtLogin, {
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not switch task.',
      });
    }
  });

  document.getElementById('status-select')?.addEventListener('change', async (event) => {
    const select = event.currentTarget as HTMLSelectElement;
    const nextStatus = select.value;

    if (!activeTask?.listId || nextStatus === activeTask.status) {
      return;
    }

    const previousSnapshot = snapshot;
    const optimisticSnapshot = snapshotWithStatus(snapshot, activeTask.id, nextStatus);
    renderTasks(status, optimisticSnapshot, hotkey, launchAtLogin, {
      kind: 'info',
      message: 'Updating status...',
    });

    try {
      await window.clickup.setStatus({
        taskId: activeTask.id,
        listId: activeTask.listId,
        status: nextStatus,
      });
      renderTasks(status, optimisticSnapshot, hotkey, launchAtLogin, {
        kind: 'info',
        message: 'Status updated.',
      });
    } catch (error) {
      renderTasks(status, previousSnapshot, hotkey, launchAtLogin, {
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'Could not update status.',
      });
    }
  });

  document.getElementById('refresh')?.addEventListener('click', () => {
    loadTasks(status);
  });

  const openActiveTask = async () => {
    if (!activeTask || snapshot.isPaused) {
      renderTasks(status, snapshot, hotkey, launchAtLogin, {
        kind: 'error',
        message: 'Choose an active task first.',
      });
      return;
    }

    try {
      await window.clickup.openTask({ taskId: activeTask.id });
      renderTasks(status, snapshot, hotkey, launchAtLogin, {
        kind: 'info',
        message: 'Opened in ClickUp.',
      });
    } catch (error) {
      renderTasks(status, snapshot, hotkey, launchAtLogin, {
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not open task.',
      });
    }
  };

  document.getElementById('open-task-title')?.addEventListener('click', openActiveTask);
  document.getElementById('open-task')?.addEventListener('click', openActiveTask);

  document.getElementById('hotkey-select')?.addEventListener('change', async (event) => {
    const select = event.currentTarget as HTMLSelectElement;

    try {
      const nextHotkey = await window.hotkey.set({
        accelerator: select.value,
      });
      renderTasks(status, snapshot, nextHotkey, launchAtLogin, {
        kind: nextHotkey.registered ? 'info' : 'error',
        message: nextHotkey.registered ? 'Hotkey updated.' : 'Hotkey unavailable.',
      });
    } catch (error) {
      renderTasks(status, snapshot, hotkey, launchAtLogin, {
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not update hotkey.',
      });
    }
  });

  document.getElementById('launch-login')?.addEventListener('click', async () => {
    try {
      const nextLaunchAtLogin = await window.settings.setLaunchAtLogin({
        enabled: !launchAtLogin.enabled,
      });
      renderTasks(status, snapshot, hotkey, nextLaunchAtLogin, {
        kind: 'info',
        message: nextLaunchAtLogin.enabled
          ? 'Launch at login enabled.'
          : 'Launch at login disabled.',
      });
    } catch (error) {
      renderTasks(status, snapshot, hotkey, launchAtLogin, {
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Could not update launch at login.',
      });
    }
  });

  document.getElementById('pause')?.addEventListener('click', async () => {
    try {
      if (snapshot.isPaused) {
        const firstTask = snapshot.tasks[0];

        if (firstTask) {
          await window.clickup.setActiveTask({ taskId: firstTask.id });
        }
      } else {
        await window.clickup.pause();
      }

      await loadTasks(status);
    } catch (error) {
      renderTasks(status, snapshot, hotkey, launchAtLogin, {
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'Could not update pause state.',
      });
    }
  });

  document.getElementById('disconnect')?.addEventListener('click', async () => {
    const nextStatus = await window.auth.clearToken();
    renderSetup(nextStatus, null);
  });
};

const hotkeyOptionsHtml = (hotkey: HotkeyStatus) =>
  hotkey.options
    .map(
      (option) =>
        `<option value="${escapeHtml(option)}" ${
          option === hotkey.accelerator ? 'selected' : ''
        }>${escapeHtml(option)}</option>`,
    )
    .join('');

const attachHotkeyControl = (
  status: AuthStatus,
  hotkey: HotkeyStatus,
  onRender: (nextHotkey: HotkeyStatus, toast: ToastState | null) => void,
) => {
  document.getElementById('hotkey-select')?.addEventListener('change', async (event) => {
    const select = event.currentTarget as HTMLSelectElement;

    try {
      const nextHotkey = await window.hotkey.set({
        accelerator: select.value,
      });
      onRender(nextHotkey, {
        kind: nextHotkey.registered ? 'info' : 'error',
        message: nextHotkey.registered ? 'Hotkey updated.' : 'Hotkey unavailable.',
      });
    } catch (error) {
      onRender(hotkey, {
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not update hotkey.',
      });
    }
  });

  document.getElementById('refresh')?.addEventListener('click', () => {
    loadTasks(status);
  });
};

const renderError = (
  status: AuthStatus,
  error: string,
  hotkey: HotkeyStatus | null,
  toast: ToastState | null = null,
) => {
  renderShell(`
    <section class="task-summary" aria-label="Error">
      <div class="status-row">
        <span class="status-dot warn" aria-hidden="true"></span>
        <span class="status-label">ClickUp error</span>
      </div>
      <h1>Could not load tasks</h1>
      <p class="task-name">${escapeHtml(error)}</p>
    </section>
    ${
      hotkey
        ? `<section class="footer-row">
            <select id="hotkey-select" class="hotkey-select" aria-label="Global hotkey" title="Global hotkey">
              ${hotkeyOptionsHtml(hotkey)}
            </select>
            <div class="footer-actions">
              <button id="refresh" class="icon-button" type="button" title="Retry">R</button>
              <button id="disconnect" class="icon-button" type="button" title="Forget token">X</button>
            </div>
          </section>`
        : `<section class="action-row">
            <button id="retry" type="button">Retry</button>
            <button id="disconnect" class="ghost-button" type="button">Forget token</button>
          </section>`
    }
    ${
      hotkey?.error
        ? `<p class="toast error">${escapeHtml(hotkey.error)}</p>`
        : toast
          ? `<p class="toast ${toast.kind}">${escapeHtml(toast.message)}</p>`
          : ''
    }
  `);

  document.getElementById('retry')?.addEventListener('click', loadApp);
  if (hotkey) {
    attachHotkeyControl(status, hotkey, (nextHotkey, nextToast) => {
      renderError(status, error, nextHotkey, nextToast);
    });
  }
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
      renderTasks(
        state.status,
        state.snapshot,
        state.hotkey,
        state.launchAtLogin,
        state.toast,
      );
      break;
    case 'error':
      renderError(state.status, state.error, state.hotkey);
      break;
  }
};

const loadTasks = async (status: AuthStatus) => {
  render({ view: 'loading', status, message: 'Loading assigned tasks...' });

  try {
    const hotkey = await window.hotkey.getStatus();
    const launchAtLogin = await window.settings.getLaunchAtLogin();
    const snapshot = await window.clickup.getMyTasks();
    render({ view: 'tasks', status, snapshot, hotkey, launchAtLogin, toast: null });
  } catch (error) {
    const hotkey = await window.hotkey.getStatus().catch(() => null);
    render({
      view: 'error',
      status,
      hotkey,
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
