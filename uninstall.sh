#!/usr/bin/env bash
# uninstall.sh — Terminal Tab to New Window GNOME Shell Extension
#
# Removes the extension and optionally resets the GNOME Terminal keybinding.
#
# Author: Al Amin Ahamed <mrabir.ahamed@gmail.com>

set -euo pipefail

UUID="terminal-tab-to-window@mralaminahamed.github.com"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "Disabling extension..."
gnome-extensions disable "$UUID" 2>/dev/null || true

echo "Removing files..."
rm -rf "$DEST"

echo "Resetting GNOME Terminal detach-tab shortcut to default..."
gsettings reset org.gnome.Terminal.Legacy.Keybindings detach-tab 2>/dev/null || true

echo ""
echo "✓  Extension uninstalled."
echo ""
echo "Restart GNOME Shell to fully clean up:"
echo "  Wayland: Log out and back in."
echo "  X11:     Alt+F2 → 'r' → Enter"
echo ""
