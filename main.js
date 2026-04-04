const fs = require("fs");
const { app, BrowserView, BrowserWindow, Menu, clipboard, ipcMain, shell } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

const DEFAULT_ALLOWED_HOST_SUFFIXES = [".atlassian.net", ".atlassian.com", ".jira.com"];
const SIDEBAR_WIDTH = 220;
const SIDEBAR_TRIGGER_WIDTH = 6;
const HIDDEN_VIEW_BOUNDS = { x: -2, y: 0, width: 1, height: 1 };
const WORKSPACE_CONFIG_FILENAME = "workspace.json";
const DEFAULT_SETUP_MESSAGE = "Enter the Jira URL you want to use and Jira Desktop will remember it on this device.";

const configuredSessions = new WeakSet();
let mainWindow = null;
let nextTabId = 1;
const tabs = new Map();
let activeTabId = null;
let sidebarVisible = false;
let attachedBrowserView = null;
let config = null;

function getCliArgument(name) {
  const prefix = `${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));

  return argument ? argument.slice(prefix.length) : "";
}

function normalizeUrl(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);

    if (parsedUrl.protocol !== "https:") {
      throw new Error("Jira URL must use HTTPS.");
    }

    return parsedUrl;
  } catch (error) {
    throw new Error(`Invalid JIRA_URL: ${error.message}`);
  }
}

function getRuntimeOverrides() {
  const rawJiraUrl = (getCliArgument("--jira-url") || process.env.JIRA_URL || "").trim();
  const allowedHosts = (getCliArgument("--jira-allowed-hosts") || process.env.JIRA_ALLOWED_HOSTS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return {
    rawJiraUrl,
    allowedHosts
  };
}

const runtimeOverrides = getRuntimeOverrides();

function createConfigState(options = {}) {
  const {
    jiraUrl = "",
    setupMessage = DEFAULT_SETUP_MESSAGE,
    setupError = "",
    setupValue = "",
    workspaceSource = "none"
  } = options;

  if (!jiraUrl) {
    return {
      jiraUrl: "",
      jiraHost: "",
      allowedHosts: new Set(runtimeOverrides.allowedHosts),
      setupMessage,
      setupError,
      setupValue,
      workspaceSource
    };
  }

  const normalizedUrl = normalizeUrl(jiraUrl);

  return {
    jiraUrl: normalizedUrl.toString(),
    jiraHost: normalizedUrl.hostname.toLowerCase(),
    allowedHosts: new Set(runtimeOverrides.allowedHosts),
    setupMessage: "",
    setupError,
    setupValue: normalizedUrl.toString(),
    workspaceSource
  };
}

function getWorkspaceConfigPath() {
  const storageDirectory = process.env.JIRA_DESKTOP_CONFIG_DIR || app.getPath("userData");

  return path.join(storageDirectory, WORKSPACE_CONFIG_FILENAME);
}

function readStoredWorkspaceUrl() {
  const configPath = getWorkspaceConfigPath();

  try {
    const rawFile = fs.readFileSync(configPath, "utf8");
    const parsedFile = JSON.parse(rawFile);

    return typeof parsedFile.jiraUrl === "string" ? parsedFile.jiraUrl.trim() : "";
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Unable to read ${configPath}:`, error);
    }

    return "";
  }
}

function writeStoredWorkspaceUrl(jiraUrl) {
  const configPath = getWorkspaceConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ jiraUrl }, null, 2));
}

function loadConfig(options = {}) {
  const { setupError = "", setupValue = "" } = options;
  const rawJiraUrl = runtimeOverrides.rawJiraUrl || readStoredWorkspaceUrl();
  const workspaceSource = runtimeOverrides.rawJiraUrl ? "runtime" : rawJiraUrl ? "saved" : "none";

  if (!rawJiraUrl) {
    return createConfigState({
      setupError,
      setupValue,
      workspaceSource
    });
  }

  try {
    return createConfigState({
      jiraUrl: rawJiraUrl,
      setupError,
      workspaceSource
    });
  } catch (error) {
    return createConfigState({
      setupError: setupError || error.message,
      setupValue: setupValue || rawJiraUrl,
      workspaceSource
    });
  }
}

function isConfiguredHost(hostname) {
  if (!config.jiraHost) {
    return false;
  }

  const normalizedHost = hostname.toLowerCase();

  if (normalizedHost === config.jiraHost || config.allowedHosts.has(normalizedHost)) {
    return true;
  }

  return DEFAULT_ALLOWED_HOST_SUFFIXES.some((suffix) => normalizedHost.endsWith(suffix));
}

function isAllowedNavigation(targetUrl) {
  try {
    const parsedUrl = new URL(targetUrl);

    return parsedUrl.protocol === "https:" && isConfiguredHost(parsedUrl.hostname);
  } catch {
    return false;
  }
}

function createShellUrl() {
  return pathToFileURL(path.join(__dirname, "index.html")).toString();
}

function configureSession(session) {
  if (configuredSessions.has(session)) {
    return;
  }

  configuredSessions.add(session);

  const isAllowedPermission = (permission, origin) => {
    if (permission === "clipboard-sanitized-write" || permission === "clipboard-read") {
      return isAllowedNavigation(origin || "");
    }

    return permission === "notifications" && isAllowedNavigation(origin || "");
  };

  session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(isAllowedPermission(permission, details.requestingUrl || ""));
  });

  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return isAllowedPermission(permission, requestingOrigin || "");
  });
}

function showContextMenu(webContents, params) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const template = [];
  const hasEditableActions =
    params.isEditable ||
    params.editFlags.canCopy ||
    params.editFlags.canPaste ||
    params.editFlags.canCut ||
    params.editFlags.canSelectAll;

  if (params.linkURL) {
    if (isAllowedNavigation(params.linkURL)) {
      template.push({
        label: "Open Link in New Tab",
        click: () => {
          createTab(params.linkURL, { activate: true });
        }
      });
    }

    template.push(
      {
        label: "Open Link Externally",
        click: () => {
          shell.openExternal(params.linkURL);
        }
      },
      {
        label: "Copy Link",
        click: () => {
          clipboard.writeText(params.linkURL);
        }
      }
    );
  }

  if (params.selectionText && params.editFlags.canCopy) {
    template.push({
      label: "Copy",
      role: "copy"
    });
  }

  if (hasEditableActions) {
    if (template.length > 0) {
      template.push({ type: "separator" });
    }

    template.push(
      {
        label: "Undo",
        role: "undo",
        enabled: params.editFlags.canUndo
      },
      {
        label: "Redo",
        role: "redo",
        enabled: params.editFlags.canRedo
      },
      { type: "separator" },
      {
        label: "Cut",
        role: "cut",
        enabled: params.isEditable && params.editFlags.canCut
      },
      {
        label: "Copy",
        role: "copy",
        enabled: params.editFlags.canCopy
      },
      {
        label: "Paste",
        role: "paste",
        enabled: params.isEditable && params.editFlags.canPaste
      },
      {
        label: "Select All",
        role: "selectAll",
        enabled: params.editFlags.canSelectAll
      }
    );
  }

  if (template.length === 0) {
    return;
  }

  Menu.buildFromTemplate(template).popup({
    window: mainWindow,
    frame: params.frame,
    x: params.x,
    y: params.y,
    sourceType: params.menuSourceType
  });
}

function getFallbackTitle(targetUrl) {
  try {
    const parsedUrl = new URL(targetUrl);
    const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
    const lastSegment = pathSegments[pathSegments.length - 1];

    if (lastSegment) {
      return decodeURIComponent(lastSegment).replace(/[-_]+/g, " ");
    }

    return parsedUrl.hostname;
  } catch {
    return "Jira";
  }
}

function getTab(tabId) {
  return tabs.get(tabId) || null;
}

function getActiveTab() {
  return getTab(activeTabId);
}

function shouldShowOverlay(tab) {
  return !tab || tab.status === "error" || (tab.status === "loading" && !tab.hasLoadedOnce);
}

function serializeState() {
  return {
    activeTabId,
    setup: {
      required: !config.jiraUrl,
      message: config.setupMessage,
      errorMessage: config.setupError,
      value: config.setupValue
    },
    tabs: Array.from(tabs.values()).map((tab) => ({
      id: tab.id,
      title: tab.title,
      url: tab.url,
      status: tab.status,
      hasLoadedOnce: tab.hasLoadedOnce,
      errorMessage: tab.errorMessage,
      isActive: tab.id === activeTabId,
      isClosable: tabs.size > 1
    }))
  };
}

function sendState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("shell:state", serializeState());
}

function updateWindowTitle() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (!config.jiraUrl) {
    mainWindow.setTitle("Set up Jira Desktop");
    return;
  }

  const activeTab = getActiveTab();
  const title = activeTab ? `${activeTab.title} - Jira Desktop` : "Jira Desktop";
  mainWindow.setTitle(title);
}

function getContentBounds() {
  const [width, height] = mainWindow.getContentSize();
  const xOffset = sidebarVisible ? SIDEBAR_WIDTH : SIDEBAR_TRIGGER_WIDTH;

  return {
    x: xOffset,
    y: 0,
    width: Math.max(0, width - xOffset),
    height
  };
}

function updateActiveTabView() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const activeTab = getActiveTab();

  if (!activeTab) {
    return;
  }

  if (attachedBrowserView !== activeTab.view) {
    mainWindow.setBrowserView(activeTab.view);
    attachedBrowserView = activeTab.view;
  }

  activeTab.view.setAutoResize({
    width: true,
    height: true
  });

  if (shouldShowOverlay(activeTab)) {
    // Parking the view offscreen avoids zero-sized compositor surfaces,
    // which reduces Chromium mailbox warnings on macOS.
    activeTab.view.setBounds(HIDDEN_VIEW_BOUNDS);
  } else {
    activeTab.view.setBounds(getContentBounds());
  }
}

function refreshShell() {
  updateWindowTitle();
  updateActiveTabView();
  sendState();
}

function activateTab(tabId) {
  if (!tabs.has(tabId)) {
    return;
  }

  activeTabId = tabId;
  refreshShell();
}

function loadTab(tab, targetUrl) {
  if (!isAllowedNavigation(targetUrl)) {
    shell.openExternal(targetUrl);
    return;
  }

  tab.url = normalizeUrl(targetUrl).toString();
  tab.errorMessage = "";
  tab.status = tab.hasLoadedOnce ? "ready" : "loading";
  tab.lastLoadFailed = false;

  refreshShell();
  void tab.view.webContents.loadURL(tab.url).catch((error) => {
    tab.status = "error";
    tab.errorMessage = error.message;
    refreshShell();
  });
}

function attachTabHandlers(tab) {
  const { webContents } = tab.view;

  webContents.on("context-menu", (_event, params) => {
    showContextMenu(webContents, params);
  });

  webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedNavigation(url)) {
      createTab(url, { activate: true });
    } else {
      shell.openExternal(url);
    }

    return { action: "deny" };
  });

  webContents.on("will-navigate", (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  webContents.on("did-start-loading", () => {
    tab.status = "loading";
    tab.lastLoadFailed = false;
    refreshShell();
  });

  webContents.on("page-title-updated", (event, title) => {
    event.preventDefault();
    tab.title = title || getFallbackTitle(tab.url);
    refreshShell();
  });

  webContents.on("did-navigate", (_event, url) => {
    tab.url = url;
    tab.errorMessage = "";
    if (!tab.title) {
      tab.title = getFallbackTitle(url);
    }
    refreshShell();
  });

  webContents.on("did-navigate-in-page", (_event, url) => {
    tab.url = url;
    refreshShell();
  });

  webContents.on("did-stop-loading", () => {
    if (tab.lastLoadFailed) {
      refreshShell();
      return;
    }

    tab.hasLoadedOnce = true;
    tab.status = "ready";
    tab.errorMessage = "";
    tab.title = webContents.getTitle() || tab.title || getFallbackTitle(tab.url);
    refreshShell();
  });

  webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) {
      return;
    }

    if (validatedUrl) {
      tab.url = validatedUrl;
    }

    tab.status = "error";
    tab.lastLoadFailed = true;
    tab.errorMessage = errorDescription || "Jira could not be reached. Check your connection and try again.";
    tab.title = tab.title || getFallbackTitle(tab.url);
    refreshShell();
  });
}

function createTab(targetUrl, options = {}) {
  const browserView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true
    }
  });

  configureSession(browserView.webContents.session);

  const tab = {
    id: `tab-${nextTabId++}`,
    view: browserView,
    title: options.title || "Loading...",
    url: normalizeUrl(targetUrl).toString(),
    status: "loading",
    errorMessage: "",
    hasLoadedOnce: false,
    lastLoadFailed: false
  };

  tabs.set(tab.id, tab);
  attachTabHandlers(tab);

  if (options.activate !== false) {
    activeTabId = tab.id;
  }

  refreshShell();
  loadTab(tab, tab.url);

  return tab;
}

function closeTab(tabId) {
  const tab = getTab(tabId);

  if (!tab) {
    return;
  }

  const wasActive = tab.id === activeTabId;

  if (attachedBrowserView === tab.view) {
    attachedBrowserView = null;
  }

  tab.view.webContents.destroy();
  tabs.delete(tab.id);

  if (tabs.size === 0) {
    activeTabId = null;

    if (config.jiraUrl) {
      createTab(config.jiraUrl, { activate: true });
    } else {
      refreshShell();
    }

    return;
  }

  if (wasActive) {
    const fallbackTab = Array.from(tabs.values())[Math.max(tabs.size - 1, 0)];
    activeTabId = fallbackTab.id;
  }

  refreshShell();
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0b1120",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true
    },
    icon: path.join(__dirname, "build/icon.png")
  });

  configureSession(mainWindow.webContents.session);
  mainWindow.webContents.on("context-menu", (_event, params) => {
    showContextMenu(mainWindow.webContents, params);
  });

  mainWindow.maximize();
  mainWindow.on("resize", updateActiveTabView);
  mainWindow.on("enter-full-screen", updateActiveTabView);
  mainWindow.on("leave-full-screen", updateActiveTabView);
  mainWindow.on("closed", () => {
    for (const tab of tabs.values()) {
      if (!tab.view.webContents.isDestroyed()) {
        tab.view.webContents.destroy();
      }
    }

    tabs.clear();
    activeTabId = null;
    attachedBrowserView = null;
    mainWindow = null;
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  await mainWindow.loadURL(createShellUrl());

  if (config.jiraUrl) {
    createTab(config.jiraUrl, { activate: true, title: "Jira" });
  }

  refreshShell();
}

ipcMain.handle("shell:get-state", () => serializeState());
ipcMain.handle("shell:save-workspace-url", (_event, rawJiraUrl) => {
  if (runtimeOverrides.rawJiraUrl) {
    return {
      ok: false,
      error: "Jira Desktop is currently using JIRA_URL or --jira-url, so the workspace cannot be changed from inside the app."
    };
  }

  try {
    const normalizedUrl = normalizeUrl((rawJiraUrl || "").trim()).toString();
    writeStoredWorkspaceUrl(normalizedUrl);
    config = loadConfig();

    if (tabs.size === 0) {
      createTab(config.jiraUrl, { activate: true, title: "Jira" });
    } else {
      refreshShell();
    }

    return {
      ok: true
    };
  } catch (error) {
    config = loadConfig({
      setupError: error.message,
      setupValue: (rawJiraUrl || "").trim()
    });
    refreshShell();

    return {
      ok: false,
      error: error.message
    };
  }
});

ipcMain.on("shell:new-tab", (_event, targetUrl) => {
  if (!config.jiraUrl) {
    sendState();
    return;
  }

  createTab(targetUrl || config.jiraUrl, { activate: true, title: "Jira" });
});

ipcMain.on("shell:switch-tab", (_event, tabId) => {
  activateTab(tabId);
});

ipcMain.on("shell:close-tab", (_event, tabId) => {
  closeTab(tabId);
});

ipcMain.on("shell:retry-active-tab", () => {
  const activeTab = getActiveTab();

  if (activeTab) {
    loadTab(activeTab, activeTab.url || config.jiraUrl);
  }
});

ipcMain.on("shell:sidebar-visible", (_event, visible) => {
  sidebarVisible = !!visible;
  updateActiveTabView();
});

app.whenReady().then(() => {
  config = loadConfig();
  void createWindow();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});
