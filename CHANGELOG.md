# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versioning is [SemVer](https://semver.org/).

## [Unreleased]

### Fixed
- **Extension failed to enable:** `getSettings()` was called with no argument while `metadata.json` lacked a `settings-schema` key, so schema resolution threw in `enable()`. Added `settings-schema` to `metadata.json`.
- **`gnome-extensions prefs` did nothing:** no `prefs.js` existed, so the documented preferences command failed and no ⚙ gear icon appeared. Added a `prefs.js` with an accelerator-capture UI.
- Pending `GLib.timeout_add` injection sources are now tracked and removed in `disable()` (previously leaked past teardown).
- GNOME Terminal's `detach-tab` keybinding is now saved on enable and restored on disable (previously left overwritten until uninstall).
- Focus is re-checked immediately before key injection, so synthetic keys are never delivered to another app if the user switches windows during the injection delay.
- Reduced routine logging to `console.debug`.
- Corrected `metadata.json` `url` to the real repository name.

### Added
- `prefs.js` preferences dialog (GNOME 45+) to rebind the shortcut.
- `version-name` in `metadata.json`.
- `package.sh` to build clean extensions.gnome.org submission zips via `gnome-extensions pack` — `--gnome42` builds the separate legacy package.
- Internationalization: `gettext-domain` in `metadata.json`, a `po/` translation template (`terminal-tab-to-window.pot`) and `po/update-pot.sh`; `package.sh` compiles `po/*.po` into the packaged `locale/`.

### Changed
- Declared support for GNOME Shell 49 and 50 (`shell-version` now `45`–`50` for the ESM variant).
- Rewrote `README.md` (badges, feature tables, mermaid architecture, packaging and privacy sections).

## [1.0.0] — 2026-07-23

### Added
- Initial release.
- Global keyboard shortcut (default `Super+Shift+W`) to detach the active GNOME Terminal tab into its own window.
- Wayland + X11 support via a Clutter `VirtualInputDevice`.
- GNOME Shell 45+ variant (`extension.js`, ES modules).
- GNOME Shell 42 variant (`extension-gnome42.js`, classic imports).
- Configurable shortcut through GSettings schema.
- `install.sh` with GNOME Shell version auto-detection; `uninstall.sh` with clean teardown.
