# ClickUp Status Widget

A lightweight Electron desktop widget for tracking the developer's current ClickUp work, switching the active task, updating task status, and managing time spent without exposing the ClickUp personal token to the renderer process.

This app is designed for a single-user workflow and keeps ClickUp requests in the Electron main process behind a secure bridge.

## Features

- Secure ClickUp token entry with Electron `safeStorage`
- Main-process API proxy so the renderer never calls ClickUp directly
- Shows the current active task, task list, and work state
- Lets the user:
  - switch the active task
  - pause/resume work
  - update task status
  - refresh task data
  - open a task in ClickUp
- Tracks elapsed time per task using ClickUp time entries
- Global hotkey to show/hide the widget
- Launch-at-login support
- Appearance and snap-position controls
- Linux autostart support with safe fallback behavior

## Security model

This project follows the Electron security rules defined in the project guidance:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- All renderer-to-main communication goes through a preload script and `contextBridge`
- The ClickUp token is stored only in encrypted form when the platform supports secure storage
- Linux fallback mode (`basic_text`) is handled by warning the user rather than silently persisting an unencrypted token
- No secrets are committed to the repository

## Tech stack

- Electron
- Electron Forge
- TypeScript
- Vite
- electron-store

## Requirements

- Node.js 18+ recommended
- npm
- A valid ClickUp personal API token

## Installation

```bash
npm install
```

## Running locally

```bash
npm start
```

This starts the Electron app in development mode.

## Packaging / building

```bash
npm run package
npm run make
```

The build pipeline is set up for Electron Forge packaging and installer generation.

## Project structure

```text
.
├── assets/                # App icons and static assets
├── src/
│   ├── index.css          # Widget styling
│   ├── main.ts            # Electron main process, security setup, ClickUp proxy
│   ├── preload.ts        # Exposed browser APIs via contextBridge
│   ├── renderer.ts        # Widget UI logic and event handlers
│   └── types.d.ts        # Global type declarations
├── .eslintrc.json         # ESLint configuration
├── AGENTS.md              # Project rules and security constraints
├── forge.config.ts        # Electron Forge configuration
├── index.html             # Renderer entry HTML
├── package.json           # Scripts and dependencies
├── tsconfig.json          # TypeScript config
├── vite.main.config.ts    # Vite main-process config
├── vite.preload.config.ts # Vite preload config
├── vite.renderer.config.ts
└── README.md
```

## Typical workflow

1. Launch the app
2. Enter a ClickUp personal API token
3. Optionally set a default list ID for scoped task loading
4. The app fetches your assigned tasks from ClickUp through the main process
5. Choose an active task, update its status, or pause work
6. Use the widget hotkey to quickly show or hide the app

## ClickUp API behavior

The app calls ClickUp endpoints through the main process using the personal token in the Authorization header. It supports:

- fetching the current user
- loading workspaces/teams
- loading assigned tasks
- reading list statuses
- updating a task's status
- recording time entries

## Notes

- The app is designed as a personal productivity utility and is intentionally narrow in scope.
- The project includes a clear extension point for future auth changes, but v1 uses a personal token provider only.
- Sensitive runtime data is not stored in code or committed to git.

## License

MIT

## Author

Mark Neumann
