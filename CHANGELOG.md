# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versioning is [SemVer](https://semver.org/).

## [1.0.0] — 2026-07-23

### Added
- Initial release.
- Global keyboard shortcut (default `Super+Shift+W`) to detach the active GNOME Terminal tab into its own window.
- Wayland + X11 support via a Clutter `VirtualInputDevice`.
- GNOME Shell 45+ variant (`extension.js`, ES modules).
- GNOME Shell 42 variant (`extension-gnome42.js`, classic imports).
- Configurable shortcut through GSettings schema.
- `install.sh` with GNOME Shell version auto-detection; `uninstall.sh` with clean teardown.
