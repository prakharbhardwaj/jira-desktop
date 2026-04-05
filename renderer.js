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
const sidebarLockBtn = document.getElementById("sidebar-lock");
const themeToggleBtn = document.getElementById("theme-toggle");
const updateBanner = document.getElementById("update-banner");
const updateText = document.getElementById("update-text");
const updateAction = document.getElementById("update-action");
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
  if (sidebarLocked) return;
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
    tabShell.setAttribute("role", "tab");
    tabShell.setAttribute("aria-selected", tab.isActive ? "true" : "false");

    const tabButton = document.createElement("button");
    tabButton.className = "tab-button";
    tabButton.type = "button";
    tabButton.dataset.tabId = tab.id;

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
  currentState = state;
  renderTabs(state);
  renderOverlay(state);

  // Force sidebar visible during loading/error overlays
  const hasOverlay = document.body.dataset.view === "loading" || document.body.dataset.view === "error" || document.body.dataset.view === "setup";
  if (hasOverlay && !sidebarVisible) {
    showSidebar();
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

window.jiraDesktop.getState().then((state) => {
  render(state);
});

/* ── Update check ─────────────────────────────────────── */

window.jiraDesktop.checkUpdate().then((update) => {
  if (update && update.available) {
    updateBanner.hidden = false;
    updateText.textContent = `Version ${update.version} is available!`;
    updateAction.addEventListener("click", () => {
      window.jiraDesktop.openExternal(update.url);
    });
  }
});

updateDismiss.addEventListener("click", () => {
  updateBanner.hidden = true;
});
