const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { _electron: electron } = require("playwright");

const APP_DIR = path.resolve(__dirname, "..");
const UNREACHABLE_JIRA_URL = "https://127.0.0.1:44444";
const NORMALIZED_JIRA_URL = new URL(UNREACHABLE_JIRA_URL).toString();
const WORKSPACE_CONFIG_FILENAME = "workspace.json";

async function waitForTitle(window, expectedText) {
  await window.locator("#title").waitFor({ state: "visible" });
  await window.waitForFunction(
    ({ text }) => {
      const element = document.querySelector("#title");
      return element && element.textContent === text;
    },
    { text: expectedText }
  );
}

function createLaunchEnv(configDirectory) {
  const env = { ...process.env, JIRA_DESKTOP_CONFIG_DIR: configDirectory };

  delete env.JIRA_URL;
  delete env.ELECTRON_RUN_AS_NODE;

  return env;
}

async function launchApp(configDirectory) {
  return electron.launch({
    args: [APP_DIR],
    cwd: APP_DIR,
    env: createLaunchEnv(configDirectory)
  });
}

async function closeApp(electronApp) {
  try {
    await electronApp.evaluate(({ app }) => app.quit());
  } catch (error) {
    console.warn("Unable to quit Electron cleanly.", error);
  }

  await electronApp.close();
}

async function run() {
  const configDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "jira-desktop-smoke-"));
  let failed = false;
  let electronApp = null;

  try {
    electronApp = await launchApp(configDirectory);
    const window = await electronApp.firstWindow();

    await waitForTitle(window, "Set up Jira Desktop");

    const initialMessage = await window.locator("#message").textContent();
    assert.match(initialMessage || "", /remember it on this device/i, `Unexpected setup message: ${initialMessage}`);
    assert.strictEqual(await window.locator("#workspace-form").isVisible(), true);
    await window.locator("#workspace-url-input").fill(UNREACHABLE_JIRA_URL);
    await window.evaluate(() => {
      document.getElementById("workspace-submit").click();
    });

    await waitForTitle(window, "Jira is unavailable");

    const message = await window.locator("#message").textContent();
    const targetUrl = await window.locator("#target-url").textContent();
    const retryButton = window.locator("#retry-button");

    assert.match(message || "", /(could not|refused|reached|load)/i, `Unexpected error message: ${message}`);
    assert.strictEqual(targetUrl, NORMALIZED_JIRA_URL);
    assert.strictEqual(await retryButton.isVisible(), true);
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(path.join(configDirectory, WORKSPACE_CONFIG_FILENAME), "utf8")),
      { jiraUrl: NORMALIZED_JIRA_URL }
    );

    const retryState = await window.evaluate(() => {
      const button = document.getElementById("retry-button");
      button.click();

      return {
        text: button.textContent,
        disabled: button.disabled
      };
    });

    assert.strictEqual(retryState.text, "Retrying...");
    assert.strictEqual(retryState.disabled, true);
    await window.waitForTimeout(1000);
    await waitForTitle(window, "Jira is unavailable");

    const postRetryMessage = await window.locator("#message").textContent();
    assert.match(postRetryMessage || "", /(could not|refused|reached|load)/i, `Unexpected post-retry message: ${postRetryMessage}`);

    await window.locator("#new-tab-button").click();
    await window.waitForFunction(() => document.querySelectorAll(".tab").length === 2);
    assert.strictEqual(
      await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
      1
    );

    await closeApp(electronApp);
    electronApp = await launchApp(configDirectory);

    const relaunchedWindow = await electronApp.firstWindow();
    await waitForTitle(relaunchedWindow, "Jira is unavailable");
    assert.strictEqual(await relaunchedWindow.locator("#target-url").textContent(), NORMALIZED_JIRA_URL);

    console.log("Smoke test passed.");
  } catch (error) {
    failed = true;
    console.error("Smoke test failed.");
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
  console.error("Smoke test crashed.");
  console.error(error);
  process.exit(1);
});
