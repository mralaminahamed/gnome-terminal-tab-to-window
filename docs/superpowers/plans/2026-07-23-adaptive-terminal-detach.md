# Adaptive Terminal Detach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detach the active terminal tab into its own window adaptively across GNOME Terminal and Ptyxis, with a D-Bus fast-path, adaptive retry, non-clobbering keybindings, and enable-time diagnostics.

**Architecture:** A data-driven terminal registry. Each terminal is a strategy exposing `matches/verify/activate/prepare/cleanup`. GNOME Terminal uses `org.gtk.Actions.Activate("tab-detach")` over D-Bus (falling back to keystroke injection); Ptyxis uses GSettings-shortcut + injection. Console/Tilix are recognized but unsupported (notification only).

**Tech Stack:** GJS (GNOME Shell 45–50 ESM + a mirrored GNOME 42–44 classic-imports variant), GSettings, Gio D-Bus, Clutter VirtualInputDevice, Adwaita/GTK4 prefs.

## Global Constraints

- ESM `extension.js` targets `shell-version` `45`–`50`; classic `extension-gnome42.js` targets `42`–`44`. Keep both in parity.
- GNOME Terminal matched by `wm_class` substring `gnome-terminal`; GTK4 apps (Ptyxis/Console/Tilix) matched by `get_gtk_application_id()`.
- GNOME Terminal detach GSettings key `org.gnome.Terminal.Legacy.Keybindings/detach-tab` is type `s` (single string), default `'disabled'`. Ptyxis: `org.gnome.Ptyxis.Shortcuts/detach-tab`, type `s`, default `''`.
- Internal injected accel: `<Primary><Shift><Alt>d` (Clutter Ctrl+Shift+Alt+D).
- Any GSettings value the extension mutates MUST be saved on enable/prepare and restored on disable/cleanup.
- No headless GJS unit tests exist; verification is `node --check`, `glib-compile-schemas`, JSON validity, `./package.sh` build, plus documented live checks.

---

### Task 1: Add `debug-logging` to the GSettings schema

**Files:**
- Modify: `schemas/org.gnome.shell.extensions.terminal-tab-to-window.gschema.xml`

**Interfaces:**
- Produces: boolean key `debug-logging` (default `false`) in schema `org.gnome.shell.extensions.terminal-tab-to-window`.

- [ ] **Step 1: Add the key** inside `<schema>`, after the existing shortcut key:

```xml
<key name="debug-logging" type="b">
  <default>false</default>
  <summary>Enable verbose logging</summary>
  <description>When on, the extension logs detailed diagnostics to the GNOME Shell journal.</description>
</key>
```

- [ ] **Step 2: Verify it compiles**

Run: `glib-compile-schemas --dry-run schemas/`
Expected: no output, exit 0.

- [ ] **Step 3: Commit** — `git commit -m "feat(schema): add debug-logging toggle"`

---

### Task 2: Rewrite `extension.js` around the terminal registry

**Files:**
- Modify (rewrite): `extension.js`

**Interfaces:**
- Consumes: `debug-logging` key (Task 1).
- Produces (internal): a `TERMINALS` array of strategy descriptors and helpers
  `_matchStrategy(win)`, `_dbusDetach(win)` → `Promise<bool>`, `_injectStrategy(entry)`,
  `_isTerminalFocused()`, `_log(msg)`, `_notify(title, body)`, `_scheduleRetry(fn)`.

Strategy descriptor shape:

```js
{ id, // "gnome-terminal" | "ptyxis" | "console" | "tilix"
  match: win => bool,          // by wm_class or get_gtk_application_id()
  supported: bool,             // false for console/tilix
  mechanism: 'dbus'|'inject',  // gnome-terminal='dbus' (inject fallback); ptyxis='inject'
  schema, key, accel,          // for inject strategies
  dbusAction }                 // 'tab-detach' for gnome-terminal
```

- [ ] **Step 1: Implement the registry + dispatch.** On the global shortcut: find the matching strategy; if none, `_log` and return; if matched but `!supported` or schema missing, `_notify` and return; GNOME Terminal → `await _dbusDetach(win)`, on false fall back to `_injectDetach`; Ptyxis → `_injectDetach`. `_dbusDetach` reads `win.get_gtk_unique_bus_name()` + `win.get_gtk_window_object_path()`, calls `org.gtk.Actions.List` to verify `tab-detach`, then `Activate`. Inject path: save+set shortcut only if unset/`disabled`/empty (else reuse), retry at 50/100/200 ms re-checking focus, track+remove timeout sources in `disable()`, restore saved shortcut in `disable()`. `_log` gated on `debug-logging`.

- [ ] **Step 2: Verify syntax** — `cp extension.js /tmp/e.mjs && node --check /tmp/e.mjs` → OK.

- [ ] **Step 3: Deploy + confirm it loads** — `./install.sh` then check no parse error: `journalctl --user -b 0 -o cat /usr/bin/gnome-shell | grep -i terminaltabtowindow` (after relogin). Headless: rely on Step 2.

- [ ] **Step 4: Commit** — `git commit -m "feat: adaptive terminal registry with D-Bus + inject strategies"`

---

### Task 3: Mirror into `extension-gnome42.js`

**Files:**
- Modify (rewrite): `extension-gnome42.js`

**Interfaces:**
- Same behavior as Task 2, classic imports (`imports.gi`, module-level state, `log`/`logError`, `Main.notify` via `imports.ui.main`). D-Bus via `Gio.DBus.session`. `ExtensionUtils.getSettings(...)`.

- [ ] **Step 1: Port the registry + dispatch** with the same strategy table and robustness (retry, save/restore, notify, debug toggle read via `_settings.get_boolean('debug-logging')`).
- [ ] **Step 2: Verify syntax** — `cp extension-gnome42.js /tmp/g.cjs && node --check /tmp/g.cjs` → OK.
- [ ] **Step 3: Commit** — `git commit -m "feat(gnome42): mirror adaptive registry"`

---

### Task 4: Preferences — debug switch + supported-terminals note

**Files:**
- Modify: `prefs.js`

**Interfaces:**
- Consumes: `debug-logging` key.
- Produces: a **Behaviour** `Adw.PreferencesGroup` with an `Adw.SwitchRow` bound to `debug-logging`, and a **Supported terminals** group with a read-only note.

- [ ] **Step 1: Add the groups** to `fillPreferencesWindow`. SwitchRow: `settings.bind('debug-logging', row, 'active', Gio.SettingsBindFlags.DEFAULT)` (import `Gio`). Note row lists: GNOME Terminal ✓, Ptyxis ✓, Console/Tilix — recognized, not detachable.
- [ ] **Step 2: Verify syntax** — `cp prefs.js /tmp/p.mjs && node --check /tmp/p.mjs` → OK.
- [ ] **Step 3: Commit** — `git commit -m "feat(prefs): debug toggle + supported-terminals note"`

---

### Task 5: Regenerate translation template

**Files:**
- Modify: `po/terminal-tab-to-window.pot`

- [ ] **Step 1: Regenerate** — `cd po && ./update-pot.sh` (extracts new `_()` strings from prefs.js).
- [ ] **Step 2: Verify** — `grep -c '^msgid "' po/terminal-tab-to-window.pot` ≥ previous count; new strings present.
- [ ] **Step 3: Commit** — `git commit -m "i18n: refresh POT for new prefs strings"`

---

### Task 6: Docs + package verification

**Files:**
- Modify: `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Update README** — replace the single-terminal "How It Works" framing with the supported-terminal matrix (GNOME Terminal via D-Bus, Ptyxis via injection, Console/Tilix unsupported), document the `debug-logging` toggle, note non-destructive behavior.
- [ ] **Step 2: Update CHANGELOG** under `[Unreleased]`.
- [ ] **Step 3: Verify packaging still clean** — `rm -rf dist && ./package.sh && ./package.sh --gnome42 && unzip -Z1 dist/*.shell-extension.zip` (no install scripts; prefs.js only in 45+).
- [ ] **Step 4: Verify metadata + all JS** — `node -e "JSON.parse(require('fs').readFileSync('metadata.json'))"` and `node --check` on each JS file.
- [ ] **Step 5: Commit** — `git commit -m "docs: adaptive terminal support + debug toggle"`

---

## Self-Review

- **Spec coverage:** registry (T2/T3), D-Bus fast-path (T2), adaptive retry (T2/T3), non-clobbering (T2/T3), enable-time verification + notify (T2/T3), debug toggle (T1/T2/T3/T4), Console/Tilix unsupported branch (T2/T3), prefs (T4), i18n (T5), docs+packaging (T6). All spec sections mapped.
- **Placeholders:** none — each task has concrete code/keys/commands.
- **Type consistency:** strategy descriptor fields and helper names (`_dbusDetach`, `_injectDetach`, `_isTerminalFocused`, `_log`, `_notify`) are used consistently across T2/T3.

## Live-session verification (post-implementation, user runs)

1. GNOME Terminal, 2+ tabs → `Super+Shift+W` detaches; `gsettings get org.gnome.Terminal.Legacy.Keybindings detach-tab` still `'disabled'` (untouched — D-Bus path).
2. Manual D-Bus check: `gdbus call --session -d <bus> -o <win-path> -m org.gtk.Actions.Activate tab-detach '[]' '{}'`.
3. Ptyxis (if installed) → detaches; disable → its `detach-tab` restored to `''`.
4. Console/Tilix focused → notification, no keybinding change.
