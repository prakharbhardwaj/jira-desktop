# v2.0 Multi-workspace (Spaces) — Design Spike

Status: proposal / awaiting review
Scope: answer the six decision clusters from [issue #4](https://github.com/prakharbhardwaj/jira-desktop/issues/4) so implementation can begin. No code in this doc has been written beyond the partition-isolation prototype (below).

The goal of this spike is to make the implementation tractable by locking down the open design questions and by proving the one technical assumption that the whole feature rests on — that `session.fromPartition('persist:workspace-<id>')` actually isolates cookies between spaces. The prototype in `tests/smoke-partition.js` verifies that.

## Partition-isolation prototype

Run:

```
yarn test:smoke-partition
```

What it does: launches the packaged Electron runtime, creates two sessions via `session.fromPartition('persist:workspace-alpha')` and `session.fromPartition('persist:workspace-beta')`, writes a cookie named `sso` on each with different values, and asserts:

1. The same partition id returns the same `Session` instance on repeated calls.
2. Different partition ids return distinct instances.
3. A cookie written to partition A is not visible from partition B.

This is the "first PR must include a partition-isolation test" acceptance criterion from the issue. The pure helper `main/workspace-partition.js` formats and validates workspace ids so the partition name is never constructed ad-hoc at the call sites.

## 1. Sidebar layout

**Decision:** two-zone sidebar.

- **Top zone — space switcher.** Always-visible vertical strip, ~48px wide, running the full height of the window on the left edge. Each space is a circular indicator (color accent + emoji or initials). Current space gets a bright outline. This replaces the existing 6px `sidebar-trigger`.
- **Bottom zone — per-space tab list + action buttons.** Same 220px panel we have today, revealed on hover or pinned with `Cmd/Ctrl+S`. Tabs shown here are scoped to the currently selected space.

Total widths: 48px (collapsed), 268px (expanded = 48 + 220), same behavior as today otherwise.

**Why:** Preserves the existing hover-reveal model that users already know. Makes spaces discoverable without forcing a global mode toggle ("spaces view" vs "tabs view") that other approaches need.

**Alternatives considered and rejected:**

- Dropdown at the top of the tab list → hides the spaces surface entirely; every space switch is two clicks.
- Horizontal strip at the top of the window → conflicts with the frameless title bar on macOS and wastes vertical space on narrow laptops.

## 2. Space switching

**Decision:**

- Click a space indicator → switch immediately. No animation (can revisit in v2.1 if it feels abrupt).
- `Cmd/Ctrl+1..9` → switch to space by index.
- `Cmd/Ctrl+Shift+[` / `Cmd/Ctrl+Shift+]` → previous / next space (wraparound).
- Each space remembers its own last-active tab. Switching spaces restores that tab, not a "home" tab.
- Hard cap at 9 spaces for v2.0 — matches the index shortcuts and keeps the switcher sane without a scroll region. Document "soft-cap at 9 for v2.0" in the add-space flow.

**Why:** Arc-style rapid switching. Index shortcuts are the fastest. Hard cap avoids having to design a scrolling/overflow affordance in the switcher for v2.0.

## 3. Space identity

**Decision:** a space is a `{ id, name, accent, icon, jiraUrl, allowedHosts, session }`.

- `id` — stable, opaque string used in the partition name (`persist:workspace-<id>`). Validated against `WORKSPACE_ID_PATTERN` in `main/workspace-partition.js`. Never user-visible.
- `name` — user-editable label, 1–30 chars. Used in the add/rename UI and in the tooltip on the space indicator.
- `accent` — hex color from an 8-color palette (to be defined; align with existing dark theme). Drives the indicator outline and any accent surfaces.
- `icon` — a single emoji the user can type/paste, or auto-derived 1–2-character initials from `name` if empty.
- `jiraUrl` — per-space, HTTPS-only, validated by the existing `normalizeUrl`.
- `allowedHosts` — per-space extras, same shape as `JIRA_ALLOWED_HOSTS`. For v2.0 we can ship with the UI read-only (derives from the env var globally); v2.1 adds per-space UI overrides.
- `session` — stored tab list + active tab index, same shape as today's `serializePersistedState()`.

**Edit location:** right-click a space indicator → context menu with `Rename`, `Change color`, `Change icon`, `Delete`. No dedicated settings panel. Add-space flow uses a modal (see §5).

**Why:** Low UI surface, matches Arc's affordances, keeps the first version shippable. The palette approach (vs arbitrary color picker) keeps the visual language coherent.

## 4. Per-space vs shared

| Thing | Per-space | Shared | Notes |
|---|:---:|:---:|---|
| Jira URL | ✓ |  | Required per space. |
| Cookies / session storage | ✓ |  | Via `session.fromPartition('persist:workspace-<id>')`. |
| Tabs (open + pinned) | ✓ |  | Includes `pinnedUrl` semantics from #2. |
| Allow-list overrides | ✓ |  | Read-only UI in v2.0; editable UI in v2.1. |
| Deep-link opt-in (#3) |  | ✓ | One global switch. Incoming URLs route to the space whose `jiraUrl` origin matches; fall back to the active space if none match. |
| Theme |  | ✓ | One theme across the app. |
| Update-check state |  | ✓ | Dismissal applies globally. |
| Keyboard shortcuts |  | ✓ | Shortcuts are app-global. |
| Runtime `JIRA_URL` / `--jira-url` override |  | ✓ | Same suppression behavior as today — runtime overrides replace the *active* space for the session and suppress persistence. |

## 5. Onboarding & migration

### Schema

Today `workspace.json` looks like `{ jiraUrl, session?, openLinksInApp? }`. Post-migration:

```jsonc
{
  "schemaVersion": 2,
  "activeSpaceId": "default",
  "spaces": [
    {
      "id": "default",
      "name": "your-domain",
      "accent": "#2684ff",
      "icon": "",
      "jiraUrl": "https://your-domain.atlassian.net/",
      "session": { "activeTabIndex": 0, "tabs": [ /* ... */ ] }
    }
  ],
  "openLinksInApp": false
}
```

`openLinksInApp` stays at the top level (shared).

### First v2.0 launch for existing users

1. Read `workspace.json`. If there's no `schemaVersion`, treat as v1.
2. Create one space:
   - `id = "default"` — deterministic, so re-running migration is a no-op.
   - `name = hostname` derived from `jiraUrl`.
   - `accent` = first palette color.
   - `icon = ""`.
   - `jiraUrl`, `session` copied straight across.
3. **Critical:** the default space keeps using Electron's `persist:default` partition (not `persist:workspace-default`). This matches what the app used pre-migration, so existing cookies survive and users are not logged out on upgrade. All *new* spaces use `persist:workspace-<id>`.
4. Write the new shape, set `schemaVersion: 2`.

This is a one-way migration. Document in the release notes that downgrading to v1.x keeps working because v1 reads the top-level `jiraUrl` field, which we preserve inside `spaces[0].jiraUrl` — plan to write both for one minor version to keep downgrade clean.

### Add-space flow

Sidebar `+` button (at the bottom of the switcher) opens a modal:

- Jira URL (required, HTTPS, validated by `normalizeUrl`).
- Name (required, 1–30 chars).
- Accent (palette).
- Icon (single emoji, optional).

Submit creates the space with a fresh partition id (`space_<uuid-short>` format that satisfies `WORKSPACE_ID_PATTERN`). The user lands in the new space and goes through the normal "Loading Jira" flow — fresh session, no cookies yet, so they'll see the Atlassian login.

### Remove-space flow

Right-click → `Delete` → confirm modal:

> This will sign you out of **{name}** and permanently delete its tabs and cookies on this device.

Cannot delete the last remaining space. On confirm:

1. Close every tab in that space.
2. `session.fromPartition(partitionId).clearStorageData()` — wipes cookies, cache, storage.
3. Remove from `spaces` and save.
4. Switch to the first remaining space.

## 6. Empty / error states

- **Empty space (no tabs):** show the existing setup/loading card scoped to that space's `jiraUrl`. Other spaces keep working.
- **Setup error (bad URL saved to a space):** scoped to that space; other spaces keep working. The rename/edit flow lets the user fix the URL without wiping the partition.
- **Network error in a tab:** existing per-tab behavior, unchanged.
- **Corrupt `workspace.json`:** fall back to rebuilding a single default space from the legacy top-level `jiraUrl` if readable; otherwise go to the setup screen as if first-launch. Log a warning.

## Full v2.0 keyboard shortcuts

| Shortcut | Action | Status |
|---|---|---|
| Cmd/Ctrl+T | New tab in active space | existing |
| Cmd/Ctrl+W | Close active tab | existing |
| Cmd/Ctrl+R / F5 | Reload active tab | existing |
| Cmd/Ctrl+Shift+R / Shift+F5 | Force reload active tab | existing |
| Cmd/Ctrl+S | Lock sidebar | existing |
| Cmd/Ctrl+1 .. Cmd/Ctrl+9 | Switch to space by index | **new** |
| Cmd/Ctrl+Shift+[ / Cmd/Ctrl+Shift+] | Previous / next space (wrap) | **new** |

## v2.1 parking lot (out of scope for v2.0)

- Drag tabs between spaces.
- Global search across spaces.
- Cloud sync of spaces.
- Workspace templates / "clone space".
- Per-space themes.
- Per-space allow-list override UI.
- Space reordering (drag in the switcher).
- Space import/export.
- >9 spaces with overflow/scroll in the switcher.

## Open questions

- **Emoji picker:** ship with plain paste-an-emoji input, or build a picker? Recommend: paste-only for v2.0, add a picker in v2.1.
- **Deep-link routing when multiple spaces match a host:** recommend matching by exact origin first, then by `.atlassian.net` subdomain, then falling back to the active space. Needs confirmation with someone who uses multiple sandbox sites on the same account.
- **Allow-list semantics:** keep `JIRA_ALLOWED_HOSTS` (env var) global, or make it per-space and drop the env var? Recommend: keep global for v2.0, layer per-space on top in v2.1.
- **First-space migration partition:** the proposal uses `persist:default` to preserve cookies on upgrade. Confirm this is acceptable given that future spaces will use `persist:workspace-<id>` — the asymmetry is slightly ugly but it's the only way to avoid logging every v1 user out at upgrade.

## Acceptance (unchanged from issue #4)

- [ ] v1.x users auto-migrate; existing workspace appears as the default space.
- [ ] Can add, rename, and remove spaces.
- [ ] Two spaces with different Jira accounts — cookies/storage fully isolated.
- [ ] Keyboard shortcut to switch spaces.
- [ ] Tabs and pins persist per-space across restarts.
- [ ] Removing a space purges its partition data.
- [x] Unit/smoke test asserts `session.fromPartition` returns distinct instances per workspace id and isolates cookies. _(`tests/smoke-partition.js`)_
