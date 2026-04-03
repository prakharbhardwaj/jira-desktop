const assert = require("assert");
const path = require("path");
const { _electron: electron } = require("playwright");

const APP_DIR = path.resolve(__dirname, "..");
const UNREACHABLE_JIRA_URL = "https://127.0.0.1:44444";
const NORMALIZED_JIRA_URL = new URL(UNREACHABLE_JIRA_URL).toString();

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

async function run() {
  const env = { ...process.env, JIRA_URL: UNREACHABLE_JIRA_URL };
  delete env.ELECTRON_RUN_AS_NODE;

  const electronApp = await electron.launch({
    args: [APP_DIR, `--jira-url=${UNREACHABLE_JIRA_URL}`],
    cwd: APP_DIR,
    env
  });

  let failed = false;

  try {
    const window = await electronApp.firstWindow();

    await waitForTitle(window, "Jira is unavailable");

    const message = await window.locator("#message").textContent();
    const targetUrl = await window.locator("#target-url").textContent();
    const retryButton = window.locator("#retry-button");

    assert.match(message || "", /(could not|refused|reached|load)/i, `Unexpected error message: ${message}`);
    assert.strictEqual(targetUrl, NORMALIZED_JIRA_URL);
    assert.strictEqual(await retryButton.isVisible(), true);

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

    console.log("Smoke test passed.");
  } catch (error) {
    failed = true;
    console.error("Smoke test failed.");
    console.error(error);
  } finally {
    try {
      await electronApp.evaluate(({ app }) => app.quit());
    } catch (error) {
      console.warn("Unable to quit Electron cleanly.", error);
    }

    await electronApp.close();
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
