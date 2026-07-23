#!/usr/bin/env bash
# update-pot.sh — regenerate the translation template from source strings.
#
# Run from the po/ directory (or anywhere; paths are resolved relative to this
# script). Extracts every _()/C_()/ngettext() string from prefs.js.
#
# To start a new translation:
#   msginit --input=terminal-tab-to-window.pot --locale=fr --output=fr.po
# Then translate fr.po and rebuild the zip with ../package.sh — gnome-extensions
# pack compiles po/*.po into locale/<lang>/LC_MESSAGES/ inside the package.

set -euo pipefail

PO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(dirname "$PO_DIR")"

xgettext --from-code=UTF-8 \
    --language=JavaScript \
    --keyword=_ --keyword=C_:1c,2 --keyword=ngettext:1,2 \
    --package-name="Terminal Tab to New Window" \
    --package-version="1.0.0" \
    --copyright-holder="Al Amin Ahamed" \
    --msgid-bugs-address="mrabir.ahamed@gmail.com" \
    -o "$PO_DIR/terminal-tab-to-window.pot" \
    "$SRC_DIR/prefs.js"

echo "✓ Updated $PO_DIR/terminal-tab-to-window.pot"

# Merge the refreshed template into any existing translations.
for po in "$PO_DIR"/*.po; do
    [[ -e "$po" ]] || continue
    msgmerge --update --backup=none "$po" "$PO_DIR/terminal-tab-to-window.pot"
    echo "✓ Merged into $(basename "$po")"
done
