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

  return null;
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
  registerShortcutHandler
};
