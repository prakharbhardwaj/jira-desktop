const tabStripElement = document.getElementById("tab-strip");
const newTabButton = document.getElementById("new-tab-button");
const statusLayerElement = document.getElementById("status-layer");
const titleElement = document.getElementById("title");
const messageElement = document.getElementById("message");
const targetUrlElement = document.getElementById("target-url");
const workspaceFormElement = document.getElementById("workspace-form");
const workspaceInputElement = document.getElementById("workspace-url-input");
const workspaceErrorElement = document.getElementById("workspace-error");
const workspaceSubmitElement = document.getElementById("workspace-submit");
const progressBar = document.getElementById("progress-bar");
const cardIcon = document.getElementById("card-icon");
const retryButton = document.getElementById("retry-button");
const sidebar = document.getElementById("sidebar");
const sidebarTrigger = document.getElementById("sidebar-trigger");
const workspaceDots = document.getElementById("workspace-dots");
const workspaceAdd = document.getElementById("workspace-add");
const workspaceNameEl = document.getElementById("sidebar-workspace-name");
const workspaceAccentEl = document.getElementById("sidebar-workspace-accent");
const tabStripContainer = document.getElementById("tab-strip");
const spaceMenu = document.getElementById("space-menu");
const spaceModal = document.getElementById("space-modal");
const spaceModalForm = document.getElementById("space-modal-form");
const spaceModalTitle = document.getElementById("space-modal-title");
const spaceModalName = document.getElementById("space-modal-name");
const spaceModalUrl = document.getElementById("space-modal-url");
const spaceModalIcon = document.getElementById("space-modal-icon");
const spaceModalPalette = document.getElementById("space-modal-palette");
const spaceModalError = document.getElementById("space-modal-error");
const spaceModalCancel = document.getElementById("space-modal-cancel");
const spaceModalSubmit = document.getElementById("space-modal-submit");
const spaceModalUrlField = spaceModal.querySelector("[data-url-field]");
const spaceModalSubtitle = spaceModal.querySelector(".space-panel-subtitle");
const spaceModalIllustration = document.getElementById("space-modal-illustration");
const spaceDeleteModal = document.getElementById("space-delete-modal");
const spaceDeleteText = document.getElementById("space-delete-text");
const spaceDeleteCancel = document.getElementById("space-delete-cancel");
const spaceDeleteConfirm = document.getElementById("space-delete-confirm");
const sidebarLockBtn = document.getElementById("sidebar-lock");
const themeToggleBtn = document.getElementById("theme-toggle");
const deepLinkToggleBtn = document.getElementById("deep-link-toggle");
const updateBanner = document.getElementById("update-banner");
const updateText = document.getElementById("update-text");
const updateAction = document.getElementById("update-action");
const updateChangelog = document.getElementById("update-changelog");
const updateDismiss = document.getElementById("update-dismiss");

let currentState = {
  activeTabId: null,
  setup: {
    required: false,
    message: "",
    errorMessage: "",
    value: ""
  },
  tabs: []
};
let workspaceSubmitPending = false;
let updateBannerVisible = false;

/* ── Theme ────────────────────────────────────────────── */

let currentTheme = localStorage.getItem("theme") || "dark";
document.documentElement.setAttribute("data-theme", currentTheme);

const SUN_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
const MOON_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M14 8.5a6.5 6.5 0 0 1-12.68 2A6.5 6.5 0 0 0 12 1.32 6.48 6.48 0 0 1 14 8.5z" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>';

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  window.jiraDesktop.setTheme(theme);
  themeToggleBtn.innerHTML = theme === "dark" ? SUN_ICON : MOON_ICON;
  themeToggleBtn.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
}

applyTheme(currentTheme);

themeToggleBtn.addEventListener("click", () => {
  applyTheme(currentTheme === "dark" ? "light" : "dark");
});

/* ── Sidebar auto-hide + lock ─────────────────────────── */

let sidebarVisible = false;
let hideTimeout = null;
let sidebarLocked = localStorage.getItem("sidebarLocked") === "true";

function applySidebarLock() {
  sidebar.classList.toggle("is-locked", sidebarLocked);
  sidebarLockBtn.setAttribute("aria-pressed", sidebarLocked ? "true" : "false");
  if (sidebarLocked) {
    showSidebar();
  }
}

applySidebarLock();

function toggleSidebarLock() {
  sidebarLocked = !sidebarLocked;
  localStorage.setItem("sidebarLocked", sidebarLocked);
  applySidebarLock();
}

function showSidebar() {
  clearTimeout(hideTimeout);
  if (sidebarVisible) return;
  sidebarVisible = true;
  sidebar.classList.add("is-visible");
  window.jiraDesktop.setSidebarVisible(true);
}

function hideSidebar() {
  clearTimeout(hideTimeout);
  if (sidebarLocked || updateBannerVisible) return;
  hideTimeout = setTimeout(() => {
    if (document.body.dataset.view === "loading" || document.body.dataset.view === "error" || document.body.dataset.view === "setup") return;
    sidebarVisible = false;
    sidebar.classList.remove("is-visible");
    window.jiraDesktop.setSidebarVisible(false);
  }, 400);
}

sidebarLockBtn.addEventListener("click", toggleSidebarLock);

sidebarTrigger.addEventListener("mouseenter", showSidebar);
sidebar.addEventListener("mouseenter", () => {
  clearTimeout(hideTimeout);
  showSidebar();
});
sidebar.addEventListener("mouseleave", hideSidebar);
sidebarTrigger.addEventListener("mouseleave", () => {
  if (!sidebar.matches(":hover")) {
    hideSidebar();
  }
});

/* ── Keyboard shortcuts ───────────────────────────────── */

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    toggleSidebarLock();
  }
});

/* ── Pin icon SVG ─────────────────────────────────────── */

const PIN_ICON_OUTLINE =
  '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v3l2 1v3H5V6l2-1V2"/><line x1="8" y1="9" x2="8" y2="14"/><line x1="5" y1="2" x2="11" y2="2"/></svg>';
const PIN_ICON_FILLED =
  '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v3l2 1v3H5V6l2-1V2"/><line x1="8" y1="9" x2="8" y2="14"/><line x1="5" y1="2" x2="11" y2="2"/></svg>';

function renderTabs(state) {
  tabStripElement.innerHTML = "";

  let hasPinned = false;
  let addedDivider = false;

  for (const tab of state.tabs) {
    if (tab.isPinned) hasPinned = true;

    if (hasPinned && !tab.isPinned && !addedDivider) {
      const divider = document.createElement("div");
      divider.className = "pin-divider";
      tabStripElement.appendChild(divider);
      addedDivider = true;
    }

    const tabShell = document.createElement("div");
    tabShell.className = `tab ${tab.isActive ? "is-active" : ""} ${tab.isPinned ? "is-pinned" : ""}`;

    const tabButton = document.createElement("div");
    tabButton.className = "tab-button";
    tabButton.dataset.tabId = tab.id;
    tabButton.setAttribute("role", "tab");
    tabButton.setAttribute("aria-selected", tab.isActive ? "true" : "false");
    tabButton.tabIndex = tab.isActive ? 0 : -1;

    const pinBtn = document.createElement("button");
    pinBtn.className = "tab-pin";
    pinBtn.type = "button";
    pinBtn.dataset.pinTabId = tab.id;
    pinBtn.setAttribute("aria-label", tab.isPinned ? "Unpin tab" : "Pin tab");
    pinBtn.title = tab.isPinned ? "Unpin" : "Pin";
    pinBtn.innerHTML = tab.isPinned ? PIN_ICON_FILLED : PIN_ICON_OUTLINE;
    tabButton.appendChild(pinBtn);

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title || "Jira";
    tabButton.appendChild(title);

    if (tab.status === "loading") {
      const loadingDot = document.createElement("span");
      loadingDot.className = "tab-loading";
      loadingDot.setAttribute("aria-label", "Loading");
      tabButton.appendChild(loadingDot);
    }

    if (tab.isClosable) {
      const closeButton = document.createElement("button");
      closeButton.className = "tab-close";
      closeButton.type = "button";
      closeButton.dataset.closeTabId = tab.id;
      closeButton.setAttribute("aria-label", `Close ${tab.title || "tab"}`);
      closeButton.innerHTML =
        '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
      tabButton.appendChild(closeButton);
    }

    tabShell.appendChild(tabButton);
    tabStripElement.appendChild(tabShell);
  }
}

async function submitWorkspaceUrl() {
  if (workspaceSubmitPending) {
    return;
  }

  const workspaceUrl = workspaceInputElement.value.trim();
  workspaceSubmitPending = true;
  workspaceErrorElement.hidden = true;
  workspaceErrorElement.textContent = "";
  render(currentState);

  try {
    const result = await window.jiraDesktop.saveWorkspaceUrl(workspaceUrl);

    if (!result.ok) {
      workspaceErrorElement.hidden = false;
      workspaceErrorElement.textContent = result.error || "Unable to save the Jira URL.";
    }
  } finally {
    workspaceSubmitPending = false;
    render(currentState);
  }
}

function renderOverlay(state) {
  if (state.setup.required) {
    statusLayerElement.hidden = false;
    titleElement.textContent = "Set up Jira Desktop";
    messageElement.textContent = state.setup.message;
    targetUrlElement.textContent = "";
    workspaceFormElement.hidden = false;
    progressBar.hidden = true;
    retryButton.hidden = true;
    retryButton.disabled = false;
    retryButton.textContent = "Retry";
    workspaceErrorElement.hidden = !state.setup.errorMessage;
    workspaceErrorElement.textContent = state.setup.errorMessage || "";
    workspaceInputElement.disabled = workspaceSubmitPending;
    workspaceSubmitElement.disabled = workspaceSubmitPending;
    workspaceSubmitElement.textContent = workspaceSubmitPending ? "Saving..." : "Continue";

    if (!workspaceInputElement.matches(":focus") || !workspaceInputElement.value.trim()) {
      workspaceInputElement.value = state.setup.value || "";
    }

    document.body.dataset.view = "setup";
    return;
  }

  workspaceFormElement.hidden = true;
  workspaceErrorElement.hidden = true;
  workspaceErrorElement.textContent = "";

  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);

  if (!activeTab) {
    statusLayerElement.hidden = false;
    titleElement.textContent = "Loading Jira";
    messageElement.textContent = "Preparing your workspace...";
    targetUrlElement.textContent = "";
    progressBar.hidden = false;
    retryButton.hidden = true;
    document.body.dataset.view = "loading";
    return;
  }

  const shouldShowOverlay = activeTab.status === "error" || (activeTab.status === "loading" && !activeTab.hasLoadedOnce);

  statusLayerElement.hidden = !shouldShowOverlay;

  if (!shouldShowOverlay) {
    delete document.body.dataset.view;
    return;
  }

  targetUrlElement.textContent = activeTab.url || "";

  if (activeTab.status === "error") {
    document.body.dataset.view = "error";
    titleElement.textContent = "Jira is unavailable";
    messageElement.textContent = activeTab.errorMessage || "The desktop client could not load Jira.";
    progressBar.hidden = true;
    retryButton.hidden = false;
    retryButton.disabled = false;
    retryButton.textContent = "Retry";
    return;
  }

  document.body.dataset.view = "loading";
  titleElement.textContent = "Loading Jira";
  messageElement.textContent = "Connecting to your Jira workspace. This may take a moment.";
  progressBar.hidden = false;
  retryButton.hidden = true;
}

function render(state) {
  const previousSpaceId = currentState && currentState.activeSpaceId;
  currentState = state;

  if (state.activeSpaceId !== spacesState.activeSpaceId || state.activeSpaceId !== previousSpaceId) {
    void reloadSpaces();
  }

  renderTabs(state);
  renderOverlay(state);

  // Force sidebar visible during loading/error overlays
  const hasOverlay = document.body.dataset.view === "loading" || document.body.dataset.view === "error" || document.body.dataset.view === "setup";
  if (hasOverlay && !sidebarVisible) {
    showSidebar();
  }
}

function setUpdateBannerVisible(visible) {
  updateBannerVisible = visible;
  updateBanner.hidden = !visible;

  if (visible) {
    showSidebar();
    return;
  }

  if (!sidebarLocked && !sidebar.matches(":hover")) {
    hideSidebar();
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function syncInitialState() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const state = await window.jiraDesktop.getState();
    render(state);

    if (state.setup.required || state.tabs.length > 0) {
      return;
    }

    await wait(100);
  }
}

tabStripElement.addEventListener("click", (event) => {
  const pinButton = event.target.closest("[data-pin-tab-id]");

  if (pinButton) {
    event.stopPropagation();
    window.jiraDesktop.togglePinTab(pinButton.dataset.pinTabId);
    return;
  }

  const closeButton = event.target.closest("[data-close-tab-id]");

  if (closeButton) {
    event.stopPropagation();
    window.jiraDesktop.closeTab(closeButton.dataset.closeTabId);
    return;
  }

  const tabButton = event.target.closest("[data-tab-id]");

  if (tabButton) {
    window.jiraDesktop.switchTab(tabButton.dataset.tabId);
  }
});

tabStripElement.addEventListener("keydown", (event) => {
  const tabButton = event.target.closest(".tab-button[data-tab-id]");

  if (!tabButton) {
    return;
  }

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    window.jiraDesktop.switchTab(tabButton.dataset.tabId);
  }
});

newTabButton.addEventListener("click", () => {
  window.jiraDesktop.newTab();
});

workspaceFormElement.addEventListener("submit", async (event) => {
  event.preventDefault();
  void submitWorkspaceUrl();
});

workspaceSubmitElement.addEventListener("click", () => {
  void submitWorkspaceUrl();
});

workspaceInputElement.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void submitWorkspaceUrl();
  }
});

retryButton.addEventListener("click", () => {
  retryButton.disabled = true;
  retryButton.textContent = "Retrying...";
  window.jiraDesktop.retryActiveTab();
});

window.jiraDesktop.onState((state) => {
  render(state);
});

void syncInitialState();

/* ── Update check ─────────────────────────────────────── */

window.jiraDesktop.checkUpdate().then((update) => {
  if (update && update.available) {
    setUpdateBannerVisible(true);
    updateText.textContent = `Version ${update.version} is available!`;
    updateAction.hidden = !update.downloadUrl;
    updateAction.onclick = null;
    updateChangelog.onclick = null;

    if (update.downloadUrl) {
      updateAction.onclick = () => {
        window.jiraDesktop.openExternal(update.downloadUrl);
      };
    }

    updateChangelog.onclick = () => {
      window.jiraDesktop.openExternal(update.changelogUrl);
    };
    return;
  }

  setUpdateBannerVisible(false);
});

updateDismiss.addEventListener("click", () => {
  setUpdateBannerVisible(false);
});

/* ── Deep link setting ────────────────────────────────── */

function applyDeepLinkState({ enabled, supported }) {
  if (!supported) {
    deepLinkToggleBtn.hidden = true;
    return;
  }

  deepLinkToggleBtn.hidden = false;
  deepLinkToggleBtn.setAttribute("aria-pressed", enabled ? "true" : "false");
  deepLinkToggleBtn.title = enabled ? "Open Jira links in this app: on" : "Open Jira links in this app: off";
}

async function loadDeepLinkState() {
  try {
    const state = await window.jiraDesktop.getDeepLinkSetting();
    applyDeepLinkState(state || { enabled: false, supported: false });
  } catch {
    applyDeepLinkState({ enabled: false, supported: false });
  }
}

deepLinkToggleBtn.addEventListener("click", async () => {
  const next = deepLinkToggleBtn.getAttribute("aria-pressed") !== "true";
  deepLinkToggleBtn.disabled = true;

  try {
    const state = await window.jiraDesktop.setDeepLinkSetting(next);
    applyDeepLinkState(state || { enabled: next, supported: true });
  } finally {
    deepLinkToggleBtn.disabled = false;
  }
});

void loadDeepLinkState();

/* ── Spaces ───────────────────────────────────────────── */

let spacesState = { spaces: [], activeSpaceId: null, palette: [], runtimeOverride: false };
let lastSwipeAt = 0;

function activeSpace() {
  return spacesState.spaces.find((entry) => entry.id === spacesState.activeSpaceId) || null;
}

function renderSpaces() {
  workspaceDots.innerHTML = "";

  if (spacesState.runtimeOverride) {
    workspaceAdd.hidden = true;
  } else {
    workspaceAdd.hidden = false;
  }

  document.body.dataset.singleSpace = spacesState.spaces.length <= 1 ? "true" : "false";

  for (const space of spacesState.spaces) {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = `workspace-dot ${space.id === spacesState.activeSpaceId ? "is-active" : ""}`;
    dot.dataset.spaceId = space.id;
    dot.style.setProperty("--dot-color", space.accent || "#2684ff");
    dot.title = `${space.name}\n${space.jiraUrl}`;
    dot.setAttribute("role", "tab");
    dot.setAttribute("aria-label", space.name);
    dot.setAttribute("aria-selected", space.id === spacesState.activeSpaceId ? "true" : "false");

    workspaceDots.appendChild(dot);
  }

  const active = activeSpace();

  if (active) {
    workspaceNameEl.textContent = active.name;
    workspaceAccentEl.style.background = active.accent || "#2684ff";
    workspaceAccentEl.hidden = false;
  } else if (spacesState.runtimeOverride) {
    workspaceNameEl.textContent = "Jira Desktop";
    workspaceAccentEl.hidden = true;
  } else {
    workspaceNameEl.textContent = "Jira Desktop";
    workspaceAccentEl.hidden = true;
  }
}

async function reloadSpaces() {
  try {
    const result = await window.jiraDesktop.listSpaces();
    spacesState = result || spacesState;
    renderSpaces();
  } catch {
    /* ignore */
  }
}

async function switchToSpace(spaceId) {
  if (!spaceId || spaceId === spacesState.activeSpaceId) return;
  const result = await window.jiraDesktop.switchSpace(spaceId);

  if (result && result.ok) {
    spacesState = { ...spacesState, ...result };
    renderSpaces();
  }
}

workspaceDots.addEventListener("click", (event) => {
  const dot = event.target.closest("[data-space-id]");
  if (!dot) return;
  void switchToSpace(dot.dataset.spaceId);
});

workspaceDots.addEventListener("contextmenu", (event) => {
  const dot = event.target.closest("[data-space-id]");
  if (!dot) return;
  event.preventDefault();
  openSpaceMenu(dot.dataset.spaceId, event.clientX, event.clientY);
});

workspaceAdd.addEventListener("click", () => {
  openSpaceModal({ mode: "add" });
});

function switchSpaceByOffset(offset) {
  if (spacesState.runtimeOverride) return;
  const count = spacesState.spaces.length;
  if (count < 2) return;

  const currentIndex = spacesState.spaces.findIndex((entry) => entry.id === spacesState.activeSpaceId);
  const nextIndex = (((currentIndex < 0 ? 0 : currentIndex) + offset) % count + count) % count;
  void switchToSpace(spacesState.spaces[nextIndex].id);
}

// Arc-style two-finger horizontal swipe on the tab list switches workspace.
tabStripContainer.addEventListener(
  "wheel",
  (event) => {
    const { deltaX, deltaY } = event;

    if (Math.abs(deltaX) < 40) return;
    if (Math.abs(deltaX) <= Math.abs(deltaY) * 1.8) return;

    const now = Date.now();
    if (now - lastSwipeAt < 450) return;

    lastSwipeAt = now;
    event.preventDefault();
    switchSpaceByOffset(deltaX > 0 ? 1 : -1);
  },
  { passive: false }
);

/* ── Space context menu ───────────────────────────────── */

let activeMenuSpaceId = null;

function closeSpaceMenu() {
  spaceMenu.hidden = true;
  spaceMenu.innerHTML = "";
  activeMenuSpaceId = null;
}

function openSpaceMenu(spaceId, x, y) {
  if (spacesState.runtimeOverride) return;

  const space = spacesState.spaces.find((entry) => entry.id === spaceId);
  if (!space) return;

  activeMenuSpaceId = spaceId;
  spaceMenu.innerHTML = "";

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "space-menu-item";
  editButton.textContent = "Edit…";
  editButton.addEventListener("click", () => {
    closeSpaceMenu();
    openSpaceModal({ mode: "edit", space });
  });
  spaceMenu.appendChild(editButton);

  const separator = document.createElement("div");
  separator.className = "space-menu-separator";
  spaceMenu.appendChild(separator);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "space-menu-item is-danger";
  deleteButton.textContent = "Delete…";
  if (spacesState.spaces.length <= 1) {
    deleteButton.disabled = true;
    deleteButton.title = "Cannot delete the last remaining workspace";
  }
  deleteButton.addEventListener("click", () => {
    closeSpaceMenu();
    openDeleteModal(space);
  });
  spaceMenu.appendChild(deleteButton);

  spaceMenu.style.left = `${x}px`;
  spaceMenu.style.top = `${y}px`;
  spaceMenu.hidden = false;

  const rect = spaceMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    spaceMenu.style.left = `${window.innerWidth - rect.width - 4}px`;
  }
  if (rect.bottom > window.innerHeight) {
    spaceMenu.style.top = `${window.innerHeight - rect.height - 4}px`;
  }
}

document.addEventListener("click", (event) => {
  if (!activeMenuSpaceId) return;
  if (spaceMenu.contains(event.target)) return;
  closeSpaceMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSpaceMenu();
    closeSpaceModal();
    closeDeleteModal();
  }
});

/* ── Space modal (add / edit) ─────────────────────────── */

let spaceModalMode = "add";
let spaceModalSpaceId = null;
let spaceModalAccent = "";

function renderPalette(selected) {
  spaceModalPalette.innerHTML = "";
  spaceModalAccent = selected;

  for (const color of spacesState.palette || []) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = `space-panel-palette-swatch ${color === selected ? "is-selected" : ""}`;
    swatch.style.background = color;
    swatch.setAttribute("aria-label", color);
    swatch.dataset.accent = color;
    swatch.addEventListener("click", () => {
      spaceModalAccent = color;
      for (const el of spaceModalPalette.querySelectorAll(".space-panel-palette-swatch")) {
        el.classList.toggle("is-selected", el.dataset.accent === color);
      }
    });
    spaceModalPalette.appendChild(swatch);
  }
}

function openSpaceModal({ mode, space }) {
  spaceModalMode = mode;
  spaceModalSpaceId = space ? space.id : null;
  spaceModalError.hidden = true;
  spaceModalError.textContent = "";

  const subtitleEl = document.getElementById("space-modal-subtitle");

  if (mode === "add") {
    spaceModalTitle.textContent = "Create a workspace";
    if (subtitleEl) subtitleEl.textContent = "Separate your tabs by Jira account, project, or context.";
    spaceModalSubmit.textContent = "Create workspace";
    spaceModalName.value = "";
    spaceModalUrl.value = "";
    spaceModalIcon.value = "";
    spaceModalUrlField.hidden = false;
    renderPalette(spacesState.palette ? spacesState.palette[spacesState.spaces.length % spacesState.palette.length] : "#2684ff");
  } else {
    spaceModalTitle.textContent = "Edit workspace";
    if (subtitleEl) subtitleEl.textContent = `Update “${space.name || "workspace"}”.`;
    spaceModalSubmit.textContent = "Save changes";
    spaceModalName.value = space.name || "";
    spaceModalUrl.value = space.jiraUrl || "";
    spaceModalIcon.value = space.icon || "";
    spaceModalUrlField.hidden = false;
    renderPalette(space.accent || "#2684ff");
  }

  spaceModal.hidden = false;
  setTimeout(() => spaceModalName.focus(), 0);
}

function closeSpaceModal() {
  spaceModal.hidden = true;
}

spaceModalCancel.addEventListener("click", closeSpaceModal);
spaceModal.addEventListener("click", (event) => {
  if (event.target === spaceModal) closeSpaceModal();
});

spaceModalForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = spaceModalName.value.trim();
  const jiraUrl = spaceModalUrl.value.trim();
  const icon = spaceModalIcon.value.trim();
  const accent = spaceModalAccent;

  if (!name || !jiraUrl) return;

  spaceModalSubmit.disabled = true;

  try {
    let result;
    if (spaceModalMode === "add") {
      result = await window.jiraDesktop.addSpace({ name, jiraUrl, accent, icon });
    } else {
      result = await window.jiraDesktop.updateSpace({
        id: spaceModalSpaceId,
        changes: { name, jiraUrl, accent, icon }
      });
    }

    if (!result || !result.ok) {
      spaceModalError.hidden = false;
      spaceModalError.textContent = (result && result.error) || "Unable to save workspace.";
      return;
    }

    spacesState = { ...spacesState, ...result };
    renderSpaces();

    if (spaceModalMode === "add" && result.space) {
      const switchResult = await window.jiraDesktop.switchSpace(result.space.id);
      if (switchResult && switchResult.ok) {
        spacesState = { ...spacesState, ...switchResult };
        renderSpaces();
      }
    }

    closeSpaceModal();
  } finally {
    spaceModalSubmit.disabled = false;
  }
});

/* ── Delete confirmation modal ────────────────────────── */

let deleteTargetSpace = null;

function openDeleteModal(space) {
  deleteTargetSpace = space;
  spaceDeleteText.textContent = `This will sign you out of "${space.name}" and permanently delete its tabs and cookies on this device.`;
  spaceDeleteModal.hidden = false;
}

function closeDeleteModal() {
  spaceDeleteModal.hidden = true;
  deleteTargetSpace = null;
}

spaceDeleteCancel.addEventListener("click", closeDeleteModal);
spaceDeleteModal.addEventListener("click", (event) => {
  if (event.target === spaceDeleteModal) closeDeleteModal();
});

spaceDeleteConfirm.addEventListener("click", async () => {
  if (!deleteTargetSpace) return;
  spaceDeleteConfirm.disabled = true;

  try {
    const result = await window.jiraDesktop.deleteSpace(deleteTargetSpace.id);

    if (result && result.ok) {
      spacesState = { ...spacesState, ...result };
      renderSpaces();
    }

    closeDeleteModal();
  } finally {
    spaceDeleteConfirm.disabled = false;
  }
});

window.jiraDesktop.onSpacesChanged((payload) => {
  if (!payload) return;
  spacesState = { ...spacesState, ...payload };
  renderSpaces();
});

void reloadSpaces();
