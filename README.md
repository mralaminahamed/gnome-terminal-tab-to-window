<div align="center">

# Terminal Tab to New Window

[![GNOME Shell 42–50](https://img.shields.io/badge/GNOME%20Shell-42%E2%80%9350-4A86CF?style=flat-square&logo=gnome&logoColor=white)](https://gjs.guide/extensions/)
[![License MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Ubuntu 22.04–24.04](https://img.shields.io/badge/Ubuntu-22.04%E2%80%9324.04-E95420?style=flat-square&logo=ubuntu&logoColor=white)](https://ubuntu.com/)
[![Session Wayland | X11](https://img.shields.io/badge/session-Wayland%20%7C%20X11-777?style=flat-square)](https://wiki.gnome.org/Initiatives/Wayland)

A GNOME Shell extension that adds a global keyboard shortcut to detach the active **GNOME Terminal** tab into its own window — on both Wayland and X11.

</div>

> [!NOTE]
> GNOME Terminal has no plugin API, so this extension drives the terminal's own `detach-tab` action. On **enable** it sets GNOME Terminal's `detach-tab` keybinding to `Ctrl+Shift+Alt+D` (the previous value is saved and **restored on disable**), and when you press the global shortcut it injects that combination as a synthetic keystroke. Nothing leaves your machine.

## Quick Start

```bash
git clone https://github.com/mralaminahamed/gnome-terminal-tab-to-window.git
cd gnome-terminal-tab-to-window/terminal-tab-to-window@mralaminahamed.github.com
chmod +x install.sh
./install.sh
```

The installer auto-detects your GNOME Shell version, copies the correct variant into `~/.local/share/gnome-shell/extensions/`, compiles the GSettings schema, and enables the extension. Then **restart GNOME Shell** — log out and back in on Wayland, or press `Alt+F2` → `r` → `Enter` on X11.

Open **GNOME Terminal** with at least two tabs and press **`Super+Shift+W`**. The active tab detaches into its own window.

## What It Does

GNOME Terminal's tab context menu cannot be extended without patching C source, and its libpeas plugin system was removed years ago. The only clean, package-update-safe way to add "move tab to new window" behaviour is from **outside** the terminal — a GNOME Shell extension that intercepts a global shortcut and triggers the terminal's built-in detach action.

Useful when you:

- Split one terminal session into several windows across monitors
- Want a keyboard-only equivalent of dragging a tab out
- Prefer GNOME Terminal but miss Tilix-style tab detachment

## How It Works

```mermaid
flowchart TD
    A["User presses Super+Shift+W"] --> B{"Focused window<br/>is GNOME Terminal?"}
    B -->|No| C["Ignore — other apps unaffected"]
    B -->|Yes| D["Wait 80 ms"]
    D --> E{"Still focused<br/>on GNOME Terminal?"}
    E -->|No| C
    E -->|Yes| F["Clutter.VirtualInputDevice<br/>injects Ctrl+Shift+Alt+D"]
    F --> G["GNOME Terminal runs its<br/>detach-tab action"]
    G --> H["Active tab opens in a new window"]
```

1. On **enable**, the extension writes `Ctrl+Shift+Alt+D` into `org.gnome.Terminal.Legacy.Keybindings → detach-tab` so the terminal process responds to that combination.
2. On the global shortcut, GNOME Shell confirms GNOME Terminal is focused, waits briefly, **re-checks focus**, then injects the internal combination through a `Clutter.VirtualInputDevice`. Because injection goes through the compositor, it works identically on Wayland and X11.

## Features

| Feature | Description |
|---------|-------------|
| Global shortcut | Default `Super+Shift+W`, fires only when GNOME Terminal is focused |
| Configurable | Rebind the shortcut from the preferences dialog or via `gsettings` |
| Wayland & X11 | Input injected through the compositor — no X11-only APIs |
| Focus guard | Re-checks the focused window right before injecting, so keys never reach another app |
| Clean teardown | Removes its keybinding, cancels pending timers, and restores GNOME Terminal's original `detach-tab` value on disable |
| Two variants | ESM `extension.js` for GNOME 45–50; `extension-gnome42.js` for GNOME 42–44 |
| No network | No telemetry, analytics, or outbound requests of any kind |

## Installation

### Automatic (recommended)

```bash
./install.sh            # auto-detects GNOME Shell version
./install.sh --gnome42  # force the GNOME 42–44 variant (Ubuntu 22.04)
```

The installer:

- Copies the correct variant to `~/.local/share/gnome-shell/extensions/terminal-tab-to-window@mralaminahamed.github.com/`
- Copies `prefs.js` (GNOME 45+ only) and compiles the GSettings schema
- Enables the extension via `gnome-extensions enable`
- Sets `Ctrl+Shift+Alt+D` as GNOME Terminal's internal `detach-tab` shortcut

### Restart GNOME Shell

| Session | How |
|---------|-----|
| **Wayland** (Ubuntu 24.04 default) | Log out → log back in |
| **X11** | `Alt+F2` → type `r` → `Enter` |

## Preferences

### Preferences dialog (GNOME 45+)

```bash
gnome-extensions prefs terminal-tab-to-window@mralaminahamed.github.com
```

Or open the **GNOME Extensions** app and click the ⚙ icon. The dialog shows the current shortcut and lets you rebind it — click **Change…** and press the new combination (Backspace clears, Escape cancels).

### Command line

```bash
# Set a custom shortcut (example: Ctrl+Alt+W)
gsettings set org.gnome.shell.extensions.terminal-tab-to-window \
  move-terminal-tab-shortcut "['<Primary><Alt>w']"

# Reset to the default (Super+Shift+W)
gsettings reset org.gnome.shell.extensions.terminal-tab-to-window \
  move-terminal-tab-shortcut
```

## Verifying the Installation

```bash
# 1. Confirm the extension is enabled
gnome-extensions list --enabled | grep terminal-tab

# 2. Confirm GNOME Terminal's internal shortcut was set
gsettings get org.gnome.Terminal.Legacy.Keybindings detach-tab
# Expected: '<Primary><Shift><Alt>d'

# 3. Watch GNOME Shell logs for extension messages
journalctl -f /usr/bin/gnome-shell | grep TerminalTabToWindow
```

## Troubleshooting

<details>
<summary>Shortcut does nothing</summary>

1. Confirm GNOME Terminal is the **focused** window when you press the shortcut.
2. Check the internal shortcut is set:
   ```bash
   gsettings get org.gnome.Terminal.Legacy.Keybindings detach-tab
   ```
   If the output is `'disabled'` or empty, run:
   ```bash
   gsettings set org.gnome.Terminal.Legacy.Keybindings detach-tab '<Primary><Shift><Alt>d'
   ```
</details>

<details>
<summary><code>detach-tab</code> key not found in schema</summary>

Some older GNOME Terminal builds omit this key. Verify with:

```bash
gsettings list-keys org.gnome.Terminal.Legacy.Keybindings | grep detach
```

If it is missing, your GNOME Terminal version does not support keyboard-driven tab detachment. Consider [Tilix](https://gnunn1.github.io/tilix-web/), which supports tab drag-out natively.
</details>

<details>
<summary>Extension not loading after install</summary>

Ensure the schema compiled:

```bash
ls ~/.local/share/gnome-shell/extensions/terminal-tab-to-window@mralaminahamed.github.com/schemas/gschemas.compiled
```

If missing:

```bash
glib-compile-schemas \
  ~/.local/share/gnome-shell/extensions/terminal-tab-to-window@mralaminahamed.github.com/schemas/
```

Then restart GNOME Shell.
</details>

<details>
<summary>Wrong GNOME Shell version</summary>

```bash
gnome-shell --version
```

- **GNOME 45–50** → `extension.js` (ES modules, installed by default)
- **GNOME 42–44** → `./install.sh --gnome42` (uses `extension-gnome42.js`)
</details>

## Packaging for extensions.gnome.org

`package.sh` builds clean submission zips with `gnome-extensions pack`, excluding install scripts and the unused variant automatically.

```bash
./package.sh            # GNOME 45+ (ESM) zip  → dist/…​.shell-extension.zip
./package.sh --gnome42  # GNOME 42–44 zip      → dist/…​-gnome42.shell-extension.zip
```

extensions.gnome.org accepts one zip per shell-version range for the same UUID, so the modern and legacy packages are uploaded as two separate submissions.

## Project Structure

```
terminal-tab-to-window@mralaminahamed.github.com/
├── extension.js            # GNOME Shell 45–50 (ES modules)
├── extension-gnome42.js    # GNOME Shell 42–44 (classic imports)
├── prefs.js                # Preferences dialog (GNOME 45+)
├── metadata.json           # UUID, versions, settings-schema
├── schemas/
│   └── org.gnome.shell.extensions.terminal-tab-to-window.gschema.xml
├── po/                     # Translation template + language .po files
│   ├── terminal-tab-to-window.pot
│   └── update-pot.sh
├── install.sh              # Installer (auto-detects GNOME version)
├── uninstall.sh            # Removes extension, restores terminal keybinding
├── package.sh              # Builds extensions.gnome.org zips
├── CHANGELOG.md
└── README.md
```

## Why Not a True Tab Context Menu?

GNOME Terminal has **no extension or plugin API** in modern versions — the libpeas plugin system was removed in GNOME Terminal 3.x. The only ways to add an item to its tab right-click menu are:

- Patch and recompile the C source — complex, breaks on every package update.
- Use `LD_PRELOAD` to inject a shared library — fragile and security-relevant.

This GNOME Shell extension is the cleanest available alternative: it hooks into the compositor (where there *is* a stable extension API) and drives the terminal through its own keybinding infrastructure. For native drag-to-new-window support, [**Tilix**](https://gnunn1.github.io/tilix-web/) (`sudo apt install tilix`) is a good alternative.

## Translations

The GNOME 45+ preferences dialog is fully translatable (gettext domain `terminal-tab-to-window`). To add a language:

```bash
cd po
./update-pot.sh                                              # refresh the template
msginit --input=terminal-tab-to-window.pot --locale=fr --output=fr.po
# translate fr.po, then rebuild:
cd .. && ./package.sh                                        # compiles po/*.po into locale/
```

`package.sh` compiles every `po/*.po` into `locale/<lang>/LC_MESSAGES/` inside the submission zip automatically.

## Privacy

No network requests, telemetry, or analytics. The extension only reads and writes local GSettings keys (`org.gnome.shell.extensions.terminal-tab-to-window` and `org.gnome.Terminal.Legacy.Keybindings`) and injects local input events. The GNOME Terminal keybinding it changes is restored to its previous value on disable.

## Uninstalling

```bash
chmod +x uninstall.sh
./uninstall.sh
```

Disables the extension, removes its files, and resets GNOME Terminal's `detach-tab` shortcut to the default. Restart GNOME Shell afterwards to complete cleanup.

## Changelog

The full version history lives in [CHANGELOG.md](CHANGELOG.md), in [Keep a Changelog](https://keepachangelog.com/) format.

## Contributing

Bug reports, feature requests, and pull requests are welcome on the [issue tracker](https://github.com/mralaminahamed/gnome-terminal-tab-to-window/issues). Please run `eslint` over JavaScript changes and, where possible, test on both a GNOME 42 (Ubuntu 22.04) and a GNOME 46+ (Ubuntu 24.04) session before submitting.

## Maintainer

Al Amin Ahamed — [alaminahamed.com](https://alaminahamed.com) · [@mralaminahamed](https://github.com/mralaminahamed)

## License

[MIT](LICENSE) © Al Amin Ahamed
