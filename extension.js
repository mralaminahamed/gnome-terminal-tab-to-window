/**
 * Terminal Tab to New Window — GNOME Shell Extension
 *
 * Adds a global keyboard shortcut (default: Super+Shift+W) that detaches
 * the active GNOME Terminal tab into its own window.
 *
 * Mechanism
 * ---------
 * GNOME Terminal has no public plugin API, so the extension works in two
 * co-operating steps:
 *
 *  1. On enable(), it writes a low-conflict internal shortcut
 *     (Ctrl+Shift+Alt+D) into GNOME Terminal's own GSettings keybindings
 *     for the "detach-tab" action.
 *
 *  2. When the user presses the global shortcut (Super+Shift+W) while
 *     GNOME Terminal is focused, the extension injects that internal
 *     shortcut via a Clutter VirtualInputDevice — which works on both
 *     Wayland and X11 because it goes through the compositor.
 *
 * Requires: GNOME Shell 45+ (Ubuntu 23.10 / 24.04+)
 * For GNOME Shell 42 (Ubuntu 22.04) use extension-gnome42.js instead.
 *
 * @author Al Amin Ahamed <mrabir.ahamed@gmail.com>
 * @version 1.0.0
 */

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import Clutter from 'gi://Clutter';
import GLib   from 'gi://GLib';
import Gio    from 'gi://Gio';
import Meta   from 'gi://Meta';
import Shell  from 'gi://Shell';

// ── Constants ────────────────────────────────────────────────────────────────

/** GSettings schema + key used to configure GNOME Terminal's own shortcut. */
const TERMINAL_KEYBINDING_SCHEMA = 'org.gnome.Terminal.Legacy.Keybindings';
const TERMINAL_DETACH_ACTION_KEY = 'detach-tab';

/**
 * Internal shortcut injected into GNOME Terminal.
 * Chosen to be highly unlikely to collide with anything else.
 */
const INTERNAL_SHORTCUT_GSETTINGS = '<Primary><Shift><Alt>d';

// Clutter key values for the internal shortcut (Ctrl+Shift+Alt+D)
const INTERNAL_MODIFIERS = [
  Clutter.KEY_Control_L,
  Clutter.KEY_Shift_L,
  Clutter.KEY_Alt_L,
];
const INTERNAL_KEY = Clutter.KEY_d;

/** WM_CLASS substrings that identify a GNOME Terminal window. */
const TERMINAL_WM_CLASSES = ['gnome-terminal-server', 'gnome-terminal'];

/** Delay (ms) between the global keybinding firing and injecting the keys.
 *  Gives GNOME Shell time to finish processing its own shortcut. */
const INJECTION_DELAY_MS = 80;

// ── Extension class ──────────────────────────────────────────────────────────

export default class TerminalTabToWindowExtension extends Extension {
  /**
   * Called when the extension is enabled (login, re-enable, or shell restart).
   */
  enable() {
    this._settings = this.getSettings();
    this._virtualKeyboard = null;

    this._configureTerminalInternalShortcut();

    Main.wm.addKeybinding(
      'move-terminal-tab-shortcut',
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.NORMAL,
      () => this._onGlobalShortcutActivated(),
    );

    console.log('[TerminalTabToWindow] Enabled — shortcut registered.');
  }

  /**
   * Called when the extension is disabled (logout, disable, or shell restart).
   * Must release every resource acquired in enable().
   */
  disable() {
    Main.wm.removeKeybinding('move-terminal-tab-shortcut');
    this._virtualKeyboard = null;
    this._settings = null;

    console.log('[TerminalTabToWindow] Disabled.');
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Writes the internal shortcut (Ctrl+Shift+Alt+D) into GNOME Terminal's
   * own GSettings so that the terminal application will recognise and act on
   * it when the virtual keyboard injects it.
   *
   * Fails gracefully if the schema or key does not exist (older/newer
   * Terminal versions that renamed or removed the key).
   */
  _configureTerminalInternalShortcut() {
    try {
      const schemaSource = Gio.SettingsSchemaSource.get_default();
      const schema = schemaSource.lookup(TERMINAL_KEYBINDING_SCHEMA, /* recursive */ true);

      if (!schema) {
        console.warn('[TerminalTabToWindow] GNOME Terminal keybinding schema not found — is gnome-terminal installed?');
        return;
      }

      if (!schema.has_key(TERMINAL_DETACH_ACTION_KEY)) {
        console.warn(`[TerminalTabToWindow] Key "${TERMINAL_DETACH_ACTION_KEY}" missing from schema — GNOME Terminal version may not support detach-tab shortcut.`);
        return;
      }

      const termSettings = new Gio.Settings({ schema_id: TERMINAL_KEYBINDING_SCHEMA });
      termSettings.set_string(TERMINAL_DETACH_ACTION_KEY, INTERNAL_SHORTCUT_GSETTINGS);
      console.log(`[TerminalTabToWindow] Set terminal internal shortcut → ${INTERNAL_SHORTCUT_GSETTINGS}`);
    } catch (e) {
      console.error(`[TerminalTabToWindow] Error configuring terminal shortcut: ${e.message}`);
    }
  }

  /**
   * Handler called by GNOME Shell when the user presses the global shortcut.
   * Guards against non-terminal windows before scheduling key injection.
   */
  _onGlobalShortcutActivated() {
    const focusedWindow = global.display.focus_window;
    if (!focusedWindow) return;

    const wmClass = (focusedWindow.get_wm_class() ?? '').toLowerCase();
    const isTerminal = TERMINAL_WM_CLASSES.some(c => wmClass.includes(c));

    if (!isTerminal) {
      // Silently ignore — the user pressed the shortcut in another app.
      return;
    }

    // Schedule injection after a short delay so GNOME Shell has finished
    // processing the keybinding event before we inject new ones.
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, INJECTION_DELAY_MS, () => {
      this._injectDetachShortcut();
      return GLib.SOURCE_REMOVE;
    });
  }

  /**
   * Injects Ctrl+Shift+Alt+D into the focused window via a Wayland-compatible
   * Clutter VirtualInputDevice.  The sequence: press all modifiers, press the
   * key, then release in reverse order.
   */
  _injectDetachShortcut() {
    try {
      const seat = Clutter.get_default_backend().get_default_seat();

      // Lazily create the virtual keyboard device once per enable() cycle.
      if (!this._virtualKeyboard) {
        this._virtualKeyboard = seat.create_virtual_device(
          Clutter.InputDeviceType.KEYBOARD_DEVICE,
        );
      }

      const kbd = this._virtualKeyboard;
      // GLib.get_monotonic_time() returns microseconds — required by notify_keyval.
      let t = GLib.get_monotonic_time();

      // Press modifiers
      for (const mod of INTERNAL_MODIFIERS) {
        kbd.notify_keyval(t++, mod, Clutter.KeyState.PRESSED);
      }

      // Press + release the main key
      kbd.notify_keyval(t++, INTERNAL_KEY, Clutter.KeyState.PRESSED);
      kbd.notify_keyval(t++, INTERNAL_KEY, Clutter.KeyState.RELEASED);

      // Release modifiers in reverse
      for (const mod of [...INTERNAL_MODIFIERS].reverse()) {
        kbd.notify_keyval(t++, mod, Clutter.KeyState.RELEASED);
      }
    } catch (e) {
      console.error(`[TerminalTabToWindow] Failed to inject virtual key events: ${e.message}`);
    }
  }
}
