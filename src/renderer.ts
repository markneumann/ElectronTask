import './index.css';

const nodeAccess = {
  process: 'process' in globalThis,
  require: 'require' in globalThis,
};

const renderStatus = (ping: WidgetPingResult) => {
  const root = document.getElementById('app');

  if (!root) {
    return;
  }

  root.innerHTML = `
    <main class="widget-shell">
      <section class="task-summary" aria-label="Current ClickUp task">
        <div class="status-row">
          <span class="status-dot" aria-hidden="true"></span>
          <span class="status-label">M0 shell</span>
        </div>
        <h1>ClickUp Status</h1>
        <p class="task-name">No task connected yet</p>
      </section>
      <section class="security-grid" aria-label="Security checks">
        <div>
          <span>IPC</span>
          <strong>${ping.ok ? 'Ready' : 'Failed'}</strong>
        </div>
        <div>
          <span>Node</span>
          <strong>${nodeAccess.process || nodeAccess.require ? 'Exposed' : 'Blocked'}</strong>
        </div>
      </section>
    </main>
  `;
};

window.widget
  .ping()
  .then(renderStatus)
  .catch(() =>
    renderStatus({
      ok: false,
      message: 'main process unavailable',
    }),
  );
