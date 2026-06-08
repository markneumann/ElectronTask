# ClickUp Status Widget — Electron Build Prompt v1

> Paste this at the start of a Claude Code session in an empty repo. The "Project rules" section is also suitable to save as `CLAUDE.md` (or `AGENTS.md`, which Claude Code also reads) so it persists across sessions.
>
> This is the **Electron** variant. The build spec, milestones, and ClickUp contract match the Tauri prompt; only the stack-specific mechanics differ.

---

## What we're building

A lightweight, always-on-top desktop widget that shows the developer their **current ClickUp task** and lets them **change its status** (e.g. In&nbsp;Progress → Waiting&nbsp;on&nbsp;Review when they open an MR), **switch** to another task from their backlog, and **pause**. It lives in the system tray and is summoned with a global hotkey. Cross-platform: Windows, macOS, Linux.

This is a personal, single-user tool for v1. Design the auth layer so a future multi-user (OAuth) version is a contained change, not a rewrite.

## Stack (do not deviate without asking)

- **Electron** (latest stable) scaffolded with **Electron Forge** using the TypeScript template (`npx create-electron-app@latest <name> --template=vite-typescript`, or the webpack-typescript template if Vite gives trouble — Forge's Vite support is still marked experimental). `electron-vite` is an acceptable alternative scaffold.
- **TypeScript** throughout — main, preload, and renderer. No Rust, no other backend language.
- **Frontend (renderer):** keep it lean. Vanilla TS or a light framework is fine; React is acceptable here since the Chromium runtime ships anyway — but keep dependencies minimal (attack surface).
- **Local non-secret state:** `electron-store` (or `electron-conf`).
- **Secure token storage:** Electron's built-in `safeStorage` API, which encrypts via the OS secret store (macOS Keychain, Windows DPAPI, Linux gnome-libsecret/kwallet). Persist only the **encrypted blob** (e.g. via `electron-store`). The token must never be stored in plaintext, in the renderer, in `localStorage`, or in git. Docs: https://www.electronjs.org/docs/latest/api/safe-storage

## Project rules (hard constraints)

1. **The main process is the proxy. The token never reaches the renderer.** The decrypted token may exist only in main-process memory, preferably decrypted on demand for each request from `safeStorage`; the main process makes all HTTPS calls to ClickUp and returns parsed JSON to the renderer over IPC. The renderer never sees the raw token and never calls ClickUp directly. (Main-process `fetch` also sidesteps CORS.)
2. **Electron security baseline is non-negotiable:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no `@electron/remote`. All renderer↔main communication goes through a **preload script using `contextBridge`** exposing only specific, named functions (e.g. `clickup.getMyTasks()`, `clickup.setStatus()`, `auth.saveToken()`). Validate all IPC inputs in the main process. Set a strict Content-Security-Policy and load only the local bundle — never remote content. Follow https://www.electronjs.org/docs/latest/tutorial/security
3. **No secrets in code or git.** No tokens, no client secrets. The token is entered by the user at runtime and stored encrypted via `safeStorage` only.
4. **Handle the Linux plaintext fallback.** If `safeStorage.getSelectedStorageBackend()` returns `basic_text` (no system secret store available), do **not** silently persist the token — warn the user and either hold it in memory for the session or refuse to save it unencrypted.
5. **No telemetry, analytics, or third-party services** other than the ClickUp API.
6. **Ask before adding any dependency** other than scaffold-generated Electron Forge/Vite/TypeScript tooling, `electron-store` or `electron-conf`, and the explicitly chosen renderer option from the Stack section.
7. **Build in vertical slices.** Complete one milestone at a time; each must build and run before moving on. Commit after each milestone with a clear message. Stop and summarize after each milestone so I can review.
8. **Cross-platform from day one** — keep the code cross-platform from the start and avoid OS-specific assumptions. Verify platform packaging in M5 on each target OS or CI runner.

## ClickUp API contract

Base URL: `https://api.clickup.com/api/v2`

- **Auth header (v1, personal token):** `Authorization: <token>` — personal API tokens are sent **raw, without** a `Bearer` prefix. (OAuth access tokens later will use `Authorization: Bearer <token>`.)
- **Current user:** `GET /user` → returns the authenticated user's id.
- **Workspaces:** `GET /team` → returns the team (workspace) ids the token can access.
- **My open tasks:** `GET /team/{team_id}/task?assignees[]={user_id}` (Get Filtered Team Tasks). Filter to non-closed tasks (`include_closed=false`), order by most recently updated, and handle pagination; do not assume the first page contains all assigned tasks. For a quick first slice, `GET /list/{list_id}/task` against one configured list is acceptable, but it must still handle pagination if the endpoint paginates.
- **Available statuses:** for v1, resolve statuses from the task's list (`GET /list/{list_id}`) to get the valid status names to populate the status control. If statuses are missing or inherited unexpectedly, fail visibly and log the task/list ids. Do not hard-code status names.
- **Change status:** `PUT /task/{task_id}` with body `{"status": "<status name>"}`. Status is matched by **name string**, so it must be one of the list's defined statuses.
- **Rate limit:** ~100 requests/min per token on lower plans. Poll on a sane interval (30–60s), cache results, and back off exponentially on HTTP 429. Do not poll tightly.

Docs for reference: https://developer.clickup.com/docs/authentication and https://developer.clickup.com/docs/tasks

## Auth seam (build for the future, implement only v1)

Define an interface, e.g. `AuthProvider`, exposing something like `currentAuthHeader()`. Implement **only** `PersonalTokenProvider` for v1 (reads the token from `safeStorage`). Leave a clearly-marked extension point for a future `OAuthProvider` (authorization-code flow + a separate token-exchange backend that holds the client secret; the main process catches the redirect via a registered custom protocol — `app.setAsDefaultProtocolClient` — or a temporary loopback server). **Do not build OAuth in v1.**

## Window behavior

- `BrowserWindow` with `frame: false`, `transparent: true`, `alwaysOnTop: true`, `skipTaskbar: true`, `resizable: false`, ~320×170, `show: false` initially.
- A `Tray` icon with a context menu and click-to-toggle. Electron has no positioner plugin — compute the window position near the tray from `tray.getBounds()` and the `screen` module.
- **macOS:** `app.dock.hide()` (or accessory activation policy) so it behaves like a menu-bar utility with no Dock icon.
- Global hotkey via Electron's `globalShortcut.register` in the main process; `globalShortcut.unregisterAll()` on `will-quit`. A renderer-side `keydown` listener only fires when focused, which is useless for a hidden widget.

## Milestones

**M0 — Scaffold + shell.** Electron Forge TS scaffold with the security baseline wired (contextIsolation, sandbox, preload + contextBridge stub). Frameless/transparent/always-on-top `BrowserWindow` + `Tray`, show/hide toggle from the tray, window positioned near the tray. Static placeholder UI. *Acceptance:* runs on the dev machine; clicking the tray toggles the widget; no remote content loads; CSP is present; preload exposes only a tiny test API; renderer cannot access `process`, `require`, or Node globals.

**M1 — Auth + read path.** First-run token entry → encrypt with `safeStorage` → store the blob. Then `GET /user` + `GET /team`, fetch my open tasks via the main-process proxy, and render the active task's name and current status. *Acceptance:* real tasks from my workspace appear; the raw token never crosses IPC to the renderer.

**M2 — Status transitions.** Read the active task's list statuses, render them as a dropdown or buttons, `PUT` the change through the proxy, optimistic UI update with rollback + a toast on error. *Acceptance:* changing the status in the widget is reflected in ClickUp.

**M3 — Switch + pause.** A picker to choose another assigned task as "active" (persist via `electron-store`), a pause state (no active task), and a manual refresh. *Acceptance:* I can switch the active task and pause; selection survives an app restart.

**M4 — Global hotkey.** Register a configurable show/hide hotkey via `globalShortcut`; unregister cleanly on quit. *Acceptance:* the hotkey toggles the widget while another app is focused.

**M5 — Polish.** Launch-at-login (`app.setLoginItemSettings`, plus a `.desktop` autostart entry on Linux), 429/backoff handling, offline and empty states, an app icon, and packaged installers via Electron Forge makers for all three platforms. *Acceptance:* installable build per OS; graceful behavior with no network.

## What I need to supply at runtime

- My ClickUp **personal API token** (entered in the app, encrypted via `safeStorage` — never in code).
- Optionally, a default **list id** to scope M1's first read.

> **Optional dev aid:** attach the ClickUp MCP connector to this Claude Code session so it can read my real workspace, list, and status names directly instead of asking me to paste IDs — particularly useful at M2 for the status-name mapping.

## Start here

Begin with **M0** only. Scaffold the project with the security baseline, get the tray + frameless always-on-top window working with a placeholder UI, confirm it builds and runs, commit, then stop and summarize what you did and what M1 will involve. Do not start M1 until I say go.

---
*AI-assisted by Claude Opus 4.8 · reviewed by MN · 2026-06-07*
