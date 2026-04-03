const tabStripElement = document.getElementById("tab-strip");
const newTabButton = document.getElementById("new-tab-button");
const statusLayerElement = document.getElementById("status-layer");
const titleElement = document.getElementById("title");
const messageElement = document.getElementById("message");
const targetUrlElement = document.getElementById("target-url");
const spinnerElement = document.getElementById("spinner");
const retryButton = document.getElementById("retry-button");

let currentState = {
  activeTabId: null,
  tabs: []
};

function renderTabs(state) {
  tabStripElement.innerHTML = "";

  for (const tab of state.tabs) {
    const tabShell = document.createElement("div");
    tabShell.className = `tab ${tab.isActive ? "is-active" : ""}`;

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
      loadingDot.setAttribute("aria-hidden", "true");
      tabButton.appendChild(loadingDot);
    }

    tabShell.appendChild(tabButton);

    if (tab.isClosable) {
      const closeButton = document.createElement("button");
      closeButton.className = "tab-close";
      closeButton.type = "button";
      closeButton.dataset.closeTabId = tab.id;
      closeButton.setAttribute("aria-label", `Close ${tab.title || "tab"}`);
      closeButton.textContent = "x";
      tabShell.appendChild(closeButton);
    }

    tabStripElement.appendChild(tabShell);
  }
}

function renderOverlay(state) {
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);

  if (!activeTab) {
    statusLayerElement.hidden = false;
    titleElement.textContent = "Loading Jira";
    messageElement.textContent = "Preparing your workspace...";
    targetUrlElement.textContent = "";
    spinnerElement.hidden = false;
    retryButton.hidden = true;
    return;
  }

  const shouldShowOverlay =
    activeTab.status === "error" ||
    (activeTab.status === "loading" && !activeTab.hasLoadedOnce);

  statusLayerElement.hidden = !shouldShowOverlay;

  if (!shouldShowOverlay) {
    return;
  }

  targetUrlElement.textContent = activeTab.url || "";

  if (activeTab.status === "error") {
    document.body.dataset.view = "error";
    titleElement.textContent = "Jira is unavailable";
    messageElement.textContent =
      activeTab.errorMessage || "The desktop client could not load Jira.";
    spinnerElement.hidden = true;
    retryButton.hidden = false;
    retryButton.disabled = false;
    retryButton.textContent = "Retry";
    return;
  }

  document.body.dataset.view = "loading";
  titleElement.textContent = "Loading Jira";
  messageElement.textContent = "Connecting to your Jira workspace. This may take a moment.";
  spinnerElement.hidden = false;
  retryButton.hidden = true;
}

function render(state) {
  currentState = state;
  renderTabs(state);
  renderOverlay(state);
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
