const assert = require("assert");

const { createNavigationPolicy } = require("../main/navigation-policy");

function createSessionMock() {
  return {
    permissionCheckHandler: null,
    permissionRequestHandler: null,
    setPermissionCheckHandler(handler) {
      this.permissionCheckHandler = handler;
    },
    setPermissionRequestHandler(handler) {
      this.permissionRequestHandler = handler;
    }
  };
}

function runNavigationPolicyTests() {
  const openedLinks = [];
  const copiedLinks = [];
  let popupTemplate = null;
  let popupOptions = null;
  const mainWindow = {
    isDestroyed: () => false
  };

  const policy = createNavigationPolicy({
    Menu: {
      buildFromTemplate(template) {
        popupTemplate = template;

        return {
          popup(options) {
            popupOptions = options;
          }
        };
      }
    },
    clipboard: {
      writeText(value) {
        copiedLinks.push(value);
      }
    },
    shell: {
      openExternal() {}
    },
    getConfig: () => ({
      jiraHost: "example.atlassian.net",
      allowedHosts: new Set(["auth.example.com"])
    }),
    getMainWindow: () => mainWindow,
    onOpenAllowedLink: (url) => {
      openedLinks.push(url);
    }
  });

  assert.strictEqual(policy.isAllowedNavigation("https://example.atlassian.net/browse/ABC-1"), true);
  assert.strictEqual(policy.isAllowedNavigation("https://auth.example.com/sso"), true);
  assert.strictEqual(policy.isAllowedNavigation("https://id.atlassian.com/login"), true);
  assert.strictEqual(policy.isAllowedNavigation("http://example.atlassian.net/browse/ABC-1"), false);
  assert.strictEqual(policy.isAllowedNavigation("https://example.com"), false);

  const session = createSessionMock();

  policy.configureSession(session);
  policy.configureSession(session);

  let requestResult = null;
  session.permissionRequestHandler(null, "notifications", (allowed) => {
    requestResult = allowed;
  }, { requestingUrl: "https://auth.example.com/sso" });

  assert.strictEqual(requestResult, true);
  assert.strictEqual(session.permissionCheckHandler(null, "clipboard-read", "https://example.com"), false);
  assert.strictEqual(session.permissionCheckHandler(null, "clipboard-read", "https://example.atlassian.net"), true);

  policy.handleContextMenu(null, {
    editFlags: {
      canCopy: false,
      canCut: false,
      canPaste: false,
      canRedo: false,
      canSelectAll: false,
      canUndo: false
    },
    frame: null,
    isEditable: false,
    linkURL: "https://example.atlassian.net/browse/ABC-1",
    menuSourceType: "mouse",
    selectionText: "",
    x: 0,
    y: 0
  });

  assert.ok(Array.isArray(popupTemplate));
  assert.strictEqual(popupOptions.window, mainWindow);
  assert.strictEqual(popupOptions.x, 0);
  assert.strictEqual(popupOptions.y, 0);
  assert.strictEqual("frame" in popupOptions, false);
  assert.strictEqual("sourceType" in popupOptions, false);
  popupTemplate[0].click();
  popupTemplate[2].click();

  assert.deepStrictEqual(openedLinks, ["https://example.atlassian.net/browse/ABC-1"]);
  assert.deepStrictEqual(copiedLinks, ["https://example.atlassian.net/browse/ABC-1"]);
}

module.exports = {
  runNavigationPolicyTests
};
