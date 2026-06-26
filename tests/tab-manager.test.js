const assert = require("assert");

const { createTabManager } = require("../main/tab-manager");

function createFakeWebContents() {
  const listeners = new Map();
  return {
    _windowOpenHandler: null,
    loadUrls: [],
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
    loadURL(targetUrl) {
      this.loadUrls.push(targetUrl);
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
  const configuredSessions = [];

  const tabManager = createTabManager({
    createView: ({ webPreferences }) => {
      createdPartitions.push(webPreferences.partition || null);
      return {
        webContents: createFakeWebContents(),
        setBackgroundColor() {}
      };
    },
    configureSession: (session) => configuredSessions.push(session),
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

  return { tabManager, externalOpens, createdPartitions, configuredSessions };
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

    pinnedTab.view.webContents.emit("did-navigate", {}, "https://example.atlassian.net/browse/ABC-1");
    assert.strictEqual(tabManager.serializeState({}).tabs[0].isPinnedDirty, true);
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

  // resetPinnedTab navigates back to the pinned URL.
  {
    const { tabManager } = createHarness();
    const pinnedTab = tabManager.createTab("https://example.atlassian.net/jira/your-work", {
      pinned: true,
      spaceId: "s1"
    });

    pinnedTab.view.webContents.emit("did-navigate", {}, "https://example.atlassian.net/browse/ABC-1");
    tabManager.resetPinnedTab(pinnedTab.id);

    assert.strictEqual(pinnedTab.view.webContents.loadUrls.at(-1), "https://example.atlassian.net/jira/your-work");
    assert.strictEqual(tabManager.serializeState({}).tabs[0].isPinnedDirty, false);
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
    assert.deepStrictEqual(alphaState.tabs.map((tab) => tab.id).sort(), [tabA1.id, tabA2.id].sort());

    tabManager.setActiveSpace("beta");
    const betaState = tabManager.serializeState({});
    assert.strictEqual(betaState.activeSpaceId, "beta");
    assert.deepStrictEqual(
      betaState.tabs.map((tab) => tab.id),
      [tabB1.id]
    );
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

  // Popup (window.open with features → "new-window") to an allowed host opens a
  // child window with security defaults intact and the opener's partition.
  {
    const { tabManager } = createHarness();
    const tab = tabManager.createTab("https://example.atlassian.net/browse/ABC-1", {
      spaceId: "s1",
      partition: "persist:workspace-s1"
    });
    const result = tab.view.webContents._windowOpenHandler({
      url: "https://github.com/login/oauth/authorize",
      disposition: "new-window"
    });

    assert.strictEqual(result.action, "allow");
    const prefs = result.overrideBrowserWindowOptions.webPreferences;
    assert.strictEqual(prefs.partition, "persist:workspace-s1");
    assert.strictEqual(prefs.contextIsolation, true);
    assert.strictEqual(prefs.sandbox, true);
    assert.strictEqual(prefs.nodeIntegration, false);
  }

  // Popup to a disallowed host is denied and routed externally (no popup window).
  {
    const { tabManager, externalOpens } = createHarness();
    const tab = tabManager.createTab("https://example.atlassian.net/", { spaceId: "s1" });
    const result = tab.view.webContents._windowOpenHandler({
      url: "http://evil.example.com/",
      disposition: "new-window"
    });

    assert.strictEqual(result.action, "deny");
    assert.deepStrictEqual(externalOpens, ["http://evil.example.com/"]);
  }

  // target=_blank link (foreground-tab) to an allowed host opens a new in-app tab.
  {
    const { tabManager } = createHarness();
    const tab = tabManager.createTab("https://example.atlassian.net/", { spaceId: "s1" });
    const before = tabManager.serializeState({}).tabs.length;
    const result = tab.view.webContents._windowOpenHandler({
      url: "https://example.atlassian.net/secondary",
      disposition: "foreground-tab"
    });

    assert.strictEqual(result.action, "deny");
    assert.strictEqual(tabManager.serializeState({}).tabs.length, before + 1);
  }

  // Child windows created by an allowed popup stay within the navigation policy.
  {
    const { tabManager, externalOpens, configuredSessions } = createHarness();
    const tab = tabManager.createTab("https://example.atlassian.net/", { spaceId: "s1" });
    const childContents = createFakeWebContents();
    const sessionsBefore = configuredSessions.length;

    tab.view.webContents.emit("did-create-window", { webContents: childContents });
    assert.strictEqual(configuredSessions.length, sessionsBefore + 1);

    const allowChild = childContents._windowOpenHandler({ url: "https://example.atlassian.net/x" });
    assert.strictEqual(allowChild.action, "allow");

    const denyChild = childContents._windowOpenHandler({ url: "http://bad.example.com/" });
    assert.strictEqual(denyChild.action, "deny");
    assert.ok(externalOpens.includes("http://bad.example.com/"));

    const event = createFakeEvent();
    childContents.emit("will-navigate", event, "http://bad.example.com/nav");
    assert.strictEqual(event.defaultPrevented, true);
    assert.ok(externalOpens.includes("http://bad.example.com/nav"));
  }
}

module.exports = {
  runTabManagerTests
};
