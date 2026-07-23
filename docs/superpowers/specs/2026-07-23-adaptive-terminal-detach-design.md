# Adaptive Terminal Detach — Design Spec

- **Date:** 2026-07-23
- **Status:** Approved
- **Extension:** `terminal-tab-to-window@mralaminahamed.github.com`

## Goal

Make "detach the active terminal tab into its own window" **adaptive** across
multiple terminals and **reliable** ("must working"), replacing the current
single-terminal, fixed-delay, keybinding-clobbering approach.

## Grounded mechanism research (upstream source + live D-Bus/Mutter introspection)

| Terminal | Match | Detach trigger reachable from gnome-shell? | Mechanism | Confidence |
|---|---|---|---|---|
| GNOME Terminal | wm_class `gnome-terminal-server` | **Yes** | D-Bus `org.gtk.Actions.Activate("tab-detach")` on the window path (**primary**); GSettings `org.gnome.Terminal.Legacy.Keybindings/detach-tab` (type `s`) + inject (**fallback**) | confirmed |
| Ptyxis | app-id `org.gnome.Ptyxis` | **Yes** | GSettings `org.gnome.Ptyxis.Shortcuts/detach-tab` (type `s`, default empty) + inject. D-Bus **not** reachable (`page.detach` not in `win` group) | confirmed |
| GNOME Console (kgx) | app-id `org.gnome.Console` | **No** | `tab.detach` exists but has no accelerator, no settable shortcut, not D-Bus-exported | confirmed |
| Tilix | app-id `com.gexperts.Tilix` | **No** | detach is drag-only; no GAction/keybinding/CLI | confirmed |

**Consequences:**
- GNOME Terminal no longer needs its keybinding mutated — the D-Bus path triggers detach directly, so the "clobbers user config" problem disappears for the common case.
- Ptyxis still needs the GSettings-shortcut + virtual-keyboard injection pattern.
- Console and Tilix are **recognized but unsupported**: dispatch produces a helpful notification, never a silent no-op or a stolen keybinding.
- GTK4 apps are dispatched by `get_gtk_application_id()` (stable across X11/Wayland); GNOME Terminal by `wm_class` substring.

## Architecture

A **data-driven terminal registry**. Each entry is a strategy with a uniform interface:

```
Strategy {
  id            // "gnome-terminal" | "ptyxis" | "console" | "tilix"
  matches(win)  // by get_gtk_application_id() and/or wm_class
  verify()      // { ok, reason } — schema/key present, or D-Bus action listed
  activate(win) // perform the detach; returns bool success (may be async)
  prepare()     // one-time setup on enable (save shortcut if it will be mutated)
  cleanup()     // restore any mutated GSettings on disable
}
```

Two mechanism implementations back the strategies:

1. **DBusActionStrategy** (GNOME Terminal primary): read the focused window's
   `get_gtk_unique_bus_name()` + `get_gtk_window_object_path()`, verify the action
   via `org.gtk.Actions.List`, then `Activate("tab-detach", [], {})`. No GSettings
   mutation, no injection, no timing.
2. **InjectShortcutStrategy** (Ptyxis; GNOME Terminal fallback): if the terminal's
   detach shortcut GSettings key is unset/`'disabled'`/empty, set the internal accel
   `<Primary><Shift><Alt>d` (saving the old value); if the user already bound a real
   accel, **reuse it** (inject that, mutate nothing). Inject via Clutter
   `VirtualInputDevice` with adaptive retry. Restore saved value on disable.

## Dispatch flow (global shortcut pressed)

1. `win = global.display.focus_window`; if none → return.
2. Find the first registry strategy whose `matches(win)` is true.
3. No match → if `debug-logging`, log; else silent return (other apps unaffected).
4. Matched but `verify().ok === false` (e.g. Console/Tilix, or missing schema) →
   `Main.notify(...)` explaining it isn't supported/available; return.
5. Run `activate(win)`:
   - GNOME Terminal: try D-Bus; on failure fall back to inject.
   - Ptyxis: inject.

## Robustness upgrades (all four)

1. **D-Bus fast-path** — GNOME Terminal detaches with zero side effects.
2. **Adaptive retry** — inject path attempts at 50 → 100 → 200 ms, re-checking focus
   before each attempt, stopping on success or after 3 tries. All timeout sources are
   tracked and removed on disable.
3. **Non-clobbering** — reuse an existing user shortcut; only set a fallback when
   unset; save original, restore on disable.
4. **Enable-time verification + notifications** — on enable, probe which supported
   terminals are installed and prepare them; surface actionable `Main.notify` messages
   when the user invokes on an unsupported/misconfigured terminal. New GSettings boolean
   `debug-logging` (default false) gates verbose `console.debug`.

## Settings / schema changes

Add to `org.gnome.shell.extensions.terminal-tab-to-window`:

- `debug-logging` — `b`, default `false`. Verbose logging toggle.

`move-terminal-tab-shortcut` is unchanged.

## Preferences (`prefs.js`)

- Keep the shortcut-rebind row.
- Add a **Behaviour** group: a `debug-logging` switch (`Adw.SwitchRow` bound to GSettings).
- Add a read-only **Supported terminals** note: GNOME Terminal + Ptyxis supported;
  Console/Tilix recognized but not programmatically detachable.

## Files touched

- `extension.js` — rewrite around the registry (ESM, GNOME 45–50).
- `extension-gnome42.js` — mirror (inject path + best-effort D-Bus; classic imports).
- `schemas/…gschema.xml` — add `debug-logging`.
- `prefs.js` — debug switch + supported-terminals note.
- `po/terminal-tab-to-window.pot` — regenerate (new strings).
- `README.md`, `CHANGELOG.md` — document adaptive support + supported-terminal matrix.

## Error handling

- Every GSettings/D-Bus/Clutter call wrapped in try/catch; failures logged via
  `console.error` and, where user-actionable, surfaced with `Main.notify`.
- D-Bus calls are async and best-effort; failure falls through to inject (GNOME
  Terminal) or a notification.

## Testing / verification

Headless (I can do): `node --check` all JS, validate schema compiles, JSON valid,
both EGO zips still build.

Live session (user runs): 
- GNOME Terminal (2+ tabs) → `Super+Shift+W` detaches; confirm its `detach-tab`
  GSettings is **untouched** (D-Bus path).
- `gdbus call --session -d <bus> -o <path> -m org.gtk.Actions.Activate tab-detach '[]' '{}'`
  as a manual D-Bus check.
- Ptyxis (if installed) → detaches; confirm shortcut restored on disable.
- Console/Tilix focused → notification, no keybinding change.

## Out of scope

- Triggering detach in Console/Tilix (no reliable mechanism upstream).
- Any UI beyond the preferences dialog.
- Translations beyond regenerating the template (no bundled languages yet).
