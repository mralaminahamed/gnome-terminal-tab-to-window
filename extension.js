/**
 * Terminal Tab to New Window — GNOME Shell Extension
 *
 * Adds a global keyboard shortcut (default: Super+Shift+W) that detaches the
 * active terminal tab into its own window, adaptively across supported
 * terminals.
 *
 * Supported terminals
 * -------------------
 *  - GNOME Terminal  → triggered directly via its D-Bus window action
 *    `tab-detach` (org.gtk.Actions). No keybinding is touched. Falls back to
 *    keystroke injection if D-Bus is unavailable.
 *  - Ptyxis          → its detach action is not exported on D-Bus, so the
 *    extension sets the terminal's own `detach-tab` shortcut (saving/restoring
 *    the previous value) and injects it via a Clutter VirtualInputDevice.
 *
 * GNOME Console and Tilix are recognised but cannot be detached from outside
 * the process (no accelerator, settable shortcut, or reachable action), so the
 * extension shows an explanatory notification instead of failing silently.
 *
 * Requires: GNOME Shell 45+ (Ubuntu 23.10 / 24.04+)
 * For GNOME Shell 42 (Ubuntu 22.04) use extension-gnome42.js instead.
 *
 * @author Al Amin Ahamed <mrabir.ahamed@gmail.com>
 * @version 1.0.0
 */

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import Clutter from 'gi://Clutter';
import GLib   from 'gi://GLib';
import Gio    from 'gi://Gio';
import Meta   from 'gi://Meta';
import Shell  from 'gi://Shell';

// ── Constants ────────────────────────────────────────────────────────────────

/** Internal accelerator injected into inject-based terminals (Ctrl+Shift+Alt+D). */
const INTERNAL_SHORTCUT_GSETTINGS = '<Primary><Shift><Alt>d';

/** Adaptive delays (ms): each attempt re-checks focus before injecting once. */
const INJECT_RETRY_DELAYS = [50, 120, 250];

/** Timeout (ms) for the D-Bus List/Activate calls. */
const DBUS_TIMEOUT_MS = 1000;

/** Modifier name → Clutter keyval, for parsing GSettings accelerator strings. */
const MODIFIER_KEYVALS = {
  primary: Clutter.KEY_Control_L,
  control: Clutter.KEY_Control_L,
  ctrl:    Clutter.KEY_Control_L,
  shift:   Clutter.KEY_Shift_L,
  alt:     Clutter.KEY_Alt_L,
  mod1:    Clutter.KEY_Alt_L,
  super:   Clutter.KEY_Super_L,
  meta:    Clutter.KEY_Meta_L,
  hyper:   Clutter.KEY_Hyper_L,
};

/** Returns the GTK application-id of a window, or null. */
function appId(win) {
  try {
    return win.get_gtk_application_id?.() ?? null;
  } catch {
    return null;
  }
}

/** Returns the lower-cased WM_CLASS of a window, or ''. */
function wmClass(win) {
  try {
    return (win.get_wm_class() ?? '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Terminal registry. Ordered — the first matching entry wins.
 *  - mechanism 'dbus'   : trigger `dbusAction` via org.gtk.Actions (inject fallback).
 *  - mechanism 'inject' : set `schema`/`key` shortcut and inject it.
 *  - supported false    : recognised but not programmatically detachable.
 */
const TERMINALS = [
  {
    id: 'gnome-terminal',
    label: 'GNOME Terminal',
    supported: true,
    mechanism: 'dbus',
    dbusAction: 'tab-detach',
    // Inject fallback if D-Bus is unavailable:
    schema: 'org.gnome.Terminal.Legacy.Keybindings',
    key: 'detach-tab',
    match: win => wmClass(win).includes('gnome-terminal'),
  },
  {
    id: 'ptyxis',
    label: 'Ptyxis',
    supported: true,
    mechanism: 'inject',
    schema: 'org.gnome.Ptyxis.Shortcuts',
    key: 'detach-tab',
    match: win => appId(win) === 'org.gnome.Ptyxis',
  },
  {
    id: 'console',
    label: 'GNOME Console',
    supported: false,
    match: win => appId(win) === 'org.gnome.Console',
  },
  {
    id: 'tilix',
    label: 'Tilix',
    supported: false,
    match: win => appId(win) === 'com.gexperts.Tilix',
  },
];

// ── Extension class ──────────────────────────────────────────────────────────

export default class TerminalTabToWindowExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._virtualKeyboard = null;
    this._pendingTimeouts = new Set();
    this._savedShortcuts = new Map(); // "schema:key" → previous accel string

    Main.wm.addKeybinding(
      'move-terminal-tab-shortcut',
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.NORMAL,
      () => {
        this._onGlobalShortcutActivated().catch(
          e => this._log(`dispatch error: ${e.message}`));
      },
    );

    this._probeInstalledTerminals();
    this._log('Enabled — shortcut registered.');
  }

  disable() {
    Main.wm.removeKeybinding('move-terminal-tab-shortcut');

    if (this._pendingTimeouts) {
      for (const id of this._pendingTimeouts)
        GLib.Source.remove(id);
      this._pendingTimeouts.clear();
    }
    this._pendingTimeouts = null;

    this._restoreSavedShortcuts();

    this._virtualKeyboard = null;
    this._settings = null;

    this._logDirect('Disabled.');
  }

  // ── Dispatch ────────────────────────────────────────────────────────────────

  async _onGlobalShortcutActivated() {
    const win = global.display.focus_window;
    if (!win) return;

    const entry = this._matchStrategy(win);
    if (!entry) {
      this._log('Focused window is not a known terminal — ignoring.');
      return;
    }

    if (!entry.supported) {
      this._notify(
        _('Detach not available'),
        _('%s cannot detach a tab programmatically. Use its own tab menu or drag the tab out.').format(entry.label));
      return;
    }

    if (entry.mechanism === 'dbus') {
      const ok = await this._dbusDetach(win, entry);
      if (ok) return;
      this._log('D-Bus detach unavailable — falling back to key injection.');
    }

    this._injectDetach(entry);
  }

  _matchStrategy(win) {
    for (const t of TERMINALS) {
      try {
        if (t.match(win)) return t;
      } catch {
        // A getter may be missing on some windows — skip this entry.
      }
    }
    return null;
  }

  _isFocused(entry) {
    const win = global.display.focus_window;
    if (!win) return false;
    try {
      return entry.match(win);
    } catch {
      return false;
    }
  }

  // ── D-Bus mechanism (GNOME Terminal) ─────────────────────────────────────────

  /**
   * Activates the window's `dbusAction` via org.gtk.Actions. Resolves true on
   * success, false if the window exposes no D-Bus actions or the call fails.
   */
  _dbusDetach(win, entry) {
    return new Promise(resolve => {
      let busName, objPath;
      try {
        busName = win.get_gtk_unique_bus_name?.();
        objPath = win.get_gtk_window_object_path?.();
      } catch {
        resolve(false);
        return;
      }
      if (!busName || !objPath) {
        resolve(false);
        return;
      }

      const conn = Gio.DBus.session;
      conn.call(
        busName, objPath, 'org.gtk.Actions', 'List', null,
        new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, DBUS_TIMEOUT_MS, null,
        (c, res) => {
          let actions;
          try {
            [actions] = c.call_finish(res).deepUnpack();
          } catch (e) {
            this._log(`org.gtk.Actions.List failed: ${e.message}`);
            resolve(false);
            return;
          }
          if (!actions.includes(entry.dbusAction)) {
            this._log(`Window does not export action "${entry.dbusAction}".`);
            resolve(false);
            return;
          }
          conn.call(
            busName, objPath, 'org.gtk.Actions', 'Activate',
            new GLib.Variant('(sava{sv})', [entry.dbusAction, [], {}]),
            null, Gio.DBusCallFlags.NONE, DBUS_TIMEOUT_MS, null,
            (c2, res2) => {
              try {
                c2.call_finish(res2);
                this._log(`Detached via D-Bus action "${entry.dbusAction}".`);
                resolve(true);
              } catch (e) {
                this._log(`org.gtk.Actions.Activate failed: ${e.message}`);
                resolve(false);
              }
            });
        });
    });
  }

  // ── Inject mechanism (Ptyxis, GNOME Terminal fallback) ───────────────────────

  _injectDetach(entry) {
    const settings = this._terminalSettings(entry);
    if (!settings) {
      this._notify(
        _('Detach unavailable'),
        _('%s is not installed or exposes no detach shortcut setting.').format(entry.label));
      return;
    }

    const current = settings.get_string(entry.key);
    let accel;
    if (current && current !== 'disabled' && current !== '') {
      // The user already bound a shortcut — reuse it, mutate nothing.
      accel = current;
    } else {
      // No shortcut set — set ours, remembering the previous value to restore.
      const mapKey = `${entry.schema}:${entry.key}`;
      if (!this._savedShortcuts.has(mapKey))
        this._savedShortcuts.set(mapKey, current);
      settings.set_string(entry.key, INTERNAL_SHORTCUT_GSETTINGS);
      accel = INTERNAL_SHORTCUT_GSETTINGS;
    }

    const keyvals = this._accelToKeyvals(accel);
    if (!keyvals) {
      this._log(`Cannot parse accelerator "${accel}" for injection.`);
      return;
    }
    this._scheduleInject(entry, keyvals, 0);
  }

  /**
   * Waits, re-checks focus, and injects exactly once when the terminal is still
   * focused. If focus has not settled, retries the wait (never re-injecting, to
   * avoid detaching more than one tab).
   */
  _scheduleInject(entry, keyvals, attempt) {
    if (attempt >= INJECT_RETRY_DELAYS.length) {
      this._log('Injection aborted — terminal never regained focus.');
      return;
    }
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, INJECT_RETRY_DELAYS[attempt], () => {
      this._pendingTimeouts?.delete(id);
      if (!this._isFocused(entry)) {
        this._scheduleInject(entry, keyvals, attempt + 1);
        return GLib.SOURCE_REMOVE;
      }
      try {
        this._injectKeyvals(keyvals);
        this._log(`Injected detach shortcut into ${entry.label}.`);
      } catch (e) {
        this._log(`Injection failed: ${e.message}`);
      }
      return GLib.SOURCE_REMOVE;
    });
    this._pendingTimeouts.add(id);
  }

  _injectKeyvals(kv) {
    const seat = Clutter.get_default_backend().get_default_seat();
    if (!this._virtualKeyboard) {
      this._virtualKeyboard = seat.create_virtual_device(
        Clutter.InputDeviceType.KEYBOARD_DEVICE);
    }
    const kbd = this._virtualKeyboard;
    let t = GLib.get_monotonic_time(); // microseconds

    for (const mod of kv.mods)
      kbd.notify_keyval(t++, mod, Clutter.KeyState.PRESSED);
    kbd.notify_keyval(t++, kv.key, Clutter.KeyState.PRESSED);
    kbd.notify_keyval(t++, kv.key, Clutter.KeyState.RELEASED);
    for (const mod of [...kv.mods].reverse())
      kbd.notify_keyval(t++, mod, Clutter.KeyState.RELEASED);
  }

  /**
   * Parses a GSettings accelerator like '<Primary><Shift><Alt>d' into Clutter
   * keyvals. Returns { mods: number[], key: number } or null if unparseable.
   */
  _accelToKeyvals(accel) {
    const mods = [];
    const re = /<([^>]+)>/g;
    let m;
    let lastIndex = 0;
    while ((m = re.exec(accel)) !== null) {
      const keyval = MODIFIER_KEYVALS[m[1].toLowerCase()];
      if (keyval === undefined) return null;
      mods.push(keyval);
      lastIndex = re.lastIndex;
    }
    const keyName = accel.slice(lastIndex).trim();
    if (!keyName) return null;

    const lookup = keyName.length === 1 ? keyName.toLowerCase() : keyName;
    const key = Clutter[`KEY_${lookup}`];
    if (key === undefined) return null;

    return { mods, key };
  }

  // ── Settings helpers ─────────────────────────────────────────────────────────

  /** Returns a Gio.Settings for the terminal's shortcut schema, or null. */
  _terminalSettings(entry) {
    try {
      const source = Gio.SettingsSchemaSource.get_default();
      const schema = source.lookup(entry.schema, /* recursive */ true);
      if (!schema || !schema.has_key(entry.key)) return null;
      return new Gio.Settings({ schema_id: entry.schema });
    } catch (e) {
      this._log(`Cannot open settings for ${entry.label}: ${e.message}`);
      return null;
    }
  }

  _restoreSavedShortcuts() {
    if (!this._savedShortcuts) return;
    for (const [mapKey, value] of this._savedShortcuts) {
      const sep = mapKey.lastIndexOf(':');
      const schema = mapKey.slice(0, sep);
      const key = mapKey.slice(sep + 1);
      try {
        new Gio.Settings({ schema_id: schema }).set_string(key, value);
      } catch (e) {
        this._logDirect(`Failed to restore ${schema} ${key}: ${e.message}`);
      }
    }
    this._savedShortcuts.clear();
    this._savedShortcuts = null;
  }

  /** Enable-time diagnostic: note whether any supported terminal is installed. */
  _probeInstalledTerminals() {
    const source = Gio.SettingsSchemaSource.get_default();
    const hasGnomeTerminal = !!source.lookup('org.gnome.Terminal.Legacy.Keybindings', true);
    const hasPtyxis = !!source.lookup('org.gnome.Ptyxis.Shortcuts', true);
    this._log(`Installed terminals — GNOME Terminal: ${hasGnomeTerminal}, Ptyxis: ${hasPtyxis}.`);
    if (!hasGnomeTerminal && !hasPtyxis) {
      this._notify(
        _('No supported terminal found'),
        _('Install GNOME Terminal or Ptyxis to use the tab-detach shortcut.'));
    }
  }

  // ── Logging / notifications ──────────────────────────────────────────────────

  _notify(title, body) {
    try {
      Main.notify(title, body);
    } catch (e) {
      this._logDirect(`notify failed: ${e.message}`);
    }
  }

  /** Verbose log, gated on the debug-logging setting. */
  _log(message) {
    if (this._settings?.get_boolean('debug-logging'))
      console.debug(`[TerminalTabToWindow] ${message}`);
  }

  /** Always-on log, for lifecycle/errors that must appear regardless of setting. */
  _logDirect(message) {
    console.debug(`[TerminalTabToWindow] ${message}`);
  }
}
