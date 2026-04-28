const assert = require("assert");

const { createDeepLinkRouter, findDeepLinkInArgv, parseDeepLink } = require("../main/deep-link");

function runDeepLinkTests() {
  // parseDeepLink: pass through https URLs.
  assert.strictEqual(
    parseDeepLink("https://example.atlassian.net/browse/ABC-1"),
    "https://example.atlassian.net/browse/ABC-1"
  );

  // parseDeepLink: jira-desktop://open?url=<encoded>.
  assert.strictEqual(
    parseDeepLink("jira-desktop://open?url=https%3A%2F%2Fexample.atlassian.net%2Fbrowse%2FABC-1"),
    "https://example.atlassian.net/browse/ABC-1"
  );

  // parseDeepLink: jira-desktop://https://... fallback form.
  assert.strictEqual(
    parseDeepLink("jira-desktop://https://example.atlassian.net/browse/ABC-1"),
    "https://example.atlassian.net/browse/ABC-1"
  );

  // parseDeepLink: rejects non-https targets inside the protocol URL.
  assert.strictEqual(parseDeepLink("jira-desktop://open?url=http%3A%2F%2Fexample.com"), null);

  // parseDeepLink: rejects plain garbage.
  assert.strictEqual(parseDeepLink(""), null);
  assert.strictEqual(parseDeepLink(null), null);
  assert.strictEqual(parseDeepLink("not a url"), null);
  assert.strictEqual(parseDeepLink("ftp://example.com"), null);

  // findDeepLinkInArgv: picks the first URL-shaped argument.
  assert.strictEqual(
    findDeepLinkInArgv(["/path/to/electron", "--flag", "https://example.atlassian.net/browse/ABC-1"]),
    "https://example.atlassian.net/browse/ABC-1"
  );
  assert.strictEqual(
    findDeepLinkInArgv(["/path/to/electron", "jira-desktop://open?url=https%3A%2F%2Fexample.atlassian.net%2F"]),
    "https://example.atlassian.net/"
  );
  assert.strictEqual(findDeepLinkInArgv(["/path/to/electron", "--jira-url=https://example.atlassian.net"]), null);
  assert.strictEqual(findDeepLinkInArgv(null), null);

  // Router: valid + allowed → createTab.
  {
    const createdTabs = [];
    const router = createDeepLinkRouter({
      isAllowedNavigation: (url) => url.startsWith("https://example.atlassian.net"),
      createTab: (url, options) => {
        const tab = { id: "tab-x", url, options };
        createdTabs.push(tab);
        return tab;
      }
    });

    const result = router.route("jira-desktop://open?url=https%3A%2F%2Fexample.atlassian.net%2Fbrowse%2FABC-1");
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.url, "https://example.atlassian.net/browse/ABC-1");
    assert.strictEqual(createdTabs.length, 1);
    assert.strictEqual(createdTabs[0].url, "https://example.atlassian.net/browse/ABC-1");
    assert.strictEqual(createdTabs[0].options.activate, true);
  }

  // Router: disallowed host → refuses, no tab.
  {
    const createdTabs = [];
    const router = createDeepLinkRouter({
      isAllowedNavigation: () => false,
      createTab: (url) => {
        createdTabs.push(url);
        return { id: "tab-x", url };
      }
    });

    const result = router.route("https://malicious.example.com/");
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "not-allowed");
    assert.strictEqual(createdTabs.length, 0);
  }

  // Router: garbage input → invalid, no tab.
  {
    const createdTabs = [];
    const router = createDeepLinkRouter({
      isAllowedNavigation: () => true,
      createTab: (url) => {
        createdTabs.push(url);
        return { id: "tab-x", url };
      }
    });

    const result = router.route("ftp://example.com");
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "invalid");
    assert.strictEqual(createdTabs.length, 0);
  }
}

module.exports = {
  runDeepLinkTests
};
