const { app, BrowserView, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

const DEFAULT_JIRA_URL = "https://c20y.atlassian.net";
const DEFAULT_ALLOWED_HOST_SUFFIXES = [
  ".atlassian.net",
  ".atlassian.com",
  ".jira.com"
];
const TAB_BAR_HEIGHT = 64;
const HIDDEN_VIEW_BOUNDS = { x: 0, y: 0, width: 0, height: 0 };

const configuredSessions = new WeakSet();
let mainWindow = null;
let nextTabId = 1;
const tabs = new Map();
let activeTabId = null;

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

function createConfig() {
  const jiraUrl = normalizeUrl(
    getCliArgument("--jira-url") || process.env.JIRA_URL || DEFAULT_JIRA_URL
  );
  const extraAllowedHosts = (
    getCliArgument("--jira-allowed-hosts") || process.env.JIRA_ALLOWED_HOSTS || ""
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return {
    jiraUrl: jiraUrl.toString(),
    jiraHost: jiraUrl.hostname.toLowerCase(),
    allowedHosts: new Set(extraAllowedHosts)
  };
}

const config = createConfig();

function isConfiguredHost(hostname) {
  const normalizedHost = hostname.toLowerCase();

  if (normalizedHost === config.jiraHost || config.allowedHosts.has(normalizedHost)) {
    return true;
  }

  return DEFAULT_ALLOWED_HOST_SUFFIXES.some((suffix) =>
    normalizedHost.endsWith(suffix)
  );
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

  session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const allowNotifications =
      permission === "notifications" &&
      isAllowedNavigation(details.requestingUrl || "");

    callback(allowNotifications);
  });

  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return permission === "notifications" && isAllowedNavigation(requestingOrigin || "");
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

  const activeTab = getActiveTab();
  const title = activeTab ? `${activeTab.title} - Jira Desktop` : "Jira Desktop";
  mainWindow.setTitle(title);
}

function getContentBounds() {
  const [width, height] = mainWindow.getContentSize();

  return {
    x: 0,
    y: TAB_BAR_HEIGHT,
    width,
    height: Math.max(0, height - TAB_BAR_HEIGHT)
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

  mainWindow.setBrowserView(activeTab.view);
  activeTab.view.setAutoResize({
    width: true,
    height: true
  });

  if (shouldShowOverlay(activeTab)) {
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

  webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) {
        return;
      }

      if (validatedUrl) {
        tab.url = validatedUrl;
      }

      tab.status = "error";
      tab.lastLoadFailed = true;
      tab.errorMessage =
        errorDescription || "Jira could not be reached. Check your connection and try again.";
      tab.title = tab.title || getFallbackTitle(tab.url);
      refreshShell();
    }
  );
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

  tab.view.webContents.destroy();
  tabs.delete(tab.id);

  if (tabs.size === 0) {
    createTab(config.jiraUrl, { activate: true });
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
    backgroundColor: "#0b1220",
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
    mainWindow = null;
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  await mainWindow.loadURL(createShellUrl());
  createTab(config.jiraUrl, { activate: true, title: "Jira" });
  refreshShell();
}

ipcMain.handle("shell:get-state", () => serializeState());

ipcMain.on("shell:new-tab", (_event, targetUrl) => {
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

app.whenReady().then(() => {
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
