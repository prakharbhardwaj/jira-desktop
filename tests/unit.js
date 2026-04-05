const { runDevUserDataTests } = require("./dev-user-data.test");
const { runKeyboardShortcutTests } = require("./keyboard-shortcuts.test");
const { runNavigationPolicyTests } = require("./navigation-policy.test");
const { runWorkspaceConfigTests } = require("./workspace-config.test");

runDevUserDataTests();
runKeyboardShortcutTests();
runWorkspaceConfigTests();
runNavigationPolicyTests();

console.log("Unit tests passed.");
