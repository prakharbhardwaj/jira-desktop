const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { DEFAULT_SPACE_ID, SCHEMA_VERSION, createWorkspaceConfigStore, migrateLegacy, normalizeUrl } = require("../main/workspace-config");

function withTempDir(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jira-desktop-workspace-config-"));

  try {
    run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function createStore(configDirectory, extraEnv = {}) {
  const app = { getPath: () => path.join(configDirectory, "user-data") };

  return createWorkspaceConfigStore({
    app,
    fs,
    path,
    argv: ["node", "workspace-config.test.js"],
    env: { JIRA_DESKTOP_CONFIG_DIR: configDirectory, ...extraEnv }
  });
}

function readFile(configDirectory) {
  return JSON.parse(fs.readFileSync(path.join(configDirectory, "workspace.json"), "utf8"));
}

function runWorkspaceConfigTests() {
  assert.throws(() => normalizeUrl("http://example.atlassian.net"), /must use HTTPS/i);

  // Runtime JIRA_URL override bypasses saved state.
  withTempDir((configDirectory) => {
    const store = createStore(configDirectory, {
      JIRA_URL: "https://example.atlassian.net",
      JIRA_ALLOWED_HOSTS: "auth.example.com,id.atlassian.com"
    });
    const config = store.loadConfig();

    assert.strictEqual(config.jiraUrl, "https://example.atlassian.net/");
    assert.strictEqual(config.jiraHost, "example.atlassian.net");
    assert.strictEqual(config.workspaceSource, "runtime");
    assert.strictEqual(config.spaceId, null);
    assert.deepStrictEqual(Array.from(config.allowedHosts).sort(), ["auth.example.com", "id.atlassian.com"]);
  });

  // writeStoredWorkspaceUrl creates a default space in the v2 schema.
  withTempDir((configDirectory) => {
    const store = createStore(configDirectory);

    store.writeStoredWorkspaceUrl("https://saved-example.atlassian.net");

    const config = store.loadConfig();

    assert.strictEqual(config.jiraUrl, "https://saved-example.atlassian.net/");
    assert.strictEqual(config.workspaceSource, "saved");
    assert.strictEqual(config.spaceId, DEFAULT_SPACE_ID);

    const persisted = readFile(configDirectory);
    assert.strictEqual(persisted.schemaVersion, SCHEMA_VERSION);
    assert.strictEqual(persisted.activeSpaceId, DEFAULT_SPACE_ID);
    assert.strictEqual(persisted.spaces.length, 1);
    assert.strictEqual(persisted.spaces[0].id, DEFAULT_SPACE_ID);
    assert.strictEqual(persisted.spaces[0].jiraUrl, "https://saved-example.atlassian.net/");
    assert.strictEqual(persisted.spaces[0].partition, null);
    assert.strictEqual(persisted.openLinksInApp, false);
  });

  // Per-space session read/write.
  withTempDir((configDirectory) => {
    const store = createStore(configDirectory);

    store.writeStoredWorkspaceUrl("https://saved-example.atlassian.net");
    const active = store.getActiveSpace();

    store.writeSpaceSession(active.id, {
      activeTabIndex: 1,
      tabs: [
        { url: "https://saved-example.atlassian.net/projects/ONE", title: "Project One", pinned: true },
        { url: "https://saved-example.atlassian.net/issues/ISSUE-1", title: "Issue 1", pinned: false }
      ]
    });

    assert.deepStrictEqual(store.readSpaceSession(active.id), {
      activeTabIndex: 1,
      tabs: [
        { url: "https://saved-example.atlassian.net/projects/ONE", title: "Project One", pinned: true },
        { url: "https://saved-example.atlassian.net/issues/ISSUE-1", title: "Issue 1", pinned: false }
      ]
    });
    assert.strictEqual(store.readSpaceSession("does-not-exist"), null);
  });

  // Legacy v1 workspace.json is migrated on read.
  withTempDir((configDirectory) => {
    fs.writeFileSync(
      path.join(configDirectory, "workspace.json"),
      JSON.stringify({
        jiraUrl: "https://legacy.atlassian.net",
        session: {
          activeTabIndex: 0,
          tabs: [{ url: "https://legacy.atlassian.net/pinned", title: "Pinned", pinned: true }]
        },
        openLinksInApp: true
      })
    );

    const store = createStore(configDirectory);
    const config = store.loadConfig();

    assert.strictEqual(config.jiraUrl, "https://legacy.atlassian.net/");
    assert.strictEqual(config.spaceId, DEFAULT_SPACE_ID);
    assert.strictEqual(store.readOpenLinksInApp(), true);

    const persisted = readFile(configDirectory);
    assert.strictEqual(persisted.schemaVersion, SCHEMA_VERSION);
    assert.strictEqual(persisted.spaces[0].id, DEFAULT_SPACE_ID);
    assert.strictEqual(persisted.spaces[0].partition, null, "default space keeps the default partition on migration");
    assert.strictEqual(persisted.spaces[0].session.tabs.length, 1);
    assert.strictEqual(persisted.spaces[0].session.tabs[0].pinned, true);
  });

  // Invalid v1 url falls through to empty setup state.
  withTempDir((configDirectory) => {
    const store = createStore(configDirectory);

    fs.writeFileSync(path.join(configDirectory, "workspace.json"), JSON.stringify({ jiraUrl: "http://bad-host" }));

    const config = store.loadConfig();

    assert.strictEqual(config.jiraUrl, "");
    assert.strictEqual(config.workspaceSource, "none");
  });

  // Malformed JSON falls back to empty state and heals the persisted file.
  withTempDir((configDirectory) => {
    fs.writeFileSync(path.join(configDirectory, "workspace.json"), '{"schemaVersion":2,"spaces":[');

    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));

    try {
      const store = createStore(configDirectory);
      const config = store.loadConfig();

      assert.strictEqual(config.jiraUrl, "");
      assert.strictEqual(config.workspaceSource, "none");
    } finally {
      console.warn = originalWarn;
    }

    const persisted = readFile(configDirectory);
    assert.strictEqual(persisted.schemaVersion, SCHEMA_VERSION);
    assert.strictEqual(persisted.activeSpaceId, "");
    assert.deepStrictEqual(persisted.spaces, []);
    assert.strictEqual(persisted.openLinksInApp, false);
    assert.ok(warnings.some((message) => message.includes("resetting workspace config")));
  });

  // Adding spaces.
  withTempDir((configDirectory) => {
    const store = createStore(configDirectory);

    store.writeStoredWorkspaceUrl("https://alpha.atlassian.net");
    const beta = store.addSpace({ name: "Beta workspace", jiraUrl: "https://beta.atlassian.net" });

    assert.ok(beta.id);
    assert.notStrictEqual(beta.id, DEFAULT_SPACE_ID);
    assert.strictEqual(beta.jiraUrl, "https://beta.atlassian.net/");
    assert.strictEqual(beta.partition, `persist:workspace-${beta.id}`);

    const spaces = store.getSpaces();
    assert.strictEqual(spaces.length, 2);

    // Active space's config also lists the other space's host in allowedHosts (for cross-space nav).
    const active = store.loadConfig();
    assert.strictEqual(active.spaceId, DEFAULT_SPACE_ID);
    assert.ok(active.allowedHosts.has("beta.atlassian.net"));
  });

  // Switching active space.
  withTempDir((configDirectory) => {
    const store = createStore(configDirectory);

    store.writeStoredWorkspaceUrl("https://alpha.atlassian.net");
    const beta = store.addSpace({ name: "Beta", jiraUrl: "https://beta.atlassian.net" });

    assert.strictEqual(store.setActiveSpace(beta.id), true);
    const config = store.loadConfig();
    assert.strictEqual(config.spaceId, beta.id);
    assert.strictEqual(config.jiraHost, "beta.atlassian.net");
    assert.ok(config.allowedHosts.has("alpha.atlassian.net"));

    assert.strictEqual(store.setActiveSpace("nope"), false);
  });

  // Removing a space — cannot remove the last one; removing the active one falls back.
  withTempDir((configDirectory) => {
    const store = createStore(configDirectory);

    store.writeStoredWorkspaceUrl("https://alpha.atlassian.net");
    const alpha = store.getActiveSpace();
    const beta = store.addSpace({ name: "Beta", jiraUrl: "https://beta.atlassian.net" });

    store.setActiveSpace(beta.id);
    const removed = store.removeSpace(beta.id);

    assert.strictEqual(!!removed, true);
    assert.strictEqual(store.getSpaces().length, 1);
    assert.strictEqual(store.getActiveSpace().id, alpha.id);

    assert.strictEqual(store.removeSpace(alpha.id), false, "cannot remove the last remaining space");
  });

  // Rename / recolor via updateSpace.
  withTempDir((configDirectory) => {
    const store = createStore(configDirectory);

    store.writeStoredWorkspaceUrl("https://alpha.atlassian.net");
    const active = store.getActiveSpace();
    const updated = store.updateSpace(active.id, { name: "Renamed", accent: "#123456", icon: "🔥" });

    assert.strictEqual(updated.name, "Renamed");
    assert.strictEqual(updated.accent, "#123456");
    assert.strictEqual(updated.icon, "🔥");
  });

  // openLinksInApp survives writeStoredWorkspaceUrl and writeSpaceSession.
  withTempDir((configDirectory) => {
    const store = createStore(configDirectory);

    store.writeStoredWorkspaceUrl("https://alpha.atlassian.net");
    store.writeOpenLinksInApp(true);
    store.writeSpaceSession(store.getActiveSpace().id, {
      activeTabIndex: 0,
      tabs: [{ url: "https://alpha.atlassian.net/x", title: "x", pinned: false }]
    });

    const store2 = createStore(configDirectory);
    store2.loadConfig();
    assert.strictEqual(store2.readOpenLinksInApp(), true);
  });

  // migrateLegacy directly — empty jiraUrl yields empty state.
  {
    const migrated = migrateLegacy({ openLinksInApp: true });
    assert.strictEqual(migrated.spaces.length, 0);
    assert.strictEqual(migrated.openLinksInApp, true);
    assert.strictEqual(migrated.schemaVersion, SCHEMA_VERSION);
  }
}

module.exports = {
  runWorkspaceConfigTests
};
