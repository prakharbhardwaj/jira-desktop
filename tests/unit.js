const { runDevUserDataTests } = require("./dev-user-data.test");
const { runKeyboardShortcutTests } = require("./keyboard-shortcuts.test");
const { runNavigationPolicyTests } = require("./navigation-policy.test");
const { runTabManagerTests } = require("./tab-manager.test");
const { runUpdateCheckTests } = require("./update-check.test");
const { runWorkspaceConfigTests } = require("./workspace-config.test");

runDevUserDataTests();
runKeyboardShortcutTests();
runWorkspaceConfigTests();
runNavigationPolicyTests();
runTabManagerTests();
runUpdateCheckTests();

console.log("Unit tests passed.");
