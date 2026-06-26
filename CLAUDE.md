# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Jira Desktop is an Electron app that wraps a Jira Cloud workspace in a hardened desktop shell with multi-tab browsing, pinned tabs, and session restore. It targets Node.js 22+ and uses Yarn 1.x.

## Commands

```bash
yarn install                 # install dependencies
yarn start                   # run the Electron app (uses dev userData dir)
yarn test:unit               # run all unit tests (tests/unit.js runs each *.test.js module)
yarn test:smoke              # run Playwright-based Electron smoke tests
yarn package:dir             # electron-builder unpacked build (quick local check)
yarn dist                    # full electron-builder distributables
yarn release-mac             # mac .zip + .dmg, publish never
yarn release-mac-ci          # mac .zip only (used by CI runners)
yarn release-win             # Windows nsis + zip
```

Run a single unit test module directly, e.g.:

```bash
node -e "require('./tests/navigation-policy.test').runNavigationPolicyTests()"
```

Runtime overrides (take precedence over the saved local workspace; CLI beats env):

```bash
yarn start -- --jira-url=https://your-domain.atlassian.net
JIRA_URL=https://your-domain.atlassian.net yarn start
JIRA_ALLOWED_HOSTS=auth.example.com,id.atlassian.com yarn start
JIRA_DESKTOP_CONFIG_DIR=/tmp/jd-dev yarn start    # redirects dev userData dir
```

## Architecture

The app follows Electron's main/preload/renderer split with strict isolation. All Jira content runs in `WebContentsView` instances that are separate from the shell window.

### Entry point: `main.js`

Wires together the modules under `main/` and owns all `ipcMain` handlers (`shell:*` channels). Responsibilities:

- Acquires a single-instance lock (second launches focus the existing window).
- In unpackaged runs, redirects `userData` via `getDevUserDataPath` so dev state does not overwrite packaged-app state.
- Checks GitHub Releases for updates (`/repos/prakharbhardwaj/jira-desktop/releases/latest`) and delegates semver/platform matching to `main/update-check.js`.
- Persists the tab session on state changes and on `before-quit` (unless a runtime `JIRA_URL`/`--jira-url` override is active — overrides never overwrite the saved session).

### `main/` modules (pure factories, dependency-injected)

Each module exports a `create*` factory that accepts its collaborators so tests can pass fakes without loading Electron:

- `workspace-config.js` — reads/writes `workspace.json` in userData, normalizes Jira URLs (HTTPS only), parses `--jira-url` / `JIRA_URL` / `JIRA_ALLOWED_HOSTS`, and stores per-workspace persisted tab sessions.
- `navigation-policy.js` — allow-list for top-level navigation (the configured Jira host, `JIRA_ALLOWED_HOSTS`, and `.atlassian.net` / `.atlassian.com` / `.jira.com` suffixes). Also owns session permission checks and the right-click context menu.
- `tab-manager.js` — owns the `WebContentsView` instances, active/pinned state, `serializeState` (for the renderer) vs. `serializePersistedState` (for disk), and tab lifecycle. Views are created with `contextIsolation`, `sandbox`, `nodeIntegration: false`.
- `window-shell.js` — creates the `BrowserWindow`, loads `index.html`, attaches/detaches the active tab view, manages sidebar-visible layout, and broadcasts state to the renderer.
- `keyboard-shortcuts.js` — translates `before-input-event` on each webContents into named commands (`new-tab`, `close-active-tab`, `reload-active-tab`, `force-reload-active-tab`) that `main.js` dispatches via `runShortcutCommand`.
- `update-check.js` — pure parser for GitHub Releases payloads; picks the right asset for `process.platform` / `process.arch` and compares versions.
- `dev-user-data.js` — computes the dev-only userData directory.

### Preload + renderer

- `preload.js` exposes a minimal `window.jiraDesktop` surface over `contextBridge` (`getState`, `saveWorkspaceUrl`, tab ops, `checkUpdate`, `onState`, `setTheme`, etc.). All IPC goes through `shell:*` channels — extend this surface rather than enabling `nodeIntegration`.
- `renderer.js` + `index.html` + `styles.css` are the shell UI (tab strip, sidebar, setup screen, error/loading states, update banner). The renderer never sees Jira content — Jira runs inside the `WebContentsView` overlaid on top.

### Tests

- `tests/unit.js` is the unit entry — it sequentially calls `runXTests()` from each `*.test.js`. Unit tests use plain Node `assert` and fake collaborators (no Electron).
- `tests/smoke.js` launches the packaged app through Playwright's `_electron` runner, pointing `JIRA_DESKTOP_CONFIG_DIR` at a temp dir and using an unreachable Jira URL so tests never hit the network.

## Conventions and constraints

- **Keep Electron security defaults intact.** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` on every `WebContentsView`. Navigation is restricted by `navigation-policy.js` — add new hosts via `JIRA_ALLOWED_HOSTS`, not by loosening the default list.
- **Main-process modules are factories with injected dependencies** (Electron APIs, `fs`, `path`). Preserve this so the unit tests remain Electron-free.
- **Two serialization shapes** in `tab-manager`: `serializeState(config)` for the renderer (includes config/ui state) vs. `serializePersistedState()` for disk. Don't conflate them.
- **Runtime overrides suppress persistence.** When `rawJiraUrl` is set via CLI/env, `persistSession` is a no-op and the saved session is not restored.
- **New env vars must be documented in `README.md`** (see `CONTRIBUTING.md`).
- **Releases** are tag-driven: push `v<version>` matching `package.json` `version` to trigger `.github/workflows/release.yml`. CI publishes a `.zip` for macOS (GitHub-hosted runners); `.dmg` is local-only via `yarn release-mac`.
