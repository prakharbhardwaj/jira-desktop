const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jiraDesktop", {
  getState: () => ipcRenderer.invoke("shell:get-state"),
  saveWorkspaceUrl: (url) => ipcRenderer.invoke("shell:save-workspace-url", url),
  listSpaces: () => ipcRenderer.invoke("shell:list-spaces"),
  switchSpace: (spaceId) => ipcRenderer.invoke("shell:switch-space", spaceId),
  addSpace: (input) => ipcRenderer.invoke("shell:add-space", input),
  updateSpace: (input) => ipcRenderer.invoke("shell:update-space", input),
  deleteSpace: (spaceId) => ipcRenderer.invoke("shell:delete-space", spaceId),
  newTab: (url) => ipcRenderer.send("shell:new-tab", url),
  switchTab: (tabId) => ipcRenderer.send("shell:switch-tab", tabId),
  closeTab: (tabId) => ipcRenderer.send("shell:close-tab", tabId),
  togglePinTab: (tabId) => ipcRenderer.send("shell:toggle-pin-tab", tabId),
  resetPinnedTab: (tabId) => ipcRenderer.send("shell:reset-pinned-tab", tabId),
  retryActiveTab: () => ipcRenderer.send("shell:retry-active-tab"),
  setSidebarVisible: (visible) => ipcRenderer.send("shell:sidebar-visible", !!visible),
  setTheme: (theme) => ipcRenderer.send("shell:set-theme", theme),
  checkUpdate: () => ipcRenderer.invoke("shell:check-update"),
  getDeepLinkSetting: () => ipcRenderer.invoke("shell:get-deep-link-setting"),
  setDeepLinkSetting: (enabled) => ipcRenderer.invoke("shell:set-deep-link-setting", !!enabled),
  openExternal: (url) => ipcRenderer.send("shell:open-external", url),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("shell:state", listener);

    return () => {
      ipcRenderer.removeListener("shell:state", listener);
    };
  },
  onSpacesChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("shell:spaces-changed", listener);

    return () => {
      ipcRenderer.removeListener("shell:spaces-changed", listener);
    };
  }
});
