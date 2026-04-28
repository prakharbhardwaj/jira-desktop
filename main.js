const fs = require("fs");
const https = require("https");
const { app, BrowserWindow, Menu, WebContentsView, clipboard, ipcMain, nativeTheme, session, shell } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");
const { getDevUserDataPath } = require("./main/dev-user-data");

if (!app.isPackaged) {
  const devUserDataPath = getDevUserDataPath({
    appDataPath: app.getPath("appData"),
    appPath: app.getAppPath(),
    configDirectory: process.env.JIRA_DESKTOP_CONFIG_DIR || ""
  });
  app.setPath("userData", devUserDataPath);
}

const { SUPPORTED_PROTOCOL: DEEP_LINK_PROTOCOL, createDeepLinkRouter, findDeepLinkInArgv } = require("./main/deep-link");
const { createNavigationPolicy } = require("./main/navigation-policy");
const { registerShortcutHandler } = require("./main/keyboard-shortcuts");
const { createTabManager } = require("./main/tab-manager");
const { getUpdatePayload } = require("./main/update-check");
const { createWindowShell } = require("./main/window-shell");
const { createWorkspaceConfigStore } = require("./main/workspace-config");

const workspaceConfig = createWorkspaceConfigStore({ app, fs, path });
const runtimeOverrides = workspaceConfig.getRuntimeOverrides();
const TAB_VIEW_BACKGROUND = "#0b1120";

let config = null;
let tabManager = null;
let windowShell = null;
let isQuitting = false;
let pendingDeepLink = null;
let windowReady = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

function getConfig() {
  return config;
}

function createShellUrl() {
  return pathToFileURL(path.join(__dirname, "index.html")).toString();
}

function persistSession({ force = false } = {}) {
  if (!config || !config.jiraUrl || !config.spaceId || runtimeOverrides.rawJiraUrl) {
    return;
  }

  if (isQuitting && !force) {
    return;
  }

  workspaceConfig.writeSpaceSession(config.spaceId, tabManager.serializePersistedState());
}

function getSpaceHomeUrl(spaceId) {
  const space = workspaceConfig.getSpaces().find((entry) => entry.id === spaceId);

  return space ? space.jiraUrl : config ? config.jiraUrl : "";
}

function getSpacePartition(spaceId) {
  const space = workspaceConfig.getSpaces().find((entry) => entry.id === spaceId);

  return space ? workspaceConfig.partitionForSpace(space) : null;
}

function switchSpaceByOffset(offset) {
  if (runtimeOverrides.rawJiraUrl) return;

  const spaces = workspaceConfig.getSpaces();
  if (spaces.length < 2) return;

  const currentIndex = spaces.findIndex((space) => space.id === (config ? config.spaceId : null));
  const nextIndex = ((((currentIndex < 0 ? 0 : currentIndex) + offset) % spaces.length) + spaces.length) % spaces.length;

  switchSpaceById(spaces[nextIndex].id);
}

function switchSpaceByIndex(index) {
  if (runtimeOverrides.rawJiraUrl) return;

  const spaces = workspaceConfig.getSpaces();
  if (index < 0 || index >= spaces.length) return;

  switchSpaceById(spaces[index].id);
}

function switchSpaceById(spaceId) {
  if (!workspaceConfig.setActiveSpace(spaceId)) return;

  config = workspaceConfig.loadConfig();
  hydrateSpace(spaceId, { activate: true });
  if (windowShell) {
    windowShell.refreshShell();
  }
  broadcastSpacesChanged();
}

function runShortcutCommand(command) {
  if (command === "reload-active-tab") {
    tabManager.reloadActiveTab(config ? config.jiraUrl : "");
    return;
  }

  if (command === "force-reload-active-tab") {
    tabManager.reloadActiveTab(config ? config.jiraUrl : "", { ignoreCache: true });
    return;
  }

  if (command === "new-tab") {
    if (config && config.jiraUrl) {
      const spaceId = activeSpaceIdForConfig();

      if (spaceId) {
        tabManager.createTab(config.jiraUrl, {
          activate: true,
          title: "Jira",
          spaceId,
          partition: partitionForSpaceId(spaceId)
        });
      }
    }

    return;
  }

  if (command === "close-active-tab") {
    const activeTab = tabManager.getActiveTab();

    if (activeTab && !activeTab.pinned) {
      tabManager.closeTab(activeTab.id, {
        getHomeUrl: (spaceId) => getSpaceHomeUrl(spaceId)
      });
    }

    return;
  }

  if (command === "switch-space-next") {
    switchSpaceByOffset(1);
    return;
  }

  if (command === "switch-space-prev") {
    switchSpaceByOffset(-1);
    return;
  }

  if (command.startsWith("switch-space-index:")) {
    const index = Number(command.split(":")[1]);

    if (Number.isInteger(index)) {
      switchSpaceByIndex(index);
    }
  }
}

function syncProtocolRegistration(enabled) {
  if (!app.isPackaged) {
    return;
  }

  if (enabled) {
    app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
  } else {
    app.removeAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
  }
}

function handleIncomingDeepLink(rawUrl) {
  if (!rawUrl) {
    return;
  }

  if (!workspaceConfig.readOpenLinksInApp()) {
    return;
  }

  if (!windowReady || !tabManager || !config || !config.jiraUrl) {
    pendingDeepLink = rawUrl;
    return;
  }

  deepLinkRouter.route(rawUrl);
}

function drainPendingDeepLink() {
  if (!pendingDeepLink) {
    return;
  }

  const url = pendingDeepLink;
  pendingDeepLink = null;
  handleIncomingDeepLink(url);
}

const navigationPolicy = createNavigationPolicy({
  Menu,
  clipboard,
  shell,
  getConfig,
  getMainWindow: () => (windowShell ? windowShell.getMainWindow() : null),
  onOpenAllowedLink: (url) => {
    if (tabManager) {
      tabManager.createTab(url, { activate: true });
    }
  }
});

function findSpaceForDeepLink(targetUrl) {
  let targetOrigin;

  try {
    targetOrigin = new URL(targetUrl).origin;
  } catch {
    return null;
  }

  const spaces = workspaceConfig.getSpaces();

  for (const space of spaces) {
    try {
      if (new URL(space.jiraUrl).origin === targetOrigin) {
        return space;
      }
    } catch {
      /* ignore */
    }
  }

  return null;
}

const deepLinkRouter = createDeepLinkRouter({
  isAllowedNavigation: (url) => (windowShell ? navigationPolicy.isAllowedNavigation(url) : false),
  createTab: (url, options) => {
    if (!tabManager || !config) {
      return null;
    }

    const matchedSpace = runtimeOverrides.rawJiraUrl ? null : findSpaceForDeepLink(url);
    let targetSpaceId = activeSpaceIdForConfig();

    if (matchedSpace && matchedSpace.id !== config.spaceId) {
      switchSpaceById(matchedSpace.id);
      targetSpaceId = matchedSpace.id;
    }

    if (!targetSpaceId) {
      return null;
    }

    const tab = tabManager.createTab(url, {
      ...options,
      spaceId: targetSpaceId,
      partition: partitionForSpaceId(targetSpaceId)
    });

    if (windowShell) {
      windowShell.focusMainWindow();
    }

    return tab;
  }
});

tabManager = createTabManager({
  createView: (options) => {
    const view = new WebContentsView(options);
    view.setBackgroundColor(TAB_VIEW_BACKGROUND);
    registerShortcutHandler(view.webContents, runShortcutCommand);
    return view;
  },
  configureSession: navigationPolicy.configureSession,
  isAllowedNavigation: navigationPolicy.isAllowedNavigation,
  normalizeUrl: workspaceConfig.normalizeUrl,
  onBeforeTabClose: (tab) => {
    if (windowShell) {
      windowShell.detachView(tab.view);
    }
  },
  onExternalOpen: (url) => {
    void shell.openExternal(url);
  },
  onStateChanged: () => {
    persistSession();
    if (windowShell) {
      windowShell.refreshShell();
    }
  },
  showContextMenu: navigationPolicy.handleContextMenu
});

windowShell = createWindowShell({
  BrowserWindow,
  configureSession: navigationPolicy.configureSession,
  createShellUrl,
  getActiveTab: tabManager.getActiveTab,
  getConfig,
  iconPath: path.join(__dirname, "build/icon.png"),
  onClosed: () => {
    tabManager.cleanup();
  },
  preloadPath: path.join(__dirname, "preload.js"),
  registerShortcutHandler: (webContents) => registerShortcutHandler(webContents, runShortcutCommand),
  serializeState: () => tabManager.serializeState(config),
  showContextMenu: navigationPolicy.handleContextMenu
});

const RUNTIME_SPACE_ID = "__runtime__";
const hydratedSpaces = new Set();

function activeSpaceIdForConfig() {
  if (!config || !config.jiraUrl) return null;

  return config.spaceId || (runtimeOverrides.rawJiraUrl ? RUNTIME_SPACE_ID : null);
}

function partitionForSpaceId(spaceId) {
  if (!spaceId || spaceId === RUNTIME_SPACE_ID) return null;

  return getSpacePartition(spaceId);
}

function hydrateSpace(spaceId, { activate = false } = {}) {
  if (!spaceId || hydratedSpaces.has(spaceId)) {
    if (activate) {
      tabManager.setActiveSpace(spaceId);
    }

    return;
  }

  hydratedSpaces.add(spaceId);

  const partition = partitionForSpaceId(spaceId);
  let targetUrl = "";

  if (spaceId === RUNTIME_SPACE_ID) {
    targetUrl = config.jiraUrl;
  } else {
    const space = workspaceConfig.getSpaces().find((entry) => entry.id === spaceId);

    if (!space) {
      return;
    }

    targetUrl = space.jiraUrl;

    const savedSession = workspaceConfig.readSpaceSession(spaceId);
    const restored = tabManager.restorePersistedState(spaceId, savedSession, { activate, partition });

    if (restored) {
      if (activate) {
        tabManager.setActiveSpace(spaceId);
      }

      return;
    }
  }

  if (!targetUrl) return;

  tabManager.createTab(targetUrl, {
    activate,
    title: "Jira",
    spaceId,
    partition
  });

  if (activate) {
    tabManager.setActiveSpace(spaceId);
  }
}

async function createWindow() {
  await windowShell.createWindow();

  const spaceId = activeSpaceIdForConfig();

  if (spaceId) {
    hydrateSpace(spaceId, { activate: true });
  }

  windowShell.refreshShell();
  windowReady = true;
  drainPendingDeepLink();
}

ipcMain.handle("shell:get-state", () => tabManager.serializeState(config));
ipcMain.handle("shell:save-workspace-url", (_event, rawJiraUrl) => {
  if (runtimeOverrides.rawJiraUrl) {
    return {
      ok: false,
      error: "Jira Desktop is currently using JIRA_URL or --jira-url, so the workspace cannot be changed from inside the app."
    };
  }

  try {
    const normalizedUrl = workspaceConfig.normalizeUrl((rawJiraUrl || "").trim()).toString();

    workspaceConfig.writeStoredWorkspaceUrl(normalizedUrl);
    config = workspaceConfig.loadConfig();

    const spaceId = activeSpaceIdForConfig();

    if (spaceId && !tabManager.hasTabsForSpace(spaceId)) {
      hydrateSpace(spaceId, { activate: true });
    } else {
      windowShell.refreshShell();
    }

    return {
      ok: true
    };
  } catch (error) {
    config = workspaceConfig.loadConfig({
      setupError: error.message,
      setupValue: (rawJiraUrl || "").trim()
    });
    windowShell.refreshShell();

    return {
      ok: false,
      error: error.message
    };
  }
});

ipcMain.on("shell:new-tab", (_event, targetUrl) => {
  const spaceId = activeSpaceIdForConfig();

  if (!config.jiraUrl || !spaceId) {
    windowShell.sendState();
    return;
  }

  tabManager.createTab(targetUrl || config.jiraUrl, {
    activate: true,
    title: "Jira",
    spaceId,
    partition: partitionForSpaceId(spaceId)
  });
});

ipcMain.on("shell:switch-tab", (_event, tabId) => {
  tabManager.activateTab(tabId);
});

ipcMain.on("shell:close-tab", (_event, tabId) => {
  tabManager.closeTab(tabId, {
    getHomeUrl: (spaceId) => getSpaceHomeUrl(spaceId)
  });
});

ipcMain.on("shell:toggle-pin-tab", (_event, tabId) => {
  tabManager.togglePinTab(tabId);
});

ipcMain.on("shell:reset-pinned-tab", (_event, tabId) => {
  tabManager.resetPinnedTab(tabId);
});

ipcMain.on("shell:retry-active-tab", () => {
  tabManager.reloadActiveTab(config.jiraUrl);
});

ipcMain.on("shell:sidebar-visible", (_event, visible) => {
  windowShell.setSidebarVisible(visible);
});

ipcMain.on("shell:set-theme", (_event, theme) => {
  const mainWindow = windowShell ? windowShell.getMainWindow() : null;
  nativeTheme.themeSource = theme === "light" ? "light" : "dark";
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(theme === "light" ? "#f8fafc" : "#0b1120");
  }
});

ipcMain.on("shell:open-external", (_event, url) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      void shell.openExternal(url);
    }
  } catch {
    // Invalid URL, ignore
  }
});

function checkForUpdates(currentVersion) {
  return new Promise((resolve) => {
    const options = {
      hostname: "api.github.com",
      path: "/repos/prakharbhardwaj/jira-desktop/releases/latest",
      headers: { "User-Agent": "jira-desktop" },
      timeout: 8000
    };

    const req = https.get(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const release = JSON.parse(data);
          resolve(getUpdatePayload(release, currentVersion, process.platform, process.arch));
        } catch {
          resolve({ available: false });
        }
      });
    });

    req.on("error", () => resolve({ available: false }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ available: false });
    });
  });
}

ipcMain.handle("shell:check-update", () => {
  return checkForUpdates(app.getVersion());
});

function serializeSpacesPayload() {
  const activeSpaceId = tabManager ? tabManager.getActiveSpaceId() : null;
  const spaces = workspaceConfig.getSpaces().map((space) => ({
    id: space.id,
    name: space.name,
    accent: space.accent,
    icon: space.icon,
    jiraUrl: space.jiraUrl
  }));

  return {
    activeSpaceId,
    spaces,
    palette: workspaceConfig.ACCENT_PALETTE,
    runtimeOverride: !!runtimeOverrides.rawJiraUrl
  };
}

function broadcastSpacesChanged() {
  const mainWindow = windowShell ? windowShell.getMainWindow() : null;

  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.webContents.send("shell:spaces-changed", serializeSpacesPayload());
}

ipcMain.handle("shell:list-spaces", () => serializeSpacesPayload());

ipcMain.handle("shell:switch-space", (_event, spaceId) => {
  if (runtimeOverrides.rawJiraUrl) {
    return { ok: false, error: "Cannot switch spaces while JIRA_URL/--jira-url is active." };
  }

  if (!workspaceConfig.setActiveSpace(spaceId)) {
    return { ok: false, error: "Unknown space." };
  }

  config = workspaceConfig.loadConfig();
  hydrateSpace(spaceId, { activate: true });
  windowShell.refreshShell();
  broadcastSpacesChanged();

  return { ok: true, ...serializeSpacesPayload() };
});

ipcMain.handle("shell:add-space", (_event, input) => {
  if (runtimeOverrides.rawJiraUrl) {
    return { ok: false, error: "Cannot add spaces while JIRA_URL/--jira-url is active." };
  }

  try {
    const space = workspaceConfig.addSpace(input || {});
    config = workspaceConfig.loadConfig();
    broadcastSpacesChanged();

    return { ok: true, space, ...serializeSpacesPayload() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("shell:update-space", (_event, input) => {
  if (!input || typeof input.id !== "string") {
    return { ok: false, error: "Missing space id." };
  }

  try {
    const space = workspaceConfig.updateSpace(input.id, input.changes || {});

    if (!space) {
      return { ok: false, error: "Unknown space." };
    }

    config = workspaceConfig.loadConfig();
    windowShell.refreshShell();
    broadcastSpacesChanged();

    return { ok: true, space, ...serializeSpacesPayload() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("shell:delete-space", async (_event, spaceId) => {
  if (runtimeOverrides.rawJiraUrl) {
    return { ok: false, error: "Cannot delete spaces while JIRA_URL/--jira-url is active." };
  }

  const spaces = workspaceConfig.getSpaces();
  const target = spaces.find((space) => space.id === spaceId);

  if (!target) {
    return { ok: false, error: "Unknown space." };
  }

  if (spaces.length <= 1) {
    return { ok: false, error: "Cannot remove the last remaining space." };
  }

  tabManager.closeSpaceTabs(spaceId);
  hydratedSpaces.delete(spaceId);

  const partition = workspaceConfig.partitionForSpace(target);

  if (partition) {
    try {
      await session.fromPartition(partition).clearStorageData();
    } catch (error) {
      console.warn("Unable to clear partition storage", error);
    }
  }

  workspaceConfig.removeSpace(spaceId);
  config = workspaceConfig.loadConfig();

  const nextActive = activeSpaceIdForConfig();

  if (nextActive) {
    hydrateSpace(nextActive, { activate: true });
  }

  windowShell.refreshShell();
  broadcastSpacesChanged();

  return { ok: true, ...serializeSpacesPayload() };
});

ipcMain.handle("shell:get-deep-link-setting", () => ({
  enabled: workspaceConfig.readOpenLinksInApp(),
  supported: app.isPackaged
}));

ipcMain.handle("shell:set-deep-link-setting", (_event, enabled) => {
  const next = !!enabled;

  workspaceConfig.writeOpenLinksInApp(next);
  syncProtocolRegistration(next);

  if (next) {
    drainPendingDeepLink();
  }

  return {
    ok: true,
    enabled: next,
    supported: app.isPackaged
  };
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  handleIncomingDeepLink(url);
});

const coldStartDeepLink = findDeepLinkInArgv(process.argv);

if (coldStartDeepLink) {
  pendingDeepLink = coldStartDeepLink;
}

app.whenReady().then(() => {
  config = workspaceConfig.loadConfig();
  syncProtocolRegistration(workspaceConfig.readOpenLinksInApp());
  void createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("second-instance", (_event, argv) => {
  const mainWindow = windowShell ? windowShell.getMainWindow() : null;

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
  }

  const incoming = findDeepLinkInArgv(argv);

  if (incoming) {
    handleIncomingDeepLink(incoming);
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  persistSession({ force: true });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
