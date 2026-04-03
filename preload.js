const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jiraDesktop", {
  getState: () => ipcRenderer.invoke("shell:get-state"),
  newTab: (url) => ipcRenderer.send("shell:new-tab", url),
  switchTab: (tabId) => ipcRenderer.send("shell:switch-tab", tabId),
  closeTab: (tabId) => ipcRenderer.send("shell:close-tab", tabId),
  retryActiveTab: () => ipcRenderer.send("shell:retry-active-tab"),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("shell:state", listener);

    return () => {
      ipcRenderer.removeListener("shell:state", listener);
    };
  }
});
