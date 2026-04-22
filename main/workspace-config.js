const { workspacePartitionId } = require("./workspace-partition");

const SCHEMA_VERSION = 2;
const DEFAULT_SETUP_MESSAGE = "Enter the Jira URL you want to use and Jira Desktop will remember it on this device.";
const WORKSPACE_CONFIG_FILENAME = "workspace.json";
const DEFAULT_SPACE_ID = "default";
const DEFAULT_PARTITION_FOR_DEFAULT_SPACE = null;
const ACCENT_PALETTE = [
  "#2684ff",
  "#ff5630",
  "#36b37e",
  "#ffab00",
  "#6554c0",
  "#00b8d9",
  "#ff8b00",
  "#8777d9"
];

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

function generateSpaceId(name) {
  const slug = String(name || "space")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 8);

  return slug ? `${slug}-${suffix}` : `space-${suffix}`;
}

function deriveSpaceName(jiraUrl) {
  try {
    return new URL(jiraUrl).hostname.split(".")[0] || "Jira";
  } catch {
    return "Jira";
  }
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

function normalizeSpace(rawSpace, fallbackAccent) {
  if (!rawSpace || typeof rawSpace !== "object") {
    return null;
  }

  const id = typeof rawSpace.id === "string" && rawSpace.id.trim() ? rawSpace.id.trim() : "";
  const rawJiraUrl = typeof rawSpace.jiraUrl === "string" ? rawSpace.jiraUrl.trim() : "";

  if (!id || !rawJiraUrl) {
    return null;
  }

  let normalizedJiraUrl;

  try {
    normalizedJiraUrl = normalizeUrl(rawJiraUrl).toString();
  } catch {
    return null;
  }

  const name =
    typeof rawSpace.name === "string" && rawSpace.name.trim()
      ? rawSpace.name.trim().slice(0, 30)
      : deriveSpaceName(normalizedJiraUrl);
  const accent =
    typeof rawSpace.accent === "string" && /^#[0-9a-f]{6}$/i.test(rawSpace.accent) ? rawSpace.accent : fallbackAccent;
  const icon = typeof rawSpace.icon === "string" ? rawSpace.icon.slice(0, 4) : "";
  const partition =
    rawSpace.partition === null
      ? null
      : typeof rawSpace.partition === "string" && rawSpace.partition.startsWith("persist:")
      ? rawSpace.partition
      : null;
  const session = normalizeSession(rawSpace.session);

  return {
    id,
    name,
    accent,
    icon,
    jiraUrl: normalizedJiraUrl,
    partition,
    session: session || null
  };
}

function migrateLegacy(legacy) {
  const rawJiraUrl = typeof legacy.jiraUrl === "string" ? legacy.jiraUrl.trim() : "";

  if (!rawJiraUrl) {
    return createEmptyV2({ openLinksInApp: legacy.openLinksInApp === true });
  }

  let normalizedJiraUrl;

  try {
    normalizedJiraUrl = normalizeUrl(rawJiraUrl).toString();
  } catch {
    return createEmptyV2({ openLinksInApp: legacy.openLinksInApp === true });
  }

  const session = normalizeSession(legacy.session);
  const defaultSpace = {
    id: DEFAULT_SPACE_ID,
    name: deriveSpaceName(normalizedJiraUrl),
    accent: ACCENT_PALETTE[0],
    icon: "",
    jiraUrl: normalizedJiraUrl,
    partition: DEFAULT_PARTITION_FOR_DEFAULT_SPACE,
    session
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    activeSpaceId: DEFAULT_SPACE_ID,
    spaces: [defaultSpace],
    openLinksInApp: legacy.openLinksInApp === true
  };
}

function createEmptyV2({ openLinksInApp = false } = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    activeSpaceId: "",
    spaces: [],
    openLinksInApp: !!openLinksInApp
  };
}

function normalizeV2(raw) {
  if (!raw || typeof raw !== "object") {
    return createEmptyV2();
  }

  const spaces = Array.isArray(raw.spaces)
    ? raw.spaces
        .map((space, index) => normalizeSpace(space, ACCENT_PALETTE[index % ACCENT_PALETTE.length]))
        .filter(Boolean)
    : [];
  const activeSpaceId =
    typeof raw.activeSpaceId === "string" && spaces.some((space) => space.id === raw.activeSpaceId)
      ? raw.activeSpaceId
      : spaces[0]
      ? spaces[0].id
      : "";

  return {
    schemaVersion: SCHEMA_VERSION,
    activeSpaceId,
    spaces,
    openLinksInApp: raw.openLinksInApp === true
  };
}

function serializeV2(state) {
  return {
    schemaVersion: SCHEMA_VERSION,
    activeSpaceId: state.activeSpaceId,
    spaces: state.spaces.map((space) => ({
      id: space.id,
      name: space.name,
      accent: space.accent,
      icon: space.icon,
      jiraUrl: space.jiraUrl,
      partition: space.partition,
      ...(space.session ? { session: space.session } : {})
    })),
    openLinksInApp: state.openLinksInApp === true
  };
}

function buildActiveConfig(state, runtimeOverrides, setupExtras = {}) {
  const { setupError = "", setupValue = "" } = setupExtras;
  const runtimeJiraUrl = runtimeOverrides.rawJiraUrl;
  const runtimeAllowedHosts = new Set(runtimeOverrides.allowedHosts);

  if (runtimeJiraUrl) {
    try {
      const normalized = normalizeUrl(runtimeJiraUrl);

      return {
        jiraUrl: normalized.toString(),
        jiraHost: normalized.hostname.toLowerCase(),
        allowedHosts: runtimeAllowedHosts,
        setupMessage: "",
        setupError,
        setupValue: normalized.toString(),
        workspaceSource: "runtime",
        spaceId: null
      };
    } catch (error) {
      return {
        jiraUrl: "",
        jiraHost: "",
        allowedHosts: runtimeAllowedHosts,
        setupMessage: DEFAULT_SETUP_MESSAGE,
        setupError: setupError || error.message,
        setupValue: setupValue || runtimeJiraUrl,
        workspaceSource: "runtime",
        spaceId: null
      };
    }
  }

  const activeSpace = state.spaces.find((space) => space.id === state.activeSpaceId) || null;

  if (!activeSpace) {
    return {
      jiraUrl: "",
      jiraHost: "",
      allowedHosts: new Set([...runtimeAllowedHosts]),
      setupMessage: DEFAULT_SETUP_MESSAGE,
      setupError,
      setupValue,
      workspaceSource: state.spaces.length === 0 ? "none" : "saved",
      spaceId: null
    };
  }

  const crossSpaceHosts = state.spaces
    .filter((space) => space.id !== activeSpace.id)
    .map((space) => {
      try {
        return new URL(space.jiraUrl).hostname.toLowerCase();
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  return {
    jiraUrl: activeSpace.jiraUrl,
    jiraHost: new URL(activeSpace.jiraUrl).hostname.toLowerCase(),
    allowedHosts: new Set([...runtimeAllowedHosts, ...crossSpaceHosts]),
    setupMessage: "",
    setupError,
    setupValue: activeSpace.jiraUrl,
    workspaceSource: "saved",
    spaceId: activeSpace.id
  };
}

function partitionForSpace(space) {
  if (!space) return null;
  if (space.partition) return space.partition;
  if (space.id === DEFAULT_SPACE_ID) return DEFAULT_PARTITION_FOR_DEFAULT_SPACE;

  return workspacePartitionId(space.id.replace(/[^a-z0-9_-]/gi, "").slice(0, 60) || "space");
}

function createWorkspaceConfigStore({ app, fs, path, argv = process.argv, env = process.env }) {
  const runtimeOverrides = getRuntimeOverrides({ argv, env });
  let state = createEmptyV2();

  function getWorkspaceConfigPath() {
    const storageDirectory = env.JIRA_DESKTOP_CONFIG_DIR || app.getPath("userData");

    return path.join(storageDirectory, WORKSPACE_CONFIG_FILENAME);
  }

  function readRaw() {
    const configPath = getWorkspaceConfigPath();

    try {
      return JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`Unable to read ${configPath}:`, error);
      }

      return null;
    }
  }

  function writeRaw(nextData) {
    const configPath = getWorkspaceConfigPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(nextData, null, 2));
  }

  function persist() {
    writeRaw(serializeV2(state));
  }

  function hydrate() {
    const raw = readRaw();

    if (!raw) {
      state = createEmptyV2();
      return;
    }

    if (raw.schemaVersion === SCHEMA_VERSION) {
      state = normalizeV2(raw);
      return;
    }

    state = migrateLegacy(raw);
    persist();
  }

  function getSpaces() {
    return state.spaces.map((space) => ({ ...space }));
  }

  function getActiveSpace() {
    const active = state.spaces.find((space) => space.id === state.activeSpaceId) || null;

    return active ? { ...active } : null;
  }

  function setActiveSpace(spaceId) {
    if (!state.spaces.some((space) => space.id === spaceId)) {
      return false;
    }

    state.activeSpaceId = spaceId;
    persist();

    return true;
  }

  function addSpace({ name, jiraUrl, accent, icon } = {}) {
    const normalizedJiraUrl = normalizeUrl(jiraUrl).toString();
    const safeName =
      typeof name === "string" && name.trim() ? name.trim().slice(0, 30) : deriveSpaceName(normalizedJiraUrl);
    const id = generateSpaceId(safeName);
    const safeAccent =
      typeof accent === "string" && /^#[0-9a-f]{6}$/i.test(accent)
        ? accent
        : ACCENT_PALETTE[state.spaces.length % ACCENT_PALETTE.length];
    const safeIcon = typeof icon === "string" ? icon.slice(0, 4) : "";

    const newSpace = {
      id,
      name: safeName,
      accent: safeAccent,
      icon: safeIcon,
      jiraUrl: normalizedJiraUrl,
      partition: workspacePartitionId(id),
      session: null
    };

    state.spaces.push(newSpace);

    if (!state.activeSpaceId) {
      state.activeSpaceId = id;
    }

    persist();

    return { ...newSpace };
  }

  function updateSpace(spaceId, changes = {}) {
    const space = state.spaces.find((entry) => entry.id === spaceId);

    if (!space) return null;

    if (typeof changes.name === "string" && changes.name.trim()) {
      space.name = changes.name.trim().slice(0, 30);
    }

    if (typeof changes.accent === "string" && /^#[0-9a-f]{6}$/i.test(changes.accent)) {
      space.accent = changes.accent;
    }

    if (typeof changes.icon === "string") {
      space.icon = changes.icon.slice(0, 4);
    }

    if (typeof changes.jiraUrl === "string") {
      space.jiraUrl = normalizeUrl(changes.jiraUrl).toString();
    }

    persist();

    return { ...space };
  }

  function removeSpace(spaceId) {
    if (state.spaces.length <= 1) {
      return false;
    }

    const index = state.spaces.findIndex((space) => space.id === spaceId);

    if (index === -1) return false;

    const [removed] = state.spaces.splice(index, 1);

    if (state.activeSpaceId === spaceId) {
      state.activeSpaceId = state.spaces[0].id;
    }

    persist();

    return removed ? { ...removed } : false;
  }

  function writeSpaceSession(spaceId, session) {
    const space = state.spaces.find((entry) => entry.id === spaceId);

    if (!space) return;

    space.session = normalizeSession(session);
    persist();
  }

  function readSpaceSession(spaceId) {
    const space = state.spaces.find((entry) => entry.id === spaceId);

    return space && space.session ? JSON.parse(JSON.stringify(space.session)) : null;
  }

  function writeStoredWorkspaceUrl(rawJiraUrl) {
    const normalizedJiraUrl = normalizeUrl(rawJiraUrl).toString();

    if (state.spaces.length === 0) {
      const defaultSpace = {
        id: DEFAULT_SPACE_ID,
        name: deriveSpaceName(normalizedJiraUrl),
        accent: ACCENT_PALETTE[0],
        icon: "",
        jiraUrl: normalizedJiraUrl,
        partition: DEFAULT_PARTITION_FOR_DEFAULT_SPACE,
        session: null
      };

      state.spaces.push(defaultSpace);
      state.activeSpaceId = DEFAULT_SPACE_ID;
      persist();
      return;
    }

    const activeSpace = state.spaces.find((space) => space.id === state.activeSpaceId) || state.spaces[0];

    activeSpace.jiraUrl = normalizedJiraUrl;
    activeSpace.session = null;
    persist();
  }

  function loadConfig(setupExtras = {}) {
    hydrate();

    return buildActiveConfig(state, runtimeOverrides, setupExtras);
  }

  function readOpenLinksInApp() {
    return state.openLinksInApp === true;
  }

  function writeOpenLinksInApp(enabled) {
    state.openLinksInApp = !!enabled;
    persist();
  }

  return {
    ACCENT_PALETTE,
    addSpace,
    getActiveSpace,
    getRuntimeOverrides: () => runtimeOverrides,
    getSpaces,
    getWorkspaceConfigPath,
    loadConfig,
    normalizeUrl,
    partitionForSpace,
    readOpenLinksInApp,
    readSpaceSession,
    removeSpace,
    setActiveSpace,
    updateSpace,
    writeOpenLinksInApp,
    writeSpaceSession,
    writeStoredWorkspaceUrl
  };
}

module.exports = {
  ACCENT_PALETTE,
  DEFAULT_SETUP_MESSAGE,
  DEFAULT_SPACE_ID,
  SCHEMA_VERSION,
  WORKSPACE_CONFIG_FILENAME,
  createWorkspaceConfigStore,
  getCliArgument,
  getRuntimeOverrides,
  migrateLegacy,
  normalizeUrl,
  normalizeV2,
  partitionForSpace
};
