/**
 * Terminal Tab to New Window — GNOME Shell Extension (GNOME 42 / Ubuntu 22.04)
 *
 * Adaptive tab-detach across GNOME Terminal (D-Bus org.gtk.Actions, inject
 * fallback) and Ptyxis (GSettings shortcut + inject). GNOME Console and Tilix
 * are recognised but not programmatically detachable.
 *
 * Rename this file to extension.js when targeting Ubuntu 22.04 (GNOME 42).
 * For Ubuntu 23.10+ / GNOME 45+ use extension.js (ES modules).
 *
 * @author Al Amin Ahamed <mrabir.ahamed@gmail.com>
 * @version 1.0.0
 */

'use strict';

const { Clutter, GLib, Gio, Meta, Shell } = imports.gi;
const Main           = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;
const Gettext        = imports.gettext;
const _              = Gettext.domain('terminal-tab-to-window').gettext;

// ── Constants ────────────────────────────────────────────────────────────────

const INTERNAL_SHORTCUT_GSETTINGS = '<Primary><Shift><Alt>d';
const INJECT_RETRY_DELAYS = [50, 120, 250];
const DBUS_TIMEOUT_MS = 1000;

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

function appId(win) {
    try {
        return win.get_gtk_application_id ? win.get_gtk_application_id() : null;
    } catch (e) {
        return null;
    }
}

function wmClass(win) {
    try {
        return (win.get_wm_class() || '').toLowerCase();
    } catch (e) {
        return '';
    }
}

const TERMINALS = [
    {
        id: 'gnome-terminal',
        label: 'GNOME Terminal',
        supported: true,
        mechanism: 'dbus',
        dbusAction: 'tab-detach',
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

// ── Module state ─────────────────────────────────────────────────────────────

let _settings        = null;
let _virtualKeyboard = null;
let _pendingTimeouts = null;  // Set of GLib source ids
let _savedShortcuts  = null;  // Map "schema:key" → previous accel string

// ── Lifecycle ────────────────────────────────────────────────────────────────

function init() {
    ExtensionUtils.initTranslations();
}

function enable() {
    _settings = ExtensionUtils.getSettings(
        'org.gnome.shell.extensions.terminal-tab-to-window');
    _virtualKeyboard = null;
    _pendingTimeouts = new Set();
    _savedShortcuts = new Map();

    Main.wm.addKeybinding(
        'move-terminal-tab-shortcut',
        _settings,
        Meta.KeyBindingFlags.NONE,
        Shell.ActionMode.NORMAL,
        () => {
            _onGlobalShortcutActivated().catch(
                e => _log(`dispatch error: ${e.message}`));
        });

    _probeInstalledTerminals();
    _log('Enabled — shortcut registered.');
}

function disable() {
    Main.wm.removeKeybinding('move-terminal-tab-shortcut');

    if (_pendingTimeouts) {
        for (const id of _pendingTimeouts)
            GLib.Source.remove(id);
        _pendingTimeouts.clear();
    }
    _pendingTimeouts = null;

    _restoreSavedShortcuts();

    _virtualKeyboard = null;
    _settings = null;

    _logDirect('Disabled.');
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

async function _onGlobalShortcutActivated() {
    const win = global.display.focus_window;
    if (!win) return;

    const entry = _matchStrategy(win);
    if (!entry) {
        _log('Focused window is not a known terminal — ignoring.');
        return;
    }

    if (!entry.supported) {
        _notify(
            _('Detach not available'),
            _('%s cannot detach a tab programmatically. Use its own tab menu or drag the tab out.').replace('%s', entry.label));
        return;
    }

    if (entry.mechanism === 'dbus') {
        const ok = await _dbusDetach(win, entry);
        if (ok) return;
        _log('D-Bus detach unavailable — falling back to key injection.');
    }

    _injectDetach(entry);
}

function _matchStrategy(win) {
    for (const t of TERMINALS) {
        try {
            if (t.match(win)) return t;
        } catch (e) {
            // getter missing on this window — skip
        }
    }
    return null;
}

function _isFocused(entry) {
    const win = global.display.focus_window;
    if (!win) return false;
    try {
        return entry.match(win);
    } catch (e) {
        return false;
    }
}

// ── D-Bus mechanism ──────────────────────────────────────────────────────────

function _dbusDetach(win, entry) {
    return new Promise(resolve => {
        let busName, objPath;
        try {
            busName = win.get_gtk_unique_bus_name ? win.get_gtk_unique_bus_name() : null;
            objPath = win.get_gtk_window_object_path ? win.get_gtk_window_object_path() : null;
        } catch (e) {
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
                    _log(`org.gtk.Actions.List failed: ${e.message}`);
                    resolve(false);
                    return;
                }
                if (!actions.includes(entry.dbusAction)) {
                    _log(`Window does not export action "${entry.dbusAction}".`);
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
                            _log(`Detached via D-Bus action "${entry.dbusAction}".`);
                            resolve(true);
                        } catch (e) {
                            _log(`org.gtk.Actions.Activate failed: ${e.message}`);
                            resolve(false);
                        }
                    });
            });
    });
}

// ── Inject mechanism ─────────────────────────────────────────────────────────

function _injectDetach(entry) {
    const settings = _terminalSettings(entry);
    if (!settings) {
        _notify(
            _('Detach unavailable'),
            _('%s is not installed or exposes no detach shortcut setting.').replace('%s', entry.label));
        return;
    }

    const current = settings.get_string(entry.key);
    let accel;
    if (current && current !== 'disabled' && current !== '') {
        accel = current;
    } else {
        const mapKey = `${entry.schema}:${entry.key}`;
        if (!_savedShortcuts.has(mapKey))
            _savedShortcuts.set(mapKey, current);
        settings.set_string(entry.key, INTERNAL_SHORTCUT_GSETTINGS);
        accel = INTERNAL_SHORTCUT_GSETTINGS;
    }

    const keyvals = _accelToKeyvals(accel);
    if (!keyvals) {
        _log(`Cannot parse accelerator "${accel}" for injection.`);
        return;
    }
    _scheduleInject(entry, keyvals, 0);
}

function _scheduleInject(entry, keyvals, attempt) {
    if (attempt >= INJECT_RETRY_DELAYS.length) {
        _log('Injection aborted — terminal never regained focus.');
        return;
    }
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, INJECT_RETRY_DELAYS[attempt], () => {
        if (_pendingTimeouts) _pendingTimeouts.delete(id);
        if (!_isFocused(entry)) {
            _scheduleInject(entry, keyvals, attempt + 1);
            return GLib.SOURCE_REMOVE;
        }
        try {
            _injectKeyvals(keyvals);
            _log(`Injected detach shortcut into ${entry.label}.`);
        } catch (e) {
            _log(`Injection failed: ${e.message}`);
        }
        return GLib.SOURCE_REMOVE;
    });
    _pendingTimeouts.add(id);
}

function _injectKeyvals(kv) {
    const seat = Clutter.get_default_backend().get_default_seat();
    if (!_virtualKeyboard) {
        _virtualKeyboard = seat.create_virtual_device(
            Clutter.InputDeviceType.KEYBOARD_DEVICE);
    }
    let t = GLib.get_monotonic_time();

    for (const mod of kv.mods)
        _virtualKeyboard.notify_keyval(t++, mod, Clutter.KeyState.PRESSED);
    _virtualKeyboard.notify_keyval(t++, kv.key, Clutter.KeyState.PRESSED);
    _virtualKeyboard.notify_keyval(t++, kv.key, Clutter.KeyState.RELEASED);
    for (const mod of [...kv.mods].reverse())
        _virtualKeyboard.notify_keyval(t++, mod, Clutter.KeyState.RELEASED);
}

function _accelToKeyvals(accel) {
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

function _terminalSettings(entry) {
    try {
        const source = Gio.SettingsSchemaSource.get_default();
        const schema = source.lookup(entry.schema, true);
        if (!schema || !schema.has_key(entry.key)) return null;
        return new Gio.Settings({ schema_id: entry.schema });
    } catch (e) {
        _log(`Cannot open settings for ${entry.label}: ${e.message}`);
        return null;
    }
}

function _restoreSavedShortcuts() {
    if (!_savedShortcuts) return;
    for (const [mapKey, value] of _savedShortcuts) {
        const sep = mapKey.lastIndexOf(':');
        const schema = mapKey.slice(0, sep);
        const key = mapKey.slice(sep + 1);
        try {
            new Gio.Settings({ schema_id: schema }).set_string(key, value);
        } catch (e) {
            _logDirect(`Failed to restore ${schema} ${key}: ${e.message}`);
        }
    }
    _savedShortcuts.clear();
    _savedShortcuts = null;
}

function _probeInstalledTerminals() {
    const source = Gio.SettingsSchemaSource.get_default();
    const hasGnomeTerminal = !!source.lookup('org.gnome.Terminal.Legacy.Keybindings', true);
    const hasPtyxis = !!source.lookup('org.gnome.Ptyxis.Shortcuts', true);
    _log(`Installed terminals — GNOME Terminal: ${hasGnomeTerminal}, Ptyxis: ${hasPtyxis}.`);
    if (!hasGnomeTerminal && !hasPtyxis) {
        _notify(
            _('No supported terminal found'),
            _('Install GNOME Terminal or Ptyxis to use the tab-detach shortcut.'));
    }
}

// ── Logging / notifications ──────────────────────────────────────────────────

function _notify(title, body) {
    try {
        Main.notify(title, body);
    } catch (e) {
        _logDirect(`notify failed: ${e.message}`);
    }
}

function _log(message) {
    if (_settings && _settings.get_boolean('debug-logging'))
        log(`[TerminalTabToWindow] ${message}`);
}

function _logDirect(message) {
    log(`[TerminalTabToWindow] ${message}`);
}
