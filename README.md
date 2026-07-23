# Terminal Tab to New Window

A GNOME Shell extension that adds a global keyboard shortcut to detach the active **GNOME Terminal** tab into its own window.

> **Supports:** GNOME Shell 42–48 · Ubuntu 22.04 / 23.10 / 24.04 · Wayland & X11

---

## The Problem

GNOME Terminal has no plugin API, so its tab right-click context menu cannot be extended without patching C source. The closest practical alternative is a **GNOME Shell extension** that intercepts a global keyboard shortcut and drives GNOME Terminal's own internal `detach-tab` action.

---

## How It Works

The extension operates in two co-operating steps:

1. On **enable**, it writes `Ctrl+Shift+Alt+D` into GNOME Terminal's GSettings keybindings (`org.gnome.Terminal.Legacy.Keybindings → detach-tab`) so the terminal process will respond to that combination.

2. When you press **`Super+Shift+W`** (the configurable global shortcut), GNOME Shell checks whether the focused window is GNOME Terminal. If it is, it injects the internal shortcut via a **`Clutter.VirtualInputDevice`** — which routes through the Wayland compositor and works on both Wayland and X11.

```
User presses Super+Shift+W
        │
        ▼
GNOME Shell (compositor)
  ├─ Focused window = gnome-terminal?  ─── No ──▶ ignore
  └─ Yes
        │
        ▼ (80 ms delay)
Clutter.VirtualInputDevice
  └─ Injects Ctrl+Shift+Alt+D
        │
        ▼
GNOME Terminal
  └─ "detach-tab" action ──▶ tab opens in new window
```

---

## Requirements

| Requirement | Version |
|---|---|
| Ubuntu | 22.04 LTS, 23.10, or 24.04 LTS |
| GNOME Shell | 42, 43, 44, 45, 46, 47, or 48 |
| GNOME Terminal | Any recent version with `detach-tab` keybinding support |
| Display server | Wayland (default) or X11 |

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/mralaminahamed/gnome-terminal-tab-to-window.git
cd gnome-terminal-tab-to-window
```

### 2. Run the installer

The installer auto-detects your GNOME Shell version and picks the correct extension variant.

```bash
chmod +x install.sh
./install.sh
```

For **Ubuntu 22.04** (GNOME Shell 42) explicitly:

```bash
./install.sh --gnome42
```

The installer:
- Copies the extension to `~/.local/share/gnome-shell/extensions/`
- Compiles the GSettings schema
- Enables the extension via `gnome-extensions enable`
- Sets `Ctrl+Shift+Alt+D` as GNOME Terminal's internal detach-tab shortcut

### 3. Restart GNOME Shell

| Session type | How to restart |
|---|---|
| **Wayland** (Ubuntu 24.04 default) | Log out → Log back in |
| **X11** | Press `Alt+F2`, type `r`, press `Enter` |

### 4. Use it

1. Open **GNOME Terminal** with at least two tabs.
2. Press **`Super+Shift+W`** — the active tab detaches into its own window.

> The shortcut only fires when GNOME Terminal is the focused application, so it does not interfere with other apps.

---

## Changing the Shortcut

### Via the Extensions preferences UI

```bash
gnome-extensions prefs terminal-tab-to-window@mralaminahamed.github.com
```

Or open the **GNOME Extensions** app → click the ⚙ icon next to this extension.

### Via gsettings (command line)

```bash
# Set a custom shortcut (example: Ctrl+Alt+W)
gsettings set org.gnome.shell.extensions.terminal-tab-to-window \
  move-terminal-tab-shortcut "['<Primary><Alt>w']"

# Reset to default (Super+Shift+W)
gsettings reset org.gnome.shell.extensions.terminal-tab-to-window \
  move-terminal-tab-shortcut
```

---

## Verifying the Installation

```bash
# 1. Confirm the extension is enabled
gnome-extensions list --enabled | grep terminal-tab

# 2. Confirm GNOME Terminal's internal shortcut was set
gsettings get org.gnome.Terminal.Legacy.Keybindings detach-tab
# Expected: '<Primary><Shift><Alt>d'

# 3. Check GNOME Shell logs for any errors
journalctl -f /usr/bin/gnome-shell | grep TerminalTabToWindow
```

---

## Troubleshooting

### Shortcut does nothing

1. Confirm GNOME Terminal is the **focused** window when you press the shortcut.
2. Check that the internal shortcut is set:
   ```bash
   gsettings get org.gnome.Terminal.Legacy.Keybindings detach-tab
   ```
   If the output is `'disabled'` or empty, run:
   ```bash
   gsettings set org.gnome.Terminal.Legacy.Keybindings detach-tab '<Primary><Shift><Alt>d'
   ```

### `detach-tab` key not found in schema

Some older GNOME Terminal builds omit this key. Verify with:

```bash
gsettings list-keys org.gnome.Terminal.Legacy.Keybindings | grep detach
```

If it's missing, your GNOME Terminal version does not support keyboard-driven tab detachment. Consider switching to [Tilix](https://gnunn1.github.io/tilix-web/), which supports tab drag-out natively.

### Extension not loading after install

Ensure the schema compiled correctly:

```bash
ls ~/.local/share/gnome-shell/extensions/terminal-tab-to-window@mralaminahamed.github.com/schemas/gschemas.compiled
```

If the file is missing:

```bash
glib-compile-schemas \
  ~/.local/share/gnome-shell/extensions/terminal-tab-to-window@mralaminahamed.github.com/schemas/
```

Then restart GNOME Shell.

### Wrong GNOME Shell version error

Check your version:

```bash
gnome-shell --version
```

- **GNOME 45+** → use `extension.js` (ES modules, installed by default)
- **GNOME 42–44** → run `./install.sh --gnome42` (uses `extension-gnome42.js`)

---

## Uninstalling

```bash
chmod +x uninstall.sh
./uninstall.sh
```

This disables the extension, removes all files, and resets GNOME Terminal's `detach-tab` shortcut to its default value.

---

## File Structure

```
terminal-tab-to-window@mralaminahamed.github.com/
├── extension.js              # GNOME Shell 45+ (ES modules — Ubuntu 23.10 / 24.04)
├── extension-gnome42.js      # GNOME Shell 42–44  (Ubuntu 22.04)
├── metadata.json             # Extension metadata and supported shell versions
├── schemas/
│   └── org.gnome.shell.extensions.terminal-tab-to-window.gschema.xml
├── install.sh                # Installer (auto-detects GNOME version)
├── uninstall.sh              # Removes extension and resets terminal keybinding
└── README.md
```

---

## Why Not a True Tab Context Menu?

GNOME Terminal has **no extension or plugin API** in modern versions (the libpeas-based plugin system was removed in GNOME Terminal 3.x). The only ways to add an item to its tab right-click menu are:

- Patch and recompile the C source — complex, breaks on every package update.
- Use `LD_PRELOAD` to inject a shared library — fragile and security-relevant.

This GNOME Shell extension is the cleanest available alternative: it hooks into the compositor (where there *is* a stable extension API) and drives the terminal through its own keybinding infrastructure.

For native drag-to-new-window support, [**Tilix**](https://gnunn1.github.io/tilix-web/) is the recommended alternative:

```bash
sudo apt install tilix
```

---

## Contributing

Pull requests are welcome. Please:

- Target `main` for bug fixes and `develop` for new features.
- Run `eslint` over any JavaScript changes.
- Test on both GNOME 42 (Ubuntu 22.04) and GNOME 46 (Ubuntu 24.04) before submitting.

---

## License

MIT © [Al Amin Ahamed](https://github.com/mralaminahamed)
