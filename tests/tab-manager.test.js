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
  const createdPartitions = [];

  const tabManager = createTabManager({
    createView: ({ webPreferences }) => {
      createdPartitions.push(webPreferences.partition || null);
      return {
        webContents: createFakeWebContents(),
        setBackgroundColor() {}
      };
    },
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

  return { tabManager, externalOpens, createdPartitions };
}

function runTabManagerTests() {
  // Same-origin nav in pinned tab stays in pinned tab.
  {
    const { tabManager } = createHarness();
    const pinnedTab = tabManager.createTab("https://example.atlassian.net/jira/your-work", {
      pinned: true,
      spaceId: "s1"
    });
    const event = createFakeEvent();
    pinnedTab.view.webContents.emit("will-navigate", event, "https://example.atlassian.net/browse/ABC-1");
    assert.strictEqual(event.defaultPrevented, false);
  }

  // Cross-origin nav in pinned tab spawns a new tab in the same space.
  {
    const { tabManager } = createHarness();
    const pinnedTab = tabManager.createTab("https://example.atlassian.net/jira/your-work", {
      pinned: true,
      spaceId: "s1"
    });
    const event = createFakeEvent();
    pinnedTab.view.webContents.emit("will-navigate", event, "https://id.atlassian.com/login");
    assert.strictEqual(event.defaultPrevented, true);

    const state = tabManager.serializeState({});
    assert.strictEqual(state.tabs.length, 2);
    assert.strictEqual(pinnedTab.pinnedUrl, "https://example.atlassian.net/jira/your-work");
  }

  // Disallowed nav in pinned tab → external open, no new tab.
  {
    const { tabManager, externalOpens } = createHarness();
    const pinnedTab = tabManager.createTab("https://example.atlassian.net/jira/your-work", {
      pinned: true,
      spaceId: "s1"
    });
    const event = createFakeEvent();
    pinnedTab.view.webContents.emit("will-navigate", event, "http://malicious.example.com/");
    assert.strictEqual(event.defaultPrevented, true);
    assert.deepStrictEqual(externalOpens, ["http://malicious.example.com/"]);
  }

  // Unpinned tabs never spawn on cross-origin.
  {
    const { tabManager } = createHarness();
    const tab = tabManager.createTab("https://example.atlassian.net/jira/your-work", { spaceId: "s1" });
    const event = createFakeEvent();
    tab.view.webContents.emit("will-navigate", event, "https://id.atlassian.com/login");
    assert.strictEqual(event.defaultPrevented, false);
  }

  // Persistence: pinned tabs serialize their pinnedUrl.
  {
    const { tabManager } = createHarness();
    const pinnedTab = tabManager.createTab("https://example.atlassian.net/jira/your-work", {
      pinned: true,
      spaceId: "s1"
    });
    pinnedTab.url = "https://example.atlassian.net/browse/ABC-1";
    const persisted = tabManager.serializePersistedState("s1");
    assert.strictEqual(persisted.tabs[0].url, "https://example.atlassian.net/jira/your-work");
  }

  // togglePinTab captures/clears pinnedUrl.
  {
    const { tabManager } = createHarness();
    const tab = tabManager.createTab("https://example.atlassian.net/jira/your-work", { spaceId: "s1" });
    tab.url = "https://example.atlassian.net/browse/ABC-1";
    tabManager.togglePinTab(tab.id);
    assert.strictEqual(tab.pinnedUrl, "https://example.atlassian.net/browse/ABC-1");
    tabManager.togglePinTab(tab.id);
    assert.strictEqual(tab.pinnedUrl, "");
  }

  // Multiple spaces: tabs and active tab are scoped per-space.
  {
    const { tabManager } = createHarness();
    const tabA1 = tabManager.createTab("https://alpha.atlassian.net/", { spaceId: "alpha" });
    const tabA2 = tabManager.createTab("https://alpha.atlassian.net/b", { spaceId: "alpha" });
    const tabB1 = tabManager.createTab("https://beta.atlassian.net/", { spaceId: "beta" });

    // Active space is whichever was created first with activate: true.
    assert.strictEqual(tabManager.getActiveSpaceId(), "alpha");

    const alphaState = tabManager.serializeState({});
    assert.strictEqual(alphaState.activeSpaceId, "alpha");
    assert.deepStrictEqual(
      alphaState.tabs.map((tab) => tab.id).sort(),
      [tabA1.id, tabA2.id].sort()
    );

    tabManager.setActiveSpace("beta");
    const betaState = tabManager.serializeState({});
    assert.strictEqual(betaState.activeSpaceId, "beta");
    assert.deepStrictEqual(betaState.tabs.map((tab) => tab.id), [tabB1.id]);
  }

  // Partition gets forwarded to createView.
  {
    const { tabManager, createdPartitions } = createHarness();
    tabManager.createTab("https://alpha.atlassian.net/", { spaceId: "alpha", partition: "persist:workspace-alpha" });
    tabManager.createTab("https://beta.atlassian.net/", { spaceId: "beta" });

    assert.strictEqual(createdPartitions[0], "persist:workspace-alpha");
    assert.strictEqual(createdPartitions[1], null);
  }

  // closeSpaceTabs destroys every tab in that space.
  {
    const { tabManager } = createHarness();
    tabManager.createTab("https://alpha.atlassian.net/", { spaceId: "alpha" });
    tabManager.createTab("https://alpha.atlassian.net/x", { spaceId: "alpha" });
    tabManager.createTab("https://beta.atlassian.net/", { spaceId: "beta" });

    tabManager.closeSpaceTabs("alpha");

    tabManager.setActiveSpace("beta");
    assert.strictEqual(tabManager.serializeState({}).tabs.length, 1);
    assert.strictEqual(tabManager.hasTabsForSpace("alpha"), false);
  }

  // restorePersistedState creates tabs under the given space.
  {
    const { tabManager } = createHarness();
    const restored = tabManager.restorePersistedState(
      "alpha",
      {
        activeTabIndex: 1,
        tabs: [
          { url: "https://alpha.atlassian.net/pinned", title: "Pinned", pinned: true },
          { url: "https://alpha.atlassian.net/current", title: "Current", pinned: false }
        ]
      },
      { partition: "persist:workspace-alpha" }
    );

    assert.strictEqual(restored, true);
    assert.strictEqual(tabManager.getActiveSpaceId(), "alpha");
    assert.strictEqual(tabManager.serializeState({}).tabs.length, 2);
  }

  // Disallowed cross-origin nav in pinned tab with same-space semantics still external-opens.
  {
    const { tabManager, externalOpens } = createHarness();
    const pinnedTab = tabManager.createTab("https://example.atlassian.net/jira/your-work", {
      pinned: true,
      spaceId: "s1"
    });
    const event = createFakeEvent();
    pinnedTab.view.webContents.emit("will-navigate", event, "http://bad/");
    assert.strictEqual(event.defaultPrevented, true);
    assert.ok(externalOpens.includes("http://bad/"));
  }
}

module.exports = {
  runTabManagerTests
};
