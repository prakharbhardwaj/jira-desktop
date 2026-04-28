const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { _electron: electron } = require("playwright");

const APP_DIR = path.resolve(__dirname, "..");
const UNREACHABLE_JIRA_URL = "https://127.0.0.1:44444";

async function launch(configDirectory) {
  return electron.launch({
    args: [APP_DIR],
    cwd: APP_DIR,
    env: {
      ...process.env,
      JIRA_DESKTOP_CONFIG_DIR: configDirectory,
      JIRA_URL: UNREACHABLE_JIRA_URL,
      ELECTRON_RUN_AS_NODE: undefined
    }
  });
}

async function run() {
  const configDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "jira-desktop-partition-spike-"));
  let electronApp = null;
  let failed = false;

  try {
    electronApp = await launch(configDirectory);
    await electronApp.firstWindow();

    const result = await electronApp.evaluate(async ({ session }) => {
      const partitionA = "persist:workspace-alpha";
      const partitionB = "persist:workspace-beta";
      const testUrl = "https://example.atlassian.net/";

      const sessionA = session.fromPartition(partitionA);
      const sessionB = session.fromPartition(partitionB);
      const sessionA2 = session.fromPartition(partitionA);

      await sessionA.cookies.set({ url: testUrl, name: "sso", value: "from-A" });
      await sessionB.cookies.set({ url: testUrl, name: "sso", value: "from-B" });

      const cookiesOnA = await sessionA.cookies.get({ url: testUrl, name: "sso" });
      const cookiesOnB = await sessionB.cookies.get({ url: testUrl, name: "sso" });

      return {
        sameReferenceForSameId: sessionA === sessionA2,
        distinctForDifferentIds: sessionA !== sessionB,
        cookieOnA: cookiesOnA.map((cookie) => cookie.value),
        cookieOnB: cookiesOnB.map((cookie) => cookie.value)
      };
    });

    assert.strictEqual(result.sameReferenceForSameId, true, "session.fromPartition must return the same instance for the same id");
    assert.strictEqual(result.distinctForDifferentIds, true, "session.fromPartition must return distinct instances for different ids");
    assert.deepStrictEqual(result.cookieOnA, ["from-A"], "partition A should only see its own cookie");
    assert.deepStrictEqual(result.cookieOnB, ["from-B"], "partition B should only see its own cookie");

    console.log("Partition isolation spike passed.");
  } catch (error) {
    failed = true;
    console.error("Partition isolation spike failed.");
    console.error(error);
  } finally {
    if (electronApp) {
      try {
        await electronApp.evaluate(({ app }) => app.quit());
      } catch {}
      await electronApp.close();
    }

    fs.rmSync(configDirectory, { recursive: true, force: true });
  }

  if (failed) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("Partition isolation spike crashed.");
  console.error(error);
  process.exit(1);
});
