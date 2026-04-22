const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { _electron: electron } = require("playwright");

const APP_DIR = path.resolve(__dirname, "..");
const WORKSPACE_CONFIG_FILENAME = "workspace.json";
const LEGACY_JIRA_URL = "https://alpha.atlassian.net/";
const SECOND_SPACE_JIRA_URL = "https://beta.atlassian.net/";

function readWorkspaceFile(configDirectory) {
  return JSON.parse(fs.readFileSync(path.join(configDirectory, WORKSPACE_CONFIG_FILENAME), "utf8"));
}

function writeLegacyWorkspaceFile(configDirectory) {
  fs.writeFileSync(
    path.join(configDirectory, WORKSPACE_CONFIG_FILENAME),
    JSON.stringify(
      {
        jiraUrl: LEGACY_JIRA_URL,
        session: {
          activeTabIndex: 0,
          tabs: [{ url: `${LEGACY_JIRA_URL}pinned`, title: "Pinned", pinned: true }]
        }
      },
      null,
      2
    )
  );
}

async function launch(configDirectory) {
  const env = { ...process.env, JIRA_DESKTOP_CONFIG_DIR: configDirectory };
  delete env.JIRA_URL;
  delete env.ELECTRON_RUN_AS_NODE;

  return electron.launch({ args: [APP_DIR], cwd: APP_DIR, env });
}

async function closeApp(electronApp) {
  try {
    await electronApp.evaluate(({ app }) => app.quit());
  } catch {
    /* ignore */
  }
  await electronApp.close();
}

async function waitForRailCount(window, expected) {
  await window.waitForFunction(
    ({ count }) => document.querySelectorAll(".space-rail-item").length === count,
    { count: expected }
  );
}

async function run() {
  const configDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "jira-desktop-spaces-smoke-"));
  let electronApp = null;
  let failed = false;

  try {
    writeLegacyWorkspaceFile(configDirectory);

    electronApp = await launch(configDirectory);
    let window = await electronApp.firstWindow();

    // 1. Legacy workspace.json is migrated to schema v2 with one default space.
    await window.waitForFunction(() => document.querySelectorAll(".space-rail-item").length === 1);
    let persisted = readWorkspaceFile(configDirectory);
    assert.strictEqual(persisted.schemaVersion, 2, "schema migrated to v2");
    assert.strictEqual(persisted.spaces.length, 1);
    assert.strictEqual(persisted.spaces[0].id, "default");
    assert.strictEqual(persisted.spaces[0].partition, null, "default space keeps default partition on migration");
    assert.ok(persisted.spaces[0].session, "legacy session carried over");
    assert.strictEqual(persisted.spaces[0].session.tabs[0].pinned, true, "legacy pinned tab carried over");

    // 2. Add a second space via the renderer-exposed IPC.
    let addResult = await window.evaluate(
      async ({ url }) => window.jiraDesktop.addSpace({ name: "Beta", jiraUrl: url }),
      { url: SECOND_SPACE_JIRA_URL }
    );
    assert.strictEqual(addResult.ok, true, "addSpace should succeed");
    const betaSpaceId = addResult.space.id;
    await waitForRailCount(window, 2);

    // Switch to the new space.
    let switchResult = await window.evaluate(async (id) => window.jiraDesktop.switchSpace(id), betaSpaceId);
    assert.strictEqual(switchResult.ok, true);

    // 3. Cookie isolation between partitions.
    const isolation = await electronApp.evaluate(
      async ({ session }, { betaPartition }) => {
        const defaultSession = session.defaultSession;
        const betaSession = session.fromPartition(betaPartition);
        const url = "https://example.atlassian.net/";

        await defaultSession.cookies.set({ url, name: "token", value: "from-default" });
        await betaSession.cookies.set({ url, name: "token", value: "from-beta" });

        const defaultCookies = await defaultSession.cookies.get({ url, name: "token" });
        const betaCookies = await betaSession.cookies.get({ url, name: "token" });

        return {
          defaultValues: defaultCookies.map((cookie) => cookie.value),
          betaValues: betaCookies.map((cookie) => cookie.value)
        };
      },
      { betaPartition: `persist:workspace-${betaSpaceId}` }
    );
    assert.deepStrictEqual(isolation.defaultValues, ["from-default"]);
    assert.deepStrictEqual(isolation.betaValues, ["from-beta"]);

    // 4. Rename and update the second space.
    const updateResult = await window.evaluate(async (id) => {
      return window.jiraDesktop.updateSpace({
        id,
        changes: { name: "Beta Renamed", accent: "#ff8b00", icon: "🔥" }
      });
    }, betaSpaceId);
    assert.strictEqual(updateResult.ok, true);
    assert.strictEqual(updateResult.space.name, "Beta Renamed");
    assert.strictEqual(updateResult.space.accent, "#ff8b00");
    assert.strictEqual(updateResult.space.icon, "🔥");

    // 5. Keyboard shortcut (Cmd+1) switches to space at index 0.
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "1", modifiers: ["meta"] });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "1", modifiers: ["meta"] });
    });

    await window.waitForFunction(() => {
      const active = document.querySelector(".space-rail-item.is-active");
      return active && active.dataset.spaceId === "default";
    });

    // 6. Restart — assert sessions per space and active space persist.
    await closeApp(electronApp);
    electronApp = await launch(configDirectory);
    window = await electronApp.firstWindow();
    await waitForRailCount(window, 2);
    persisted = readWorkspaceFile(configDirectory);
    assert.strictEqual(persisted.spaces.length, 2);
    assert.strictEqual(persisted.activeSpaceId, "default");

    const betaPersisted = persisted.spaces.find((space) => space.id === betaSpaceId);
    assert.ok(betaPersisted);
    assert.strictEqual(betaPersisted.name, "Beta Renamed");
    assert.strictEqual(betaPersisted.accent, "#ff8b00");

    // 7. Delete the beta space and verify partition storage is wiped.
    const deleteResult = await window.evaluate(async (id) => window.jiraDesktop.deleteSpace(id), betaSpaceId);
    assert.strictEqual(deleteResult.ok, true);
    await waitForRailCount(window, 1);

    const cookiesAfterDelete = await electronApp.evaluate(
      async ({ session }, { betaPartition }) => {
        const betaSession = session.fromPartition(betaPartition);
        const all = await betaSession.cookies.get({});
        return all.map((cookie) => ({ name: cookie.name, value: cookie.value }));
      },
      { betaPartition: `persist:workspace-${betaSpaceId}` }
    );
    assert.deepStrictEqual(cookiesAfterDelete, [], "deleting a space clears its partition cookies");

    persisted = readWorkspaceFile(configDirectory);
    assert.strictEqual(persisted.spaces.length, 1);
    assert.strictEqual(persisted.spaces[0].id, "default");

    console.log("Spaces smoke test passed.");
  } catch (error) {
    failed = true;
    console.error("Spaces smoke test failed.");
    console.error(error);
  } finally {
    if (electronApp) {
      await closeApp(electronApp);
    }
    fs.rmSync(configDirectory, { recursive: true, force: true });
  }

  if (failed) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("Spaces smoke test crashed.");
  console.error(error);
  process.exit(1);
});
