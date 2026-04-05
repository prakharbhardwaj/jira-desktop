const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jiraDesktop", {
  getState: () => ipcRenderer.invoke("shell:get-state"),
  saveWorkspaceUrl: (url) => ipcRenderer.invoke("shell:save-workspace-url", url),
  newTab: (url) => ipcRenderer.send("shell:new-tab", url),
  switchTab: (tabId) => ipcRenderer.send("shell:switch-tab", tabId),
  closeTab: (tabId) => ipcRenderer.send("shell:close-tab", tabId),
  togglePinTab: (tabId) => ipcRenderer.send("shell:toggle-pin-tab", tabId),
  retryActiveTab: () => ipcRenderer.send("shell:retry-active-tab"),
  setSidebarVisible: (visible) => ipcRenderer.send("shell:sidebar-visible", !!visible),
  setTheme: (theme) => ipcRenderer.send("shell:set-theme", theme),
  checkUpdate: () => ipcRenderer.invoke("shell:check-update"),
  openExternal: (url) => ipcRenderer.send("shell:open-external", url),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("shell:state", listener);

    return () => {
      ipcRenderer.removeListener("shell:state", listener);
    };
  }
});
