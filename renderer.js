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

/* ── Sidebar auto-hide ────────────────────────────────── */

let sidebarVisible = false;
let hideTimeout = null;

function showSidebar() {
  clearTimeout(hideTimeout);
  if (sidebarVisible) return;
  sidebarVisible = true;
  sidebar.classList.add("is-visible");
  window.jiraDesktop.setSidebarVisible(true);
}

function hideSidebar() {
  clearTimeout(hideTimeout);
  hideTimeout = setTimeout(() => {
    if (document.body.dataset.view === "loading" || document.body.dataset.view === "error" || document.body.dataset.view === "setup") return;
    sidebarVisible = false;
    sidebar.classList.remove("is-visible");
    window.jiraDesktop.setSidebarVisible(false);
  }, 400);
}

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

function renderTabs(state) {
  tabStripElement.innerHTML = "";

  for (const tab of state.tabs) {
    const tabShell = document.createElement("div");
    tabShell.className = `tab ${tab.isActive ? "is-active" : ""}`;
    tabShell.setAttribute("role", "tab");
    tabShell.setAttribute("aria-selected", tab.isActive ? "true" : "false");

    const tabButton = document.createElement("button");
    tabButton.className = "tab-button";
    tabButton.type = "button";
    tabButton.dataset.tabId = tab.id;

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
  const hasOverlay =
    document.body.dataset.view === "loading" ||
    document.body.dataset.view === "error" ||
    document.body.dataset.view === "setup";
  if (hasOverlay && !sidebarVisible) {
    showSidebar();
  }
}

tabStripElement.addEventListener("click", (event) => {
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
