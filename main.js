const fs = require("fs");
const https = require("https");
const { app, BrowserWindow, Menu, WebContentsView, clipboard, ipcMain, nativeTheme, shell } = require("electron");
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

const { createNavigationPolicy } = require("./main/navigation-policy");
const { registerShortcutHandler } = require("./main/keyboard-shortcuts");
const { createTabManager } = require("./main/tab-manager");
const { createWindowShell } = require("./main/window-shell");
const { createWorkspaceConfigStore } = require("./main/workspace-config");

const workspaceConfig = createWorkspaceConfigStore({ app, fs, path });
const runtimeOverrides = workspaceConfig.getRuntimeOverrides();
const TAB_VIEW_BACKGROUND = "#0b1120";

let config = null;
let tabManager = null;
let windowShell = null;

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

function persistSession() {
  if (!config || !config.jiraUrl || runtimeOverrides.rawJiraUrl) {
    return;
  }

  workspaceConfig.writeStoredSession(config.jiraUrl, tabManager.serializePersistedState());
}

function runShortcutCommand(command) {
  switch (command) {
    case "reload-active-tab":
      tabManager.reloadActiveTab(config ? config.jiraUrl : "");
      return;
    case "force-reload-active-tab":
      tabManager.reloadActiveTab(config ? config.jiraUrl : "", { ignoreCache: true });
      return;
    case "new-tab":
      if (config && config.jiraUrl) {
        tabManager.createTab(config.jiraUrl, { activate: true, title: "Jira" });
      }
      return;
    case "close-active-tab": {
      const activeTab = tabManager.getActiveTab();

      if (activeTab && !activeTab.pinned) {
        tabManager.closeTab(activeTab.id, {
          getHomeUrl: () => (config ? config.jiraUrl : "")
        });
      }
      return;
    }
    default:
  }
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

async function createWindow() {
  await windowShell.createWindow();

  if (config.jiraUrl) {
    const restoredSession = runtimeOverrides.rawJiraUrl ? null : workspaceConfig.readStoredSession(config.jiraUrl);

    if (!tabManager.restorePersistedState(restoredSession)) {
      tabManager.createTab(config.jiraUrl, { activate: true, title: "Jira" });
    }
  }

  windowShell.refreshShell();
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

    if (!tabManager.hasTabs()) {
      tabManager.createTab(config.jiraUrl, { activate: true, title: "Jira" });
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
  if (!config.jiraUrl) {
    windowShell.sendState();
    return;
  }

  tabManager.createTab(targetUrl || config.jiraUrl, { activate: true, title: "Jira" });
});

ipcMain.on("shell:switch-tab", (_event, tabId) => {
  tabManager.activateTab(tabId);
});

ipcMain.on("shell:close-tab", (_event, tabId) => {
  tabManager.closeTab(tabId, {
    getHomeUrl: () => config.jiraUrl
  });
});

ipcMain.on("shell:toggle-pin-tab", (_event, tabId) => {
  tabManager.togglePinTab(tabId);
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

function compareVersions(latest, current) {
  const a = latest.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

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
          const latestVersion = (release.tag_name || "").replace(/^v/, "");
          if (latestVersion && compareVersions(latestVersion, currentVersion)) {
            resolve({ available: true, version: latestVersion, url: release.html_url });
          } else {
            resolve({ available: false });
          }
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

app.whenReady().then(() => {
  config = workspaceConfig.loadConfig();
  void createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("second-instance", () => {
  const mainWindow = windowShell ? windowShell.getMainWindow() : null;

  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.focus();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
