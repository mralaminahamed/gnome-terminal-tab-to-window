#!/usr/bin/env bash
# package.sh — build clean zip(s) for extensions.gnome.org (EGO) submission.
#
#   ./package.sh            # GNOME 45+ (ESM) package
#   ./package.sh --gnome42  # GNOME 42–44 (legacy) package
#
# Uses the canonical `gnome-extensions pack`, which includes ONLY the files EGO
# needs (extension.js, prefs.js, metadata.json, schemas/, plus --extra-source)
# and automatically EXCLUDES install.sh, uninstall.sh, push-to-github.sh,
# package.sh, README.md and the other-mode extension file — satisfying the EGO
# rule that a submission "should not include files that are not necessary for it
# to function"
# (https://gjs.guide/extensions/review-guidelines/review-guidelines.html).
#
# EGO supports one zip per shell-version range for the same UUID, so the modern
# and legacy packages are uploaded as two separate submissions.
#
# Author: Al Amin Ahamed <mrabir.ahamed@gmail.com>

set -euo pipefail

UUID="terminal-tab-to-window@mralaminahamed.github.com"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$SCRIPT_DIR/dist"

MODE="45plus"
for arg in "$@"; do
    [[ "$arg" == "--gnome42" ]] && MODE="gnome42"
done

command -v gnome-extensions >/dev/null 2>&1 || {
    echo "ERROR: gnome-extensions tool not found (part of gnome-shell)."; exit 1;
}

mkdir -p "$OUT_DIR"

if [[ "$MODE" == "45plus" ]]; then
    echo "Packing GNOME 45+ (ESM) extension zip..."
    gnome-extensions pack "$SCRIPT_DIR" \
        --extra-source=LICENSE \
        --force \
        --out-dir="$OUT_DIR"

    ZIP="$OUT_DIR/$UUID.shell-extension.zip"
else
    echo "Packing GNOME 42–44 (legacy) extension zip..."

    # gnome-extensions pack works on a directory whose extension.js is the file
    # to ship. Build a temporary tree from the legacy source so prefs.js (ESM,
    # incompatible with GNOME 42) is excluded and shell-version is 42–44.
    BUILD="$(mktemp -d)"
    trap 'rm -rf "$BUILD"' EXIT

    cp "$SCRIPT_DIR/extension-gnome42.js" "$BUILD/extension.js"
    cp "$SCRIPT_DIR/LICENSE"              "$BUILD/LICENSE"
    mkdir -p "$BUILD/schemas"
    cp "$SCRIPT_DIR/schemas/"*.gschema.xml "$BUILD/schemas/"

    # metadata with shell-version patched to the legacy range.
    sed 's/"shell-version": \[.*\]/"shell-version": ["42", "43", "44"]/' \
        "$SCRIPT_DIR/metadata.json" > "$BUILD/metadata.json"

    # Pack into the temp dir first so the 45+ zip in dist/ (same UUID filename)
    # is never clobbered, then move to a distinct legacy name.
    gnome-extensions pack "$BUILD" \
        --extra-source=LICENSE \
        --force \
        --out-dir="$BUILD"

    mv "$BUILD/$UUID.shell-extension.zip" \
       "$OUT_DIR/$UUID-gnome42.shell-extension.zip"
    ZIP="$OUT_DIR/$UUID-gnome42.shell-extension.zip"
fi

echo ""
echo "✓ Built: $ZIP"
echo ""
echo "Verify contents (should NOT contain install.sh / the other extension file):"
echo "  unzip -l \"$ZIP\""
echo ""
echo "Upload at: https://extensions.gnome.org/upload/"
