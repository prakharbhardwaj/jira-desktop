const assert = require("assert");

const { getShortcutCommand, isZoomShortcut } = require("../main/keyboard-shortcuts");

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

  assert.strictEqual(getShortcutCommand({ type: "keyDown", key: "1", meta: true }), "switch-space-index:0");
  assert.strictEqual(getShortcutCommand({ type: "keyDown", key: "9", control: true }), "switch-space-index:8");
  assert.strictEqual(getShortcutCommand({ type: "keyDown", key: "1", meta: true, shift: true }), null);
  assert.strictEqual(
    getShortcutCommand({ type: "keyDown", key: "]", meta: true, shift: true }),
    "switch-space-next"
  );
  assert.strictEqual(
    getShortcutCommand({ type: "keyDown", key: "[", control: true, shift: true }),
    "switch-space-prev"
  );

  // Zoom accelerators are recognized so the shell renderer can suppress them.
  assert.strictEqual(isZoomShortcut({ type: "keyDown", key: "=", meta: true }), true);
  assert.strictEqual(isZoomShortcut({ type: "keyDown", key: "+", meta: true }), true);
  assert.strictEqual(isZoomShortcut({ type: "keyDown", key: "-", control: true }), true);
  assert.strictEqual(isZoomShortcut({ type: "keyDown", key: "_", control: true }), true);
  assert.strictEqual(isZoomShortcut({ type: "keyDown", key: "0", meta: true }), true);
  // Plain or non-modifier presses must not be treated as zoom.
  assert.strictEqual(isZoomShortcut({ type: "keyDown", key: "-" }), false);
  assert.strictEqual(isZoomShortcut({ type: "char", key: "0", meta: true }), false);
  assert.strictEqual(isZoomShortcut({ type: "keyDown", key: "1", meta: true }), false);
  assert.strictEqual(isZoomShortcut({ type: "char", key: "=", meta: true }), false);
}

module.exports = {
  runKeyboardShortcutTests
};
