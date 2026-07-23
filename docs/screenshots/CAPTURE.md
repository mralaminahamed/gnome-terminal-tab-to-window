# Capturing screenshots & the demo GIF

The images in this folder ship as **placeholders**. Replace them with real
captures, keeping the same filenames so the README and any
extensions.gnome.org listing pick them up automatically:

- `prefs.png` — the preferences dialog
- `demo.gif` — a short clip of a tab detaching

## `prefs.png` — preferences dialog

```bash
# Open the preferences window
gnome-extensions prefs terminal-tab-to-window@mralaminahamed.github.com
```

Then capture just that window:

- **GNOME (either session):** press `Alt`+`Print` to grab the focused window;
  the PNG lands in `~/Pictures/Screenshots/`. Or press `Print`, choose
  *Screenshot* → *Window*, and select the dialog.
- **Wayland via CLI:** `grim -g "$(slurp)" prefs.png` (needs `grim` + `slurp`).

Move/rename the result to `docs/screenshots/prefs.png`.

## `demo.gif` — tab detaching

1. Open GNOME Terminal with at least two tabs.
2. Start GNOME's built-in screencast: `Ctrl`+`Alt`+`Shift`+`R` (press again to
   stop). The `.webm` is saved to `~/Videos/Screencasts/`.
3. Press `Super`+`Shift`+`W` on camera, then stop the recording.
4. Convert the `.webm` to a clean, palette-optimised GIF with ffmpeg:

```bash
IN=~/Videos/Screencasts/your-recording.webm
ffmpeg -i "$IN" -vf "fps=12,scale=960:-1:flags=lanczos,palettegen" -y /tmp/pal.png
ffmpeg -i "$IN" -i /tmp/pal.png \
  -lavfi "fps=12,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse" \
  -y docs/screenshots/demo.gif
```

Keep the GIF under a few MB — trim to the essential few seconds and drop the
frame rate/scale if needed.

## Publishing to extensions.gnome.org

Screenshots are **not** part of the extension zip. After the extension is
approved, upload them on the extension's page at
<https://extensions.gnome.org/> (Edit → screenshots).
