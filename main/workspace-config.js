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

  function readStoredWorkspaceFile() {
    const configPath = getWorkspaceConfigPath();

    try {
      return JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`Unable to read ${configPath}:`, error);
      }

      return {};
    }
  }

  function writeStoredWorkspaceFile(nextData) {
    const configPath = getWorkspaceConfigPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(nextData, null, 2));
  }

  function readStoredWorkspaceUrl() {
    const parsedFile = readStoredWorkspaceFile();

    return typeof parsedFile.jiraUrl === "string" ? parsedFile.jiraUrl.trim() : "";
  }

  function normalizeSession(session) {
    if (!session || typeof session !== "object" || !Array.isArray(session.tabs)) {
      return null;
    }

    const tabs = session.tabs
      .filter((tab) => tab && typeof tab.url === "string" && tab.url.trim())
      .map((tab) => ({
        url: normalizeUrl(tab.url.trim()).toString(),
        title: typeof tab.title === "string" && tab.title.trim() ? tab.title.trim() : "",
        pinned: !!tab.pinned
      }));

    if (tabs.length === 0) {
      return null;
    }

    const activeTabIndex =
      Number.isInteger(session.activeTabIndex) && session.activeTabIndex >= 0 && session.activeTabIndex < tabs.length
        ? session.activeTabIndex
        : 0;

    return {
      activeTabIndex,
      tabs
    };
  }

  function readStoredSession(jiraUrl) {
    if (!jiraUrl) {
      return null;
    }

    const parsedFile = readStoredWorkspaceFile();

    if (typeof parsedFile.jiraUrl !== "string") {
      return null;
    }

    try {
      if (normalizeUrl(parsedFile.jiraUrl).toString() !== normalizeUrl(jiraUrl).toString()) {
        return null;
      }

      return normalizeSession(parsedFile.session);
    } catch {
      return null;
    }
  }

  function writeStoredWorkspaceUrl(jiraUrl) {
    writeStoredWorkspaceFile({ jiraUrl });
  }

  function writeStoredSession(jiraUrl, session) {
    if (!jiraUrl) {
      return;
    }

    const normalizedJiraUrl = normalizeUrl(jiraUrl).toString();
    const nextData = { jiraUrl: normalizedJiraUrl };
    const normalizedSession = normalizeSession(session);

    if (normalizedSession) {
      nextData.session = normalizedSession;
    }

    writeStoredWorkspaceFile(nextData);
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
    readStoredSession,
    readStoredWorkspaceUrl,
    writeStoredSession,
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
