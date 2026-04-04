const fs = require("fs");
const { app, BrowserWindow, Menu, WebContentsView, clipboard, ipcMain, shell } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

const { createNavigationPolicy } = require("./main/navigation-policy");
const { createTabManager } = require("./main/tab-manager");
const { createWindowShell } = require("./main/window-shell");
const { createWorkspaceConfigStore } = require("./main/workspace-config");

const workspaceConfig = createWorkspaceConfigStore({ app, fs, path });
const runtimeOverrides = workspaceConfig.getRuntimeOverrides();

let config = null;
let tabManager = null;
let windowShell = null;

function getConfig() {
  return config;
}

function createShellUrl() {
  return pathToFileURL(path.join(__dirname, "index.html")).toString();
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
    view.setBackgroundColor("#00000000");
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
  serializeState: () => tabManager.serializeState(config),
  showContextMenu: navigationPolicy.handleContextMenu
});

async function createWindow() {
  await windowShell.createWindow();

  if (config.jiraUrl) {
    tabManager.createTab(config.jiraUrl, { activate: true, title: "Jira" });
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

ipcMain.on("shell:retry-active-tab", () => {
  tabManager.retryActiveTab(config.jiraUrl);
});

ipcMain.on("shell:sidebar-visible", (_event, visible) => {
  windowShell.setSidebarVisible(visible);
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
