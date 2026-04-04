const { runNavigationPolicyTests } = require("./navigation-policy.test");
const { runWorkspaceConfigTests } = require("./workspace-config.test");

runWorkspaceConfigTests();
runNavigationPolicyTests();

console.log("Unit tests passed.");
