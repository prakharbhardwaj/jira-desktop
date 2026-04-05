const assert = require("assert");

const { getShortcutCommand } = require("../main/keyboard-shortcuts");

function runKeyboardShortcutTests() {
  assert.strictEqual(getShortcutCommand({ type: "keyDown", key: "r", control: true }), "reload-active-tab");
  assert.strictEqual(getShortcutCommand({ type: "keyDown", key: "R", meta: true }), "reload-active-tab");
  assert.strictEqual(
    getShortcutCommand({ type: "keyDown", key: "r", meta: true, shift: true }),
    "force-reload-active-tab"
  );
  assert.strictEqual(getShortcutCommand({ type: "keyDown", key: "F5" }), "reload-active-tab");
  assert.strictEqual(getShortcutCommand({ type: "keyDown", key: "F5", shift: true }), "force-reload-active-tab");
  assert.strictEqual(getShortcutCommand({ type: "keyDown", key: "t", control: true }), "new-tab");
  assert.strictEqual(getShortcutCommand({ type: "keyDown", key: "w", meta: true }), "close-active-tab");
  assert.strictEqual(getShortcutCommand({ type: "keyDown", key: "r", control: true, alt: true }), null);
  assert.strictEqual(getShortcutCommand({ type: "char", key: "r", control: true }), null);
}

module.exports = {
  runKeyboardShortcutTests
};
