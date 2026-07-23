#!/usr/bin/env bash
# install.sh — Terminal Tab to New Window GNOME Shell Extension
#
# Usage:
#   ./install.sh           # auto-detects GNOME Shell version
#   ./install.sh --gnome42 # force GNOME 42 mode (Ubuntu 22.04)
#
# Author: Al Amin Ahamed <mrabir.ahamed@gmail.com>

set -euo pipefail

UUID="terminal-tab-to-window@mralaminahamed.github.com"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Detect GNOME Shell version ────────────────────────────────────────────────

GNOME_VERSION=$(gnome-shell --version 2>/dev/null | grep -oP '\d+' | head -1 || echo "0")
FORCE_GNOME42=false

for arg in "$@"; do
    [[ "$arg" == "--gnome42" ]] && FORCE_GNOME42=true
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Terminal Tab to New Window — Installer"
echo "  GNOME Shell version detected: $GNOME_VERSION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Validate GNOME Shell version ──────────────────────────────────────────────

if [[ "$GNOME_VERSION" -lt 42 ]]; then
    echo "ERROR: GNOME Shell $GNOME_VERSION is not supported (minimum: 42)."
    exit 1
fi

if [[ "$GNOME_VERSION" -ge 45 && "$FORCE_GNOME42" == false ]]; then
    EXT_SRC="extension.js"
    SHELL_VERSIONS='"45", "46", "47", "48", "49", "50"'
    echo "Mode: GNOME 45+ (ES modules)"
else
    EXT_SRC="extension-gnome42.js"
    SHELL_VERSIONS='"42", "43", "44"'
    echo "Mode: GNOME 42 (Ubuntu 22.04 / classic imports)"
fi
echo ""

# ── Install ───────────────────────────────────────────────────────────────────

echo "Installing to: $DEST"
mkdir -p "$DEST/schemas"

# Copy the correct extension.js
cp "$SCRIPT_DIR/$EXT_SRC" "$DEST/extension.js"

# Copy static files
cp "$SCRIPT_DIR/metadata.json" "$DEST/metadata.json"
cp "$SCRIPT_DIR/schemas/"*.gschema.xml "$DEST/schemas/"

# Preferences dialog (GNOME 45+ only; the GNOME 42 path is not shipped here)
if [[ "$EXT_SRC" == "extension.js" && -f "$SCRIPT_DIR/prefs.js" ]]; then
    cp "$SCRIPT_DIR/prefs.js" "$DEST/prefs.js"
fi

# Patch shell-version in metadata.json for the selected mode
sed -i "s/\"shell-version\": \[.*\]/\"shell-version\": [$SHELL_VERSIONS]/" "$DEST/metadata.json"

# Compile GSettings schema
echo "Compiling GSettings schema..."
glib-compile-schemas "$DEST/schemas/"

# Enable the extension
echo "Enabling extension..."
gnome-extensions enable "$UUID" 2>/dev/null || true

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✓  Extension installed: $UUID"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "NEXT STEP — restart GNOME Shell to activate:"
echo ""
if [[ "$GNOME_VERSION" -ge 45 ]]; then
    echo "  Wayland (Ubuntu 24.04): Log out and back in."
else
    echo "  X11:     Press Alt+F2, type 'r', press Enter."
    echo "  Wayland: Log out and back in."
fi
echo ""
echo "Default shortcut: Super + Shift + W"
echo "  (Only fires when GNOME Terminal is the focused window)"
echo ""
echo "To change the shortcut:"
echo "  gnome-extensions prefs $UUID"
echo "  OR: GNOME Extensions app → ⚙ → Keyboard shortcut"
echo ""
echo "To verify GNOME Terminal's internal shortcut was set:"
echo "  gsettings get org.gnome.Terminal.Legacy.Keybindings detach-tab"
echo "  # Expected output: '<Primary><Shift><Alt>d'"
echo ""
