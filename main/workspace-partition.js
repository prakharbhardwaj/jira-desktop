const PARTITION_PREFIX = "persist:workspace-";
const WORKSPACE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function workspacePartitionId(workspaceId) {
  if (typeof workspaceId !== "string" || !WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new Error(`Invalid workspace id: ${JSON.stringify(workspaceId)}`);
  }

  return `${PARTITION_PREFIX}${workspaceId}`;
}

function isWorkspacePartition(partition) {
  return typeof partition === "string" && partition.startsWith(PARTITION_PREFIX);
}

module.exports = {
  PARTITION_PREFIX,
  WORKSPACE_ID_PATTERN,
  isWorkspacePartition,
  workspacePartitionId
};
