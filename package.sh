#!/usr/bin/env bash
# package.sh — build a clean zip for extensions.gnome.org (EGO) submission.
#
# Uses the canonical `gnome-extensions pack`, which includes ONLY the files EGO
# needs (extension.js, prefs.js, metadata.json, schemas/, plus --extra-source).
# It automatically EXCLUDES install.sh, uninstall.sh, push-to-github.sh,
# package.sh, README.md and extension-gnome42.js — satisfying the EGO rule that
# a submission "should not include files that are not necessary for it to
# function" (https://gjs.guide/extensions/review-guidelines/review-guidelines.html).
#
# EGO supports one zip per shell-version range for the same UUID. This builds
# the GNOME 45+ (ESM) package. For a GNOME 42 package, rename
# extension-gnome42.js -> extension.js, set shell-version ["42","43","44"] in
# metadata.json, drop prefs.js, and pack separately.
#
# Author: Al Amin Ahamed <mrabir.ahamed@gmail.com>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${1:-$SCRIPT_DIR/dist}"

command -v gnome-extensions >/dev/null 2>&1 || {
    echo "ERROR: gnome-extensions tool not found (part of gnome-shell)."; exit 1;
}

mkdir -p "$OUT_DIR"

echo "Packing GNOME 45+ (ESM) extension zip..."
gnome-extensions pack "$SCRIPT_DIR" \
    --extra-source=LICENSE \
    --force \
    --out-dir="$OUT_DIR"

echo ""
echo "✓ Built: $OUT_DIR/terminal-tab-to-window@mralaminahamed.github.com.shell-extension.zip"
echo ""
echo "Verify contents (should NOT contain install.sh / extension-gnome42.js):"
echo "  unzip -l \"$OUT_DIR\"/*.zip"
echo ""
echo "Upload at: https://extensions.gnome.org/upload/"
