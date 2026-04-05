const DEFAULT_TAB_TITLE = "Loading...";
const VIEW_WEB_PREFERENCES = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  spellcheck: true
};

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

function createTabManager({
  createView,
  configureSession,
  isAllowedNavigation,
  normalizeUrl,
  onBeforeTabClose = () => {},
  onExternalOpen,
  onStateChanged = () => {},
  showContextMenu
}) {
  let nextTabId = 1;
  const tabs = new Map();
  let activeTabId = null;

  function getTab(tabId) {
    return tabs.get(tabId) || null;
  }

  function getActiveTab() {
    return getTab(activeTabId);
  }

  function hasTabs() {
    return tabs.size > 0;
  }

  function serializeState(config) {
    return {
      activeTabId,
      setup: {
        required: !config.jiraUrl,
        message: config.setupMessage,
        errorMessage: config.setupError,
        value: config.setupValue
      },
      tabs: Array.from(tabs.values())
        .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
        .map((tab) => ({
          id: tab.id,
          title: tab.title,
          url: tab.url,
          status: tab.status,
          hasLoadedOnce: tab.hasLoadedOnce,
          errorMessage: tab.errorMessage,
          isActive: tab.id === activeTabId,
          isClosable: tabs.size > 1 && !tab.pinned,
          isPinned: tab.pinned
        }))
    };
  }

  function serializePersistedState() {
    const persistedTabs = Array.from(tabs.values()).map((tab) => ({
      url: tab.url,
      title: tab.title,
      pinned: tab.pinned
    }));

    if (persistedTabs.length === 0) {
      return null;
    }

    const activeTabIndex = Array.from(tabs.keys()).findIndex((tabId) => tabId === activeTabId);

    return {
      activeTabIndex: activeTabIndex >= 0 ? activeTabIndex : 0,
      tabs: persistedTabs
    };
  }

  function notifyStateChanged() {
    onStateChanged();
  }

  function activateTab(tabId) {
    if (!tabs.has(tabId)) {
      return;
    }

    activeTabId = tabId;
    notifyStateChanged();
  }

  function loadTab(tab, targetUrl) {
    if (!isAllowedNavigation(targetUrl)) {
      onExternalOpen(targetUrl);
      return;
    }

    tab.url = normalizeUrl(targetUrl).toString();
    tab.errorMessage = "";
    tab.status = tab.hasLoadedOnce ? "ready" : "loading";
    tab.lastLoadFailed = false;

    notifyStateChanged();

    void tab.view.webContents.loadURL(tab.url).catch((error) => {
      tab.status = "error";
      tab.errorMessage = error.message;
      notifyStateChanged();
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
        onExternalOpen(url);
      }

      return { action: "deny" };
    });

    webContents.on("will-navigate", (event, url) => {
      if (!isAllowedNavigation(url)) {
        event.preventDefault();
        onExternalOpen(url);
      }
    });

    webContents.on("did-start-loading", () => {
      tab.status = "loading";
      tab.lastLoadFailed = false;
      notifyStateChanged();
    });

    webContents.on("page-title-updated", (event, title) => {
      event.preventDefault();
      tab.title = title || getFallbackTitle(tab.url);
      notifyStateChanged();
    });

    webContents.on("did-navigate", (_event, url) => {
      tab.url = url;
      tab.errorMessage = "";

      if (!tab.title) {
        tab.title = getFallbackTitle(url);
      }

      notifyStateChanged();
    });

    webContents.on("did-navigate-in-page", (_event, url) => {
      tab.url = url;
      notifyStateChanged();
    });

    webContents.on("did-stop-loading", () => {
      if (tab.lastLoadFailed) {
        notifyStateChanged();
        return;
      }

      tab.hasLoadedOnce = true;
      tab.status = "ready";
      tab.errorMessage = "";
      tab.title = webContents.getTitle() || tab.title || getFallbackTitle(tab.url);
      notifyStateChanged();
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
      notifyStateChanged();
    });
  }

  function createTab(targetUrl, options = {}) {
    const view = createView({
      webPreferences: VIEW_WEB_PREFERENCES
    });

    configureSession(view.webContents.session);

    const tab = {
      id: `tab-${nextTabId++}`,
      view,
      title: options.title || DEFAULT_TAB_TITLE,
      url: normalizeUrl(targetUrl).toString(),
      status: "loading",
      errorMessage: "",
      hasLoadedOnce: false,
      lastLoadFailed: false,
      pinned: !!options.pinned
    };

    tabs.set(tab.id, tab);
    attachTabHandlers(tab);

    if (options.activate !== false) {
      activeTabId = tab.id;
    }

    notifyStateChanged();
    loadTab(tab, tab.url);

    return tab;
  }

  function destroyTabView(tab) {
    onBeforeTabClose(tab);

    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.close();
    }
  }

  function closeTab(tabId, options = {}) {
    const tab = getTab(tabId);

    if (!tab) {
      return;
    }

    if (tab.pinned) {
      return;
    }

    const wasActive = tab.id === activeTabId;

    destroyTabView(tab);
    tabs.delete(tab.id);

    if (tabs.size === 0) {
      activeTabId = null;

      const homeUrl = typeof options.getHomeUrl === "function" ? options.getHomeUrl() : "";

      if (homeUrl) {
        createTab(homeUrl, { activate: true });
      } else {
        notifyStateChanged();
      }

      return;
    }

    if (wasActive) {
      const fallbackTab = Array.from(tabs.values())[Math.max(tabs.size - 1, 0)];
      activeTabId = fallbackTab.id;
    }

    notifyStateChanged();
  }

  function togglePinTab(tabId) {
    const tab = getTab(tabId);
    if (!tab) return;
    tab.pinned = !tab.pinned;
    notifyStateChanged();
  }

  function reloadActiveTab(homeUrl, options = {}) {
    const activeTab = getActiveTab();

    if (activeTab) {
      if (options.ignoreCache) {
        activeTab.status = "loading";
        activeTab.lastLoadFailed = false;
        activeTab.errorMessage = "";
        notifyStateChanged();
        activeTab.view.webContents.reloadIgnoringCache();
        return;
      }

      loadTab(activeTab, activeTab.url || homeUrl);
    }
  }

  function restorePersistedState(sessionState) {
    if (!sessionState || !Array.isArray(sessionState.tabs) || sessionState.tabs.length === 0) {
      return false;
    }

    const activeTabIndex =
      Number.isInteger(sessionState.activeTabIndex) &&
      sessionState.activeTabIndex >= 0 &&
      sessionState.activeTabIndex < sessionState.tabs.length
        ? sessionState.activeTabIndex
        : 0;

    for (const [index, tab] of sessionState.tabs.entries()) {
      if (!tab || typeof tab.url !== "string" || !tab.url.trim()) {
        continue;
      }

      createTab(tab.url, {
        activate: index === activeTabIndex,
        pinned: !!tab.pinned,
        title: typeof tab.title === "string" && tab.title.trim() ? tab.title.trim() : DEFAULT_TAB_TITLE
      });
    }

    if (!activeTabId) {
      const firstTab = Array.from(tabs.values())[0];
      activeTabId = firstTab ? firstTab.id : null;
      notifyStateChanged();
    }

    return hasTabs();
  }

  function cleanup() {
    for (const tab of tabs.values()) {
      if (!tab.view.webContents.isDestroyed()) {
        tab.view.webContents.close();
      }
    }

    tabs.clear();
    activeTabId = null;
  }

  return {
    activateTab,
    cleanup,
    closeTab,
    createTab,
    getActiveTab,
    getTab,
    hasTabs,
    reloadActiveTab,
    restorePersistedState,
    serializeState,
    serializePersistedState,
    togglePinTab
  };
}

module.exports = {
  createTabManager
};
