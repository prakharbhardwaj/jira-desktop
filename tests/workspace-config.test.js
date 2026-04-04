const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createWorkspaceConfigStore, normalizeUrl } = require("../main/workspace-config");

function withTempDir(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jira-desktop-workspace-config-"));

  try {
    run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function runWorkspaceConfigTests() {
  assert.throws(() => normalizeUrl("http://example.atlassian.net"), /must use HTTPS/i);

  withTempDir((configDirectory) => {
    const app = {
      getPath: () => path.join(configDirectory, "user-data")
    };
    const store = createWorkspaceConfigStore({
      app,
      fs,
      path,
      argv: ["node", "workspace-config.test.js"],
      env: {
        JIRA_DESKTOP_CONFIG_DIR: configDirectory,
        JIRA_URL: "https://example.atlassian.net",
        JIRA_ALLOWED_HOSTS: "auth.example.com,id.atlassian.com"
      }
    });
    const config = store.loadConfig();

    assert.strictEqual(config.jiraUrl, "https://example.atlassian.net/");
    assert.strictEqual(config.jiraHost, "example.atlassian.net");
    assert.strictEqual(config.workspaceSource, "runtime");
    assert.deepStrictEqual(Array.from(config.allowedHosts).sort(), ["auth.example.com", "id.atlassian.com"]);
  });

  withTempDir((configDirectory) => {
    const app = {
      getPath: () => path.join(configDirectory, "user-data")
    };
    const store = createWorkspaceConfigStore({
      app,
      fs,
      path,
      argv: ["node", "workspace-config.test.js"],
      env: {
        JIRA_DESKTOP_CONFIG_DIR: configDirectory
      }
    });

    store.writeStoredWorkspaceUrl("https://saved-example.atlassian.net");

    const config = store.loadConfig();

    assert.strictEqual(config.jiraUrl, "https://saved-example.atlassian.net/");
    assert.strictEqual(config.workspaceSource, "saved");
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(path.join(configDirectory, "workspace.json"), "utf8")),
      { jiraUrl: "https://saved-example.atlassian.net" }
    );
  });

  withTempDir((configDirectory) => {
    const app = {
      getPath: () => path.join(configDirectory, "user-data")
    };
    const store = createWorkspaceConfigStore({
      app,
      fs,
      path,
      argv: ["node", "workspace-config.test.js"],
      env: {
        JIRA_DESKTOP_CONFIG_DIR: configDirectory
      }
    });

    fs.writeFileSync(path.join(configDirectory, "workspace.json"), JSON.stringify({ jiraUrl: "http://bad-host" }, null, 2));

    const config = store.loadConfig();

    assert.strictEqual(config.jiraUrl, "");
    assert.match(config.setupError, /invalid jira_url/i);
    assert.strictEqual(config.workspaceSource, "saved");
  });
}

module.exports = {
  runWorkspaceConfigTests
};
