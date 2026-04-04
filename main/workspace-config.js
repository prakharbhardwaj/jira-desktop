const DEFAULT_SETUP_MESSAGE = "Enter the Jira URL you want to use and Jira Desktop will remember it on this device.";
const WORKSPACE_CONFIG_FILENAME = "workspace.json";

function getCliArgument(argv, name) {
  const prefix = `${name}=`;
  const argument = argv.find((value) => value.startsWith(prefix));

  return argument ? argument.slice(prefix.length) : "";
}

function normalizeUrl(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);

    if (parsedUrl.protocol !== "https:") {
      throw new Error("Jira URL must use HTTPS.");
    }

    return parsedUrl;
  } catch (error) {
    throw new Error(`Invalid JIRA_URL: ${error.message}`);
  }
}

function getRuntimeOverrides({ argv = process.argv, env = process.env } = {}) {
  const rawJiraUrl = (getCliArgument(argv, "--jira-url") || env.JIRA_URL || "").trim();
  const allowedHosts = (getCliArgument(argv, "--jira-allowed-hosts") || env.JIRA_ALLOWED_HOSTS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return {
    rawJiraUrl,
    allowedHosts
  };
}

function createConfigState(options = {}, runtimeOverrides = { allowedHosts: [] }) {
  const {
    jiraUrl = "",
    setupMessage = DEFAULT_SETUP_MESSAGE,
    setupError = "",
    setupValue = "",
    workspaceSource = "none"
  } = options;

  if (!jiraUrl) {
    return {
      jiraUrl: "",
      jiraHost: "",
      allowedHosts: new Set(runtimeOverrides.allowedHosts),
      setupMessage,
      setupError,
      setupValue,
      workspaceSource
    };
  }

  const normalizedUrl = normalizeUrl(jiraUrl);

  return {
    jiraUrl: normalizedUrl.toString(),
    jiraHost: normalizedUrl.hostname.toLowerCase(),
    allowedHosts: new Set(runtimeOverrides.allowedHosts),
    setupMessage: "",
    setupError,
    setupValue: normalizedUrl.toString(),
    workspaceSource
  };
}

function createWorkspaceConfigStore({ app, fs, path, argv = process.argv, env = process.env }) {
  const runtimeOverrides = getRuntimeOverrides({ argv, env });

  function getWorkspaceConfigPath() {
    const storageDirectory = env.JIRA_DESKTOP_CONFIG_DIR || app.getPath("userData");

    return path.join(storageDirectory, WORKSPACE_CONFIG_FILENAME);
  }

  function readStoredWorkspaceUrl() {
    const configPath = getWorkspaceConfigPath();

    try {
      const rawFile = fs.readFileSync(configPath, "utf8");
      const parsedFile = JSON.parse(rawFile);

      return typeof parsedFile.jiraUrl === "string" ? parsedFile.jiraUrl.trim() : "";
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`Unable to read ${configPath}:`, error);
      }

      return "";
    }
  }

  function writeStoredWorkspaceUrl(jiraUrl) {
    const configPath = getWorkspaceConfigPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ jiraUrl }, null, 2));
  }

  function loadConfig(options = {}) {
    const { setupError = "", setupValue = "" } = options;
    const rawJiraUrl = runtimeOverrides.rawJiraUrl || readStoredWorkspaceUrl();
    const workspaceSource = runtimeOverrides.rawJiraUrl ? "runtime" : rawJiraUrl ? "saved" : "none";

    if (!rawJiraUrl) {
      return createConfigState(
        {
          setupError,
          setupValue,
          workspaceSource
        },
        runtimeOverrides
      );
    }

    try {
      return createConfigState(
        {
          jiraUrl: rawJiraUrl,
          setupError,
          workspaceSource
        },
        runtimeOverrides
      );
    } catch (error) {
      return createConfigState(
        {
          setupError: setupError || error.message,
          setupValue: setupValue || rawJiraUrl,
          workspaceSource
        },
        runtimeOverrides
      );
    }
  }

  return {
    createConfigState: (options = {}) => createConfigState(options, runtimeOverrides),
    getRuntimeOverrides: () => runtimeOverrides,
    getWorkspaceConfigPath,
    loadConfig,
    normalizeUrl,
    readStoredWorkspaceUrl,
    writeStoredWorkspaceUrl
  };
}

module.exports = {
  DEFAULT_SETUP_MESSAGE,
  WORKSPACE_CONFIG_FILENAME,
  createConfigState,
  createWorkspaceConfigStore,
  getCliArgument,
  getRuntimeOverrides,
  normalizeUrl
};
