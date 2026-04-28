const { runDeepLinkTests } = require("./deep-link.test");
const { runDevUserDataTests } = require("./dev-user-data.test");
const { runKeyboardShortcutTests } = require("./keyboard-shortcuts.test");
const { runNavigationPolicyTests } = require("./navigation-policy.test");
const { runTabManagerTests } = require("./tab-manager.test");
const { runUpdateCheckTests } = require("./update-check.test");
const { runWorkspaceConfigTests } = require("./workspace-config.test");
const { runWorkspacePartitionTests } = require("./workspace-partition.test");

runDevUserDataTests();
runKeyboardShortcutTests();
runWorkspaceConfigTests();
runWorkspacePartitionTests();
runNavigationPolicyTests();
runTabManagerTests();
runDeepLinkTests();
runUpdateCheckTests();

console.log("Unit tests passed.");
