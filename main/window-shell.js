const HIDDEN_VIEW_BOUNDS = { x: 0, y: 0, width: 0, height: 0 };
const SIDEBAR_TRIGGER_WIDTH = 6;
const SIDEBAR_WIDTH = 240;

function shouldShowOverlay(tab) {
  return !tab || tab.status === "error" || (tab.status === "loading" && !tab.hasLoadedOnce);
}

function createWindowShell({
  BrowserWindow,
  configureSession,
  createShellUrl,
  getActiveTab,
  getConfig,
  iconPath,
  isZoomShortcut,
  onClosed,
  preloadPath,
  registerShortcutHandler,
  serializeState,
  showContextMenu
}) {
  let mainWindow = null;
  let sidebarVisible = false;
  let attachedView = null;

  function detachAttachedView() {
    if (!mainWindow || mainWindow.isDestroyed() || !attachedView) {
      attachedView = null;
      return;
    }

    try {
      mainWindow.contentView.removeChildView(attachedView);
    } catch {
      // Ignore attempts to detach views that are no longer mounted.
    }

    attachedView = null;
  }

  function getMainWindow() {
    return mainWindow;
  }

  function updateWindowTitle() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    const config = getConfig();

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
      detachAttachedView();
      return;
    }

    if (attachedView !== activeTab.view) {
      detachAttachedView();
      mainWindow.contentView.addChildView(activeTab.view);
      attachedView = activeTab.view;
    }

    if (shouldShowOverlay(activeTab)) {
      activeTab.view.setBounds(HIDDEN_VIEW_BOUNDS);
    } else {
      activeTab.view.setBounds(getContentBounds());
    }
  }

  function sendState() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.webContents.send("shell:state", serializeState());
  }

  function refreshShell() {
    updateWindowTitle();
    updateActiveTabView();
    sendState();
  }

  function setSidebarVisible(visible) {
    sidebarVisible = !!visible;
    updateActiveTabView();
  }

  function focusMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();
  }

  function detachView(view) {
    if (!view || attachedView !== view) {
      return;
    }

    detachAttachedView();
  }

  // Pin the shell renderer (sidebar/setup/overlay UI) at 100% zoom. The Jira
  // WebContentsView is positioned at a fixed SIDEBAR_WIDTH offset in device
  // pixels, so letting the renderer zoom desynchronizes the sidebar from that
  // offset — shrinking it leaves a gap that exposes the window background.
  // Zoom remains available inside the Jira views, which manage it themselves.
  function lockShellZoom(webContents) {
    const resetZoom = () => {
      if (webContents.isDestroyed()) {
        return;
      }

      if (webContents.getZoomLevel() !== 0) {
        webContents.setZoomLevel(0);
      }
    };

    webContents.setVisualZoomLevelLimits(1, 1);
    webContents.on("did-finish-load", resetZoom);
    webContents.on("zoom-changed", resetZoom);
    webContents.on("before-input-event", (event, input) => {
      if (typeof isZoomShortcut === "function" && isZoomShortcut(input)) {
        event.preventDefault();
        resetZoom();
      }
    });
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
        preload: preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: true
      },
      icon: iconPath
    });

    configureSession(mainWindow.webContents.session);
    registerShortcutHandler(mainWindow.webContents);
    lockShellZoom(mainWindow.webContents);
    mainWindow.webContents.on("context-menu", (_event, params) => {
      showContextMenu(mainWindow.webContents, params);
    });

    mainWindow.maximize();
    mainWindow.on("resize", updateActiveTabView);
    mainWindow.on("enter-full-screen", updateActiveTabView);
    mainWindow.on("leave-full-screen", updateActiveTabView);
    mainWindow.on("closed", () => {
      if (typeof onClosed === "function") {
        onClosed();
      }

      detachAttachedView();
      sidebarVisible = false;
      mainWindow = null;
    });
    mainWindow.once("ready-to-show", () => {
      mainWindow.show();
    });

    await mainWindow.loadURL(createShellUrl());

    return mainWindow;
  }

  return {
    createWindow,
    detachView,
    focusMainWindow,
    getMainWindow,
    refreshShell,
    sendState,
    setSidebarVisible,
    updateActiveTabView
  };
}

module.exports = {
  createWindowShell
};
