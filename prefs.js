/**
 * Terminal Tab to New Window — Preferences (GNOME 45+)
 *
 * Provides the settings dialog opened by:
 *   gnome-extensions prefs terminal-tab-to-window@mralaminahamed.github.com
 * or the ⚙ gear icon in the Extensions app.
 *
 * Lets the user rebind the global shortcut stored in the "as" GSettings key
 * "move-terminal-tab-shortcut".
 *
 * @author Al Amin Ahamed <mrabir.ahamed@gmail.com>
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SETTINGS_KEY = 'move-terminal-tab-shortcut';

export default class TerminalTabToWindowPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();

    const page = new Adw.PreferencesPage({
      title: _('Shortcut'),
      icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
    });

    const group = new Adw.PreferencesGroup({
      title: _('Global Keyboard Shortcut'),
      description: _('Press this shortcut while a supported terminal is focused to detach the active tab into its own window.'),
    });
    page.add(group);

    // Row showing the current accelerator with Change / Clear buttons.
    const row = new Adw.ActionRow({
      title: _('Detach terminal tab'),
    });

    const shortcutLabel = new Gtk.ShortcutLabel({
      valign: Gtk.Align.CENTER,
      disabled_text: _('Disabled'),
    });
    this._syncLabel(shortcutLabel, settings);

    const changeButton = new Gtk.Button({
      label: _('Change…'),
      valign: Gtk.Align.CENTER,
    });
    const clearButton = new Gtk.Button({
      icon_name: 'edit-clear-symbolic',
      valign: Gtk.Align.CENTER,
      tooltip_text: _('Clear shortcut'),
    });

    changeButton.connect('clicked', () =>
      this._captureAccelerator(window, settings, shortcutLabel));
    clearButton.connect('clicked', () => {
      settings.set_strv(SETTINGS_KEY, []);
      this._syncLabel(shortcutLabel, settings);
    });

    // Keep the label live if the value changes elsewhere (e.g. gsettings CLI).
    const changedId = settings.connect(`changed::${SETTINGS_KEY}`, () =>
      this._syncLabel(shortcutLabel, settings));
    window.connect('close-request', () => settings.disconnect(changedId));

    row.add_suffix(shortcutLabel);
    row.add_suffix(changeButton);
    row.add_suffix(clearButton);
    group.add(row);

    // Behaviour group — verbose logging toggle.
    const behaviourGroup = new Adw.PreferencesGroup({
      title: _('Behaviour'),
    });
    page.add(behaviourGroup);

    const debugRow = new Adw.SwitchRow({
      title: _('Verbose logging'),
      subtitle: _('Log detailed diagnostics to the GNOME Shell journal. Leave off for normal use.'),
    });
    settings.bind('debug-logging', debugRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    behaviourGroup.add(debugRow);

    // Supported terminals — read-only informational rows.
    const terminalsGroup = new Adw.PreferencesGroup({
      title: _('Supported terminals'),
      description: _('Which terminals this shortcut can detach a tab from.'),
    });
    page.add(terminalsGroup);

    terminalsGroup.add(new Adw.ActionRow({
      title: _('GNOME Terminal'),
      subtitle: _('Detached directly via its D-Bus action — no keybinding is changed.'),
    }));
    terminalsGroup.add(new Adw.ActionRow({
      title: _('Ptyxis'),
      subtitle: _('Detached by setting and injecting its detach-tab shortcut.'),
    }));
    terminalsGroup.add(new Adw.ActionRow({
      title: _('GNOME Console, Tilix'),
      subtitle: _('Recognised, but they expose no way to detach a tab from outside the app.'),
    }));

    window.add(page);
  }

  /** Reflect the current GSettings value into the Gtk.ShortcutLabel. */
  _syncLabel(label, settings) {
    const [accel] = settings.get_strv(SETTINGS_KEY);
    label.set_accelerator(accel ?? '');
  }

  /**
   * Opens a modal dialog that captures the next key combination and writes it
   * to GSettings. Escape cancels; Backspace clears.
   */
  _captureAccelerator(parent, settings, label) {
    const dialog = new Adw.MessageDialog({
      transient_for: parent,
      modal: true,
      heading: _('Set Shortcut'),
      body: _('Press the desired key combination, or Backspace to clear, Escape to cancel.'),
    });

    const controller = new Gtk.EventControllerKey();
    dialog.add_controller(controller);

    controller.connect('key-pressed', (_c, keyval, keycode, state) => {
      const mask = state & Gtk.accelerator_get_default_mod_mask() & ~Gdk.ModifierType.LOCK_MASK;

      // Ignore lone modifier presses; wait for a real key.
      if (this._isModifierKeyval(keyval))
        return Gdk.EVENT_STOP;

      if (keyval === Gdk.KEY_Escape && mask === 0) {
        dialog.close();
        return Gdk.EVENT_STOP;
      }

      if (keyval === Gdk.KEY_BackSpace && mask === 0) {
        settings.set_strv(SETTINGS_KEY, []);
        this._syncLabel(label, settings);
        dialog.close();
        return Gdk.EVENT_STOP;
      }

      if (Gtk.accelerator_valid(keyval, mask)) {
        const accel = Gtk.accelerator_name(keyval, mask);
        settings.set_strv(SETTINGS_KEY, [accel]);
        this._syncLabel(label, settings);
        dialog.close();
      }
      return Gdk.EVENT_STOP;
    });

    dialog.present();
  }

  _isModifierKeyval(keyval) {
    return [
      Gdk.KEY_Control_L, Gdk.KEY_Control_R,
      Gdk.KEY_Shift_L, Gdk.KEY_Shift_R,
      Gdk.KEY_Alt_L, Gdk.KEY_Alt_R,
      Gdk.KEY_Super_L, Gdk.KEY_Super_R,
      Gdk.KEY_Meta_L, Gdk.KEY_Meta_R,
      Gdk.KEY_Hyper_L, Gdk.KEY_Hyper_R,
    ].includes(keyval);
  }
}
