const assert = require("assert");

const { createTabManager } = require("../main/tab-manager");

function createFakeWebContents() {
  const listeners = new Map();
  return {
    _windowOpenHandler: null,
    on(event, handler) {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event).push(handler);
    },
    emit(event, ...args) {
      for (const handler of listeners.get(event) || []) {
        handler(...args);
      }
    },
    setWindowOpenHandler(handler) {
      this._windowOpenHandler = handler;
    },
    loadURL() {
      return Promise.resolve();
    },
    close() {},
    isDestroyed() {
      return false;
    },
    getTitle() {
      return "";
    },
    reloadIgnoringCache() {},
    session: {}
  };
}

function createFakeEvent() {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    }
  };
}

function createHarness() {
  const externalOpens = [];

  const tabManager = createTabManager({
    createView: () => ({
      webContents: createFakeWebContents(),
      setBackgroundColor() {}
    }),
    configureSession: () => {},
    isAllowedNavigation: (targetUrl) => {
      try {
        return new URL(targetUrl).protocol === "https:";
      } catch {
        return false;
      }
    },
    normalizeUrl: (value) => new URL(value),
    onExternalOpen: (url) => externalOpens.push(url),
    onStateChanged: () => {},
    showContextMenu: () => {}
  });

  return { tabManager, externalOpens };
}

function runTabManagerTests() {
  // Row 1: same-origin + same path in pinned tab stays in pinned tab.
  {
    const { tabManager } = createHarness();
    const pinnedTab = tabManager.createTab("https://example.atlassian.net/jira/your-work", { pinned: true });
    const event = createFakeEvent();
    pinnedTab.view.webContents.emit("will-navigate", event, "https://example.atlassian.net/jira/your-work");
    assert.strictEqual(event.defaultPrevented, false);
    assert.strictEqual(tabManager.serializeState({}).tabs.length, 1);
  }

  // Row 2: same-origin different path stays in pinned tab.
  {
    const { tabManager } = createHarness();
    const pinnedTab = tabManager.createTab("https://example.atlassian.net/jira/your-work", { pinned: true });
    const event = createFakeEvent();
    pinnedTab.view.webContents.emit("will-navigate", event, "https://example.atlassian.net/browse/ABC-1");
    assert.strictEqual(event.defaultPrevented, false);
    assert.strictEqual(tabManager.serializeState({}).tabs.length, 1);
    assert.strictEqual(pinnedTab.pinnedUrl, "https://example.atlassian.net/jira/your-work");
  }

  // Row 3: cross-origin allow-listed nav spawns a new unpinned tab; pinnedUrl unchanged.
  {
    const { tabManager } = createHarness();
    const pinnedTab = tabManager.createTab("https://example.atlassian.net/jira/your-work", { pinned: true });
    const event = createFakeEvent();
    pinnedTab.view.webContents.emit("will-navigate", event, "https://id.atlassian.com/login");
    assert.strictEqual(event.defaultPrevented, true);

    const state = tabManager.serializeState({});
    assert.strictEqual(state.tabs.length, 2);
    const spawned = state.tabs.find((t) => !t.isPinned);
    assert.ok(spawned, "cross-origin navigation should spawn an unpinned tab");
    assert.strictEqual(spawned.url, "https://id.atlassian.com/login");
    assert.strictEqual(pinnedTab.pinnedUrl, "https://example.atlassian.net/jira/your-work");
    assert.strictEqual(pinnedTab.url, "https://example.atlassian.net/jira/your-work");
  }

  // Row 4: disallowed navigation in pinned tab delegates to onExternalOpen.
  {
    const { tabManager, externalOpens } = createHarness();
    const pinnedTab = tabManager.createTab("https://example.atlassian.net/jira/your-work", { pinned: true });
    const event = createFakeEvent();
    pinnedTab.view.webContents.emit("will-navigate", event, "http://malicious.example.com/");
    assert.strictEqual(event.defaultPrevented, true);
    assert.deepStrictEqual(externalOpens, ["http://malicious.example.com/"]);
  }

  // Unpinned tabs never get the cross-origin spawn behavior.
  {
    const { tabManager } = createHarness();
    const tab = tabManager.createTab("https://example.atlassian.net/jira/your-work");
    const event = createFakeEvent();
    tab.view.webContents.emit("will-navigate", event, "https://id.atlassian.com/login");
    assert.strictEqual(event.defaultPrevented, false);
    assert.strictEqual(tabManager.serializeState({}).tabs.length, 1);
  }

  // Persistence: pinned tabs serialize their pinnedUrl, not the last navigated URL.
  {
    const { tabManager } = createHarness();
    const pinnedTab = tabManager.createTab("https://example.atlassian.net/jira/your-work", { pinned: true });
    pinnedTab.url = "https://example.atlassian.net/browse/ABC-1";
    const persisted = tabManager.serializePersistedState();
    assert.strictEqual(persisted.tabs[0].url, "https://example.atlassian.net/jira/your-work");
    assert.strictEqual(persisted.tabs[0].pinned, true);
  }

  // togglePinTab captures the current URL as pinnedUrl when pinning.
  {
    const { tabManager } = createHarness();
    const tab = tabManager.createTab("https://example.atlassian.net/jira/your-work");
    tab.url = "https://example.atlassian.net/browse/ABC-1";
    tabManager.togglePinTab(tab.id);
    assert.strictEqual(tab.pinned, true);
    assert.strictEqual(tab.pinnedUrl, "https://example.atlassian.net/browse/ABC-1");
    tabManager.togglePinTab(tab.id);
    assert.strictEqual(tab.pinned, false);
    assert.strictEqual(tab.pinnedUrl, "");
  }

  // setWindowOpenHandler on pinned tab still creates a new tab (cmd-click / window.open).
  {
    const { tabManager } = createHarness();
    const pinnedTab = tabManager.createTab("https://example.atlassian.net/jira/your-work", { pinned: true });
    const result = pinnedTab.view.webContents._windowOpenHandler({ url: "https://example.atlassian.net/browse/ABC-1" });
    assert.deepStrictEqual(result, { action: "deny" });
    assert.strictEqual(tabManager.serializeState({}).tabs.length, 2);
    assert.strictEqual(pinnedTab.pinnedUrl, "https://example.atlassian.net/jira/your-work");
  }
}

module.exports = {
  runTabManagerTests
};
