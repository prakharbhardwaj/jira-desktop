const { runDevUserDataTests } = require("./dev-user-data.test");
const { runKeyboardShortcutTests } = require("./keyboard-shortcuts.test");
const { runNavigationPolicyTests } = require("./navigation-policy.test");
const { runUpdateCheckTests } = require("./update-check.test");
const { runWorkspaceConfigTests } = require("./workspace-config.test");

runDevUserDataTests();
runKeyboardShortcutTests();
runWorkspaceConfigTests();
runNavigationPolicyTests();
runUpdateCheckTests();

console.log("Unit tests passed.");
