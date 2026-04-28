const assert = require("assert");

const { PARTITION_PREFIX, isWorkspacePartition, workspacePartitionId } = require("../main/workspace-partition");

function runWorkspacePartitionTests() {
  assert.strictEqual(workspacePartitionId("default"), `${PARTITION_PREFIX}default`);
  assert.strictEqual(workspacePartitionId("space_1"), `${PARTITION_PREFIX}space_1`);
  assert.strictEqual(workspacePartitionId("team-a-b"), `${PARTITION_PREFIX}team-a-b`);

  assert.throws(() => workspacePartitionId(""), /Invalid workspace id/);
  assert.throws(() => workspacePartitionId("-leading-dash"), /Invalid workspace id/);
  assert.throws(() => workspacePartitionId("has space"), /Invalid workspace id/);
  assert.throws(() => workspacePartitionId("emoji-🚀"), /Invalid workspace id/);
  assert.throws(() => workspacePartitionId(null), /Invalid workspace id/);
  assert.throws(() => workspacePartitionId("a".repeat(65)), /Invalid workspace id/);

  assert.strictEqual(isWorkspacePartition(`${PARTITION_PREFIX}alpha`), true);
  assert.strictEqual(isWorkspacePartition("persist:other"), false);
  assert.strictEqual(isWorkspacePartition(""), false);
  assert.strictEqual(isWorkspacePartition(null), false);
}

module.exports = {
  runWorkspacePartitionTests
};
