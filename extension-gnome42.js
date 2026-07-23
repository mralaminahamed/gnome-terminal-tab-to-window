/**
 * Terminal Tab to New Window — GNOME Shell Extension (GNOME 42 / Ubuntu 22.04)
 *
 * Rename this file to extension.js when targeting Ubuntu 22.04 (GNOME 42).
 * For Ubuntu 23.10+ / GNOME 45+ use extension.js (ES modules).
 *
 * Also update metadata.json → "shell-version": ["42", "43", "44"]
 *
 * @author Al Amin Ahamed <mrabir.ahamed@gmail.com>
 * @version 1.0.0
 */

'use strict';

const { Clutter, GLib, Gio, Meta, Shell } = imports.gi;
const Main           = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;

// ── Constants ────────────────────────────────────────────────────────────────

const TERMINAL_KEYBINDING_SCHEMA  = 'org.gnome.Terminal.Legacy.Keybindings';
const TERMINAL_DETACH_ACTION_KEY  = 'detach-tab';
const INTERNAL_SHORTCUT_GSETTINGS = '<Primary><Shift><Alt>d';

const INTERNAL_MODIFIERS = [
    Clutter.KEY_Control_L,
    Clutter.KEY_Shift_L,
    Clutter.KEY_Alt_L,
];
const INTERNAL_KEY = Clutter.KEY_d;

const TERMINAL_WM_CLASSES = ['gnome-terminal-server', 'gnome-terminal'];
const INJECTION_DELAY_MS  = 80;

// ── Module-level state (no class in the GNOME 42 API) ───────────────────────

let _settings            = null;
let _virtualKeyboard     = null;
let _pendingTimeouts     = null;  // Set of GLib source ids
let _savedDetachShortcut = null;  // previous terminal detach-tab value

// ── Lifecycle ────────────────────────────────────────────────────────────────

/** @returns {void} */
function init() {
    // Nothing to do here in GNOME 42 extensions.
}

/** @returns {void} */
function enable() {
    _settings = ExtensionUtils.getSettings(
        'org.gnome.shell.extensions.terminal-tab-to-window'
    );
    _virtualKeyboard = null;
    _pendingTimeouts = new Set();
    _savedDetachShortcut = null;

    _configureTerminalInternalShortcut();

    Main.wm.addKeybinding(
        'move-terminal-tab-shortcut',
        _settings,
        Meta.KeyBindingFlags.NONE,
        Shell.ActionMode.NORMAL,
        _onGlobalShortcutActivated
    );

    log('[TerminalTabToWindow] Enabled — shortcut registered.');
}

/** @returns {void} */
function disable() {
    Main.wm.removeKeybinding('move-terminal-tab-shortcut');

    // Cancel any pending injection timeouts scheduled but not yet fired.
    if (_pendingTimeouts) {
        for (const id of _pendingTimeouts)
            GLib.Source.remove(id);
        _pendingTimeouts.clear();
    }
    _pendingTimeouts = null;

    // Restore GNOME Terminal's detach-tab keybinding to what it was before.
    _restoreTerminalInternalShortcut();

    _virtualKeyboard = null;
    _settings        = null;

    log('[TerminalTabToWindow] Disabled.');
}

// ── Private helpers ──────────────────────────────────────────────────────────

/**
 * Writes Ctrl+Shift+Alt+D into GNOME Terminal's keybinding GSettings so the
 * terminal recognises it as the "detach-tab" action. Saves the prior value so
 * disable() can restore it.
 *
 * @returns {void}
 */
function _configureTerminalInternalShortcut() {
    try {
        const schemaSource = Gio.SettingsSchemaSource.get_default();
        const schema = schemaSource.lookup(TERMINAL_KEYBINDING_SCHEMA, true);

        if (!schema) {
            logError(new Error('GNOME Terminal keybinding schema not found.'),
                '[TerminalTabToWindow]');
            return;
        }

        if (!schema.has_key(TERMINAL_DETACH_ACTION_KEY)) {
            logError(new Error(`Key "${TERMINAL_DETACH_ACTION_KEY}" not in schema.`),
                '[TerminalTabToWindow]');
            return;
        }

        const termSettings = new Gio.Settings({ schema_id: TERMINAL_KEYBINDING_SCHEMA });
        _savedDetachShortcut = termSettings.get_string(TERMINAL_DETACH_ACTION_KEY);
        termSettings.set_string(TERMINAL_DETACH_ACTION_KEY, INTERNAL_SHORTCUT_GSETTINGS);
        log(`[TerminalTabToWindow] Set terminal internal shortcut → ${INTERNAL_SHORTCUT_GSETTINGS}`);
    } catch (e) {
        logError(e, '[TerminalTabToWindow] Error configuring terminal shortcut');
    }
}

/**
 * Restores GNOME Terminal's detach-tab keybinding to the saved value.
 * No-op if nothing was saved.
 *
 * @returns {void}
 */
function _restoreTerminalInternalShortcut() {
    if (_savedDetachShortcut === null) return;
    try {
        const termSettings = new Gio.Settings({ schema_id: TERMINAL_KEYBINDING_SCHEMA });
        termSettings.set_string(TERMINAL_DETACH_ACTION_KEY, _savedDetachShortcut);
        log(`[TerminalTabToWindow] Restored terminal detach-tab → ${_savedDetachShortcut}`);
    } catch (e) {
        logError(e, '[TerminalTabToWindow] Error restoring terminal shortcut');
    } finally {
        _savedDetachShortcut = null;
    }
}

/**
 * Returns true when the currently focused window is a GNOME Terminal.
 *
 * @returns {boolean}
 */
function _isTerminalFocused() {
    const focusedWindow = global.display.focus_window;
    if (!focusedWindow) return false;
    const wmClass = (focusedWindow.get_wm_class() || '').toLowerCase();
    return TERMINAL_WM_CLASSES.some(c => wmClass.includes(c));
}

/**
 * Called by GNOME Shell when the user presses the global shortcut.
 *
 * @returns {void}
 */
function _onGlobalShortcutActivated() {
    if (!_isTerminalFocused()) return;

    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, INJECTION_DELAY_MS, () => {
        if (_pendingTimeouts) _pendingTimeouts.delete(id);
        _injectDetachShortcut();
        return GLib.SOURCE_REMOVE;
    });
    _pendingTimeouts.add(id);
}

/**
 * Injects Ctrl+Shift+Alt+D via Clutter VirtualInputDevice (Wayland-safe).
 * Re-checks focus first so keys are never delivered to another app if the
 * user switched windows during the injection delay.
 *
 * @returns {void}
 */
function _injectDetachShortcut() {
    if (!_isTerminalFocused()) return;

    try {
        const seat = Clutter.get_default_backend().get_default_seat();

        if (!_virtualKeyboard) {
            _virtualKeyboard = seat.create_virtual_device(
                Clutter.InputDeviceType.KEYBOARD_DEVICE
            );
        }

        let t = GLib.get_monotonic_time(); // microseconds

        for (const mod of INTERNAL_MODIFIERS) {
            _virtualKeyboard.notify_keyval(t++, mod, Clutter.KeyState.PRESSED);
        }
        _virtualKeyboard.notify_keyval(t++, INTERNAL_KEY, Clutter.KeyState.PRESSED);
        _virtualKeyboard.notify_keyval(t++, INTERNAL_KEY, Clutter.KeyState.RELEASED);
        for (const mod of [...INTERNAL_MODIFIERS].reverse()) {
            _virtualKeyboard.notify_keyval(t++, mod, Clutter.KeyState.RELEASED);
        }
    } catch (e) {
        logError(e, '[TerminalTabToWindow] Failed to inject virtual key events');
    }
}
