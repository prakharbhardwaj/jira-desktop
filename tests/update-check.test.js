const assert = require("assert");

const { compareVersions, getUpdatePayload, selectReleaseAsset } = require("../main/update-check");

function runUpdateCheckTests() {
  assert.strictEqual(compareVersions("1.3.0", "1.2.9"), true);
  assert.strictEqual(compareVersions("v1.3.0", "1.3.0"), false);
  assert.strictEqual(compareVersions("1.2.9", "1.3.0"), false);

  const assets = [
    {
      name: "Jira.Desktop-1.3.0-arm64.zip",
      browser_download_url: "https://example.com/mac-arm64.zip"
    },
    {
      name: "Jira.Desktop-1.3.0-x64.exe",
      browser_download_url: "https://example.com/win-x64.exe"
    },
    {
      name: "Jira.Desktop-1.3.0-x64.zip",
      browser_download_url: "https://example.com/win-x64.zip"
    }
  ];

  assert.strictEqual(selectReleaseAsset(assets, "darwin", "arm64").name, "Jira.Desktop-1.3.0-arm64.zip");
  assert.strictEqual(selectReleaseAsset(assets, "win32", "x64").name, "Jira.Desktop-1.3.0-x64.exe");
  assert.strictEqual(selectReleaseAsset(assets, "linux", "x64"), null);

  const payload = getUpdatePayload(
    {
      tag_name: "v1.3.0",
      html_url: "https://github.com/prakharbhardwaj/jira-desktop/releases/tag/v1.3.0",
      assets
    },
    "1.2.0",
    "win32",
    "x64"
  );

  assert.deepStrictEqual(payload, {
    available: true,
    version: "1.3.0",
    changelogUrl: "https://github.com/prakharbhardwaj/jira-desktop/releases/tag/v1.3.0",
    downloadUrl: "https://example.com/win-x64.exe",
    downloadName: "Jira.Desktop-1.3.0-x64.exe"
  });
}

module.exports = {
  runUpdateCheckTests
};
