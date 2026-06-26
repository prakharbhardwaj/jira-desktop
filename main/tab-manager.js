const DEFAULT_TAB_TITLE = "Loading...";
const BASE_WEB_PREFERENCES = {
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

function safeOrigin(targetUrl) {
  try {
    return new URL(targetUrl).origin;
  } catch {
    return "";
  }
}

function shouldSpawnOnNavigation(tab, targetUrl) {
  if (!tab.pinned || !tab.pinnedUrl) {
    return false;
  }

  const pinnedOrigin = safeOrigin(tab.pinnedUrl);
  const targetOrigin = safeOrigin(targetUrl);

  if (!pinnedOrigin || !targetOrigin) {
    return false;
  }

  return pinnedOrigin !== targetOrigin;
}

function isPinnedTabDirty(tab) {
  return !!(tab.pinned && tab.pinnedUrl && tab.url && tab.url !== tab.pinnedUrl);
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
  let activeSpaceId = null;
  const activeTabIdBySpace = new Map();

  function getTab(tabId) {
    return tabs.get(tabId) || null;
  }

  function getSpaceTabs(spaceId) {
    return Array.from(tabs.values()).filter((tab) => tab.spaceId === spaceId);
  }

  function getActiveTab() {
    if (!activeSpaceId) return null;

    const tabId = activeTabIdBySpace.get(activeSpaceId);

    return tabId ? getTab(tabId) : null;
  }

  function hasAnyTabs() {
    return tabs.size > 0;
  }

  function hasTabsForSpace(spaceId) {
    return getSpaceTabs(spaceId).length > 0;
  }

  function getActiveSpaceId() {
    return activeSpaceId;
  }

  function serializeState(config) {
    const spaceId = activeSpaceId;
    const activeTabs = spaceId ? getSpaceTabs(spaceId) : [];
    const activeTabId = spaceId ? activeTabIdBySpace.get(spaceId) || null : null;

    return {
      activeSpaceId: spaceId,
      activeTabId,
      setup: {
        required: !config.jiraUrl,
        message: config.setupMessage,
        errorMessage: config.setupError,
        value: config.setupValue
      },
      tabs: activeTabs
        .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
        .map((tab) => ({
          id: tab.id,
          title: tab.title,
          url: tab.url,
          status: tab.status,
          hasLoadedOnce: tab.hasLoadedOnce,
          errorMessage: tab.errorMessage,
          isActive: tab.id === activeTabId,
          isClosable: activeTabs.length > 1 && !tab.pinned,
          isPinned: tab.pinned,
          isPinnedDirty: isPinnedTabDirty(tab)
        }))
    };
  }

  function serializePersistedState(spaceId) {
    const targetSpaceId = spaceId || activeSpaceId;

    if (!targetSpaceId) return null;

    const spaceTabs = getSpaceTabs(targetSpaceId);

    if (spaceTabs.length === 0) return null;

    const activeTabId = activeTabIdBySpace.get(targetSpaceId);
    const activeIndex = spaceTabs.findIndex((tab) => tab.id === activeTabId);

    return {
      activeTabIndex: activeIndex >= 0 ? activeIndex : 0,
      tabs: spaceTabs.map((tab) => ({
        url: tab.pinned && tab.pinnedUrl ? tab.pinnedUrl : tab.url,
        title: tab.title,
        pinned: tab.pinned
      }))
    };
  }

  function notifyStateChanged() {
    onStateChanged();
  }

  function activateTab(tabId) {
    const tab = getTab(tabId);

    if (!tab) return;

    activeTabIdBySpace.set(tab.spaceId, tab.id);

    if (tab.spaceId !== activeSpaceId) {
      activeSpaceId = tab.spaceId;
    }

    notifyStateChanged();
  }

  function setActiveSpace(spaceId) {
    if (activeSpaceId === spaceId) return;

    activeSpaceId = spaceId;
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

    webContents.setWindowOpenHandler(({ url, disposition }) => {
      if (!isAllowedNavigation(url)) {
        onExternalOpen(url);
        return { action: "deny" };
      }

      // Real popups (window.open with window features → "new-window") must open
      // as a child window so the window.opener relationship survives. OAuth flows
      // such as Jira's "Create branch" GitHub login post their result back to the
      // opener and call window.close(); a separate tab has no opener and would
      // hang, and denying makes window.open() return null ("popup blocked").
      if (disposition === "new-window") {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            webPreferences: tab.partition ? { ...BASE_WEB_PREFERENCES, partition: tab.partition } : { ...BASE_WEB_PREFERENCES }
          }
        };
      }

      // target=_blank / modified-click links open as a new in-app tab.
      createTab(url, { activate: true, spaceId: tab.spaceId, partition: tab.partition });
      return { action: "deny" };
    });

    webContents.on("did-create-window", (childWindow) => {
      const childContents = childWindow.webContents;

      configureSession(childContents.session);

      childContents.setWindowOpenHandler(({ url }) => {
        if (isAllowedNavigation(url)) {
          return { action: "allow" };
        }

        onExternalOpen(url);
        return { action: "deny" };
      });

      childContents.on("will-navigate", (event, url) => {
        if (!isAllowedNavigation(url)) {
          event.preventDefault();
          onExternalOpen(url);
        }
      });
    });

    webContents.on("will-navigate", (event, url) => {
      if (!isAllowedNavigation(url)) {
        event.preventDefault();
        onExternalOpen(url);
        return;
      }

      if (shouldSpawnOnNavigation(tab, url)) {
        event.preventDefault();
        createTab(url, { activate: true, spaceId: tab.spaceId, partition: tab.partition });
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
    const spaceId = options.spaceId || activeSpaceId;

    if (!spaceId) {
      return null;
    }

    const partition = options.partition || null;
    const viewWebPreferences = partition ? { ...BASE_WEB_PREFERENCES, partition } : { ...BASE_WEB_PREFERENCES };
    const view = createView({ webPreferences: viewWebPreferences });

    configureSession(view.webContents.session);

    const normalizedUrl = normalizeUrl(targetUrl).toString();
    const tab = {
      id: `tab-${nextTabId++}`,
      spaceId,
      partition,
      view,
      title: options.title || DEFAULT_TAB_TITLE,
      url: normalizedUrl,
      status: "loading",
      errorMessage: "",
      hasLoadedOnce: false,
      lastLoadFailed: false,
      pinned: !!options.pinned,
      pinnedUrl: options.pinned ? normalizedUrl : ""
    };

    tabs.set(tab.id, tab);
    attachTabHandlers(tab);

    if (options.activate !== false) {
      activeTabIdBySpace.set(spaceId, tab.id);

      if (!activeSpaceId) {
        activeSpaceId = spaceId;
      }
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

    if (!tab) return;
    if (tab.pinned) return;

    const spaceId = tab.spaceId;
    const wasActiveInSpace = activeTabIdBySpace.get(spaceId) === tab.id;

    destroyTabView(tab);
    tabs.delete(tab.id);

    const remaining = getSpaceTabs(spaceId);

    if (remaining.length === 0) {
      activeTabIdBySpace.delete(spaceId);

      const homeUrl = typeof options.getHomeUrl === "function" ? options.getHomeUrl(spaceId) : "";

      if (homeUrl) {
        createTab(homeUrl, {
          activate: spaceId === activeSpaceId,
          spaceId,
          partition: tab.partition
        });
      } else {
        notifyStateChanged();
      }

      return;
    }

    if (wasActiveInSpace) {
      activeTabIdBySpace.set(spaceId, remaining[remaining.length - 1].id);
    }

    notifyStateChanged();
  }

  function togglePinTab(tabId) {
    const tab = getTab(tabId);
    if (!tab) return;

    if (tab.pinned) {
      tab.pinned = false;
      tab.pinnedUrl = "";
    } else {
      tab.pinned = true;
      tab.pinnedUrl = tab.url;
    }

    notifyStateChanged();
  }

  function reloadActiveTab(homeUrl, options = {}) {
    const activeTab = getActiveTab();

    if (!activeTab) return;

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

  function resetPinnedTab(tabId) {
    const tab = getTab(tabId);

    if (!tab || !tab.pinned || !tab.pinnedUrl) {
      return;
    }

    loadTab(tab, tab.pinnedUrl);
  }

  function restorePersistedState(spaceId, sessionState, options = {}) {
    if (!spaceId) return false;
    if (!sessionState || !Array.isArray(sessionState.tabs) || sessionState.tabs.length === 0) {
      return false;
    }

    const activeTabIndex =
      Number.isInteger(sessionState.activeTabIndex) && sessionState.activeTabIndex >= 0 && sessionState.activeTabIndex < sessionState.tabs.length
        ? sessionState.activeTabIndex
        : 0;

    for (const [index, tab] of sessionState.tabs.entries()) {
      if (!tab || typeof tab.url !== "string" || !tab.url.trim()) {
        continue;
      }

      createTab(tab.url, {
        activate: index === activeTabIndex && options.activate !== false,
        partition: options.partition,
        pinned: !!tab.pinned,
        spaceId,
        title: typeof tab.title === "string" && tab.title.trim() ? tab.title.trim() : DEFAULT_TAB_TITLE
      });
    }

    if (!activeTabIdBySpace.has(spaceId)) {
      const spaceTabs = getSpaceTabs(spaceId);

      if (spaceTabs.length > 0) {
        activeTabIdBySpace.set(spaceId, spaceTabs[0].id);
      }
    }

    if (!activeSpaceId && options.activate !== false) {
      activeSpaceId = spaceId;
    }

    return hasTabsForSpace(spaceId);
  }

  function closeSpaceTabs(spaceId) {
    for (const tab of getSpaceTabs(spaceId)) {
      destroyTabView(tab);
      tabs.delete(tab.id);
    }

    activeTabIdBySpace.delete(spaceId);

    if (activeSpaceId === spaceId) {
      activeSpaceId = null;
    }

    notifyStateChanged();
  }

  function cleanup() {
    for (const tab of tabs.values()) {
      if (!tab.view.webContents.isDestroyed()) {
        tab.view.webContents.close();
      }
    }

    tabs.clear();
    activeTabIdBySpace.clear();
    activeSpaceId = null;
  }

  return {
    activateTab,
    cleanup,
    closeSpaceTabs,
    closeTab,
    createTab,
    getActiveSpaceId,
    getActiveTab,
    getTab,
    hasTabs: hasAnyTabs,
    hasTabsForSpace,
    reloadActiveTab,
    resetPinnedTab,
    restorePersistedState,
    serializePersistedState,
    serializeState,
    setActiveSpace,
    togglePinTab
  };
}

module.exports = {
  createTabManager
};
