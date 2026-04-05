const assert = require("assert");

const { getDevUserDataPath } = require("../main/dev-user-data");

function runDevUserDataTests() {
  const basePath = "/tmp/app-data";
  const appPath = "/workspaces/jira-client-main";

  assert.strictEqual(
    getDevUserDataPath({
      appDataPath: basePath,
      appPath,
      configDirectory: "/tmp/jira-config-a"
    }),
    getDevUserDataPath({
      appDataPath: basePath,
      appPath,
      configDirectory: "/tmp/jira-config-a"
    })
  );

  assert.notStrictEqual(
    getDevUserDataPath({
      appDataPath: basePath,
      appPath,
      configDirectory: "/tmp/jira-config-a"
    }),
    getDevUserDataPath({
      appDataPath: basePath,
      appPath,
      configDirectory: "/tmp/jira-config-b"
    })
  );

  assert.notStrictEqual(
    getDevUserDataPath({
      appDataPath: basePath,
      appPath: "/workspaces/jira-client-a"
    }),
    getDevUserDataPath({
      appDataPath: basePath,
      appPath: "/workspaces/jira-client-b"
    })
  );
}

module.exports = {
  runDevUserDataTests
};
