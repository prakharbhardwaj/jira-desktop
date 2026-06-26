function isCommandOrControl(input) {
  return !!(input && (input.control || input.meta));
}

function getShortcutCommand(input = {}) {
  if (input.type !== "keyDown") {
    return null;
  }

  const key = typeof input.key === "string" ? input.key.toLowerCase() : "";

  if (key === "f5") {
    return input.shift ? "force-reload-active-tab" : "reload-active-tab";
  }

  if (!isCommandOrControl(input) || input.alt) {
    return null;
  }

  if (key === "r") {
    return input.shift ? "force-reload-active-tab" : "reload-active-tab";
  }

  if (key === "t" && !input.shift) {
    return "new-tab";
  }

  if (key === "w" && !input.shift) {
    return "close-active-tab";
  }

  if (!input.shift && /^[1-9]$/.test(key)) {
    return `switch-space-index:${Number(key) - 1}`;
  }

  if (input.shift && (key === "]" || key === "}")) {
    return "switch-space-next";
  }

  if (input.shift && (key === "[" || key === "{")) {
    return "switch-space-prev";
  }

  return null;
}

// Cmd/Ctrl with +, =, -, _, or 0 are Chromium's built-in page-zoom accelerators.
// The shell renderer (sidebar) should stay at a fixed zoom; only Jira views zoom.
function isZoomShortcut(input = {}) {
  if (input.type !== "keyDown" || !isCommandOrControl(input)) {
    return false;
  }

  const key = typeof input.key === "string" ? input.key.toLowerCase() : "";

  return key === "+" || key === "=" || key === "-" || key === "_" || key === "0";
}

function registerShortcutHandler(webContents, runCommand) {
  webContents.on("before-input-event", (event, input) => {
    const command = getShortcutCommand(input);

    if (!command) {
      return;
    }

    event.preventDefault();
    runCommand(command);
  });
}

module.exports = {
  getShortcutCommand,
  isZoomShortcut,
  registerShortcutHandler
};
