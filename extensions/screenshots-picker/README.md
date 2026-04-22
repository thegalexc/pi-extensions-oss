# screenshots-picker

Quickly browse, stage, and attach recent screenshots from inside Pi.

This extension is a port of [Graffioh/pi-screenshots-picker](https://github.com/Graffioh/pi-screenshots-picker) by Graffioh. The original project is MIT licensed. This port keeps the core interaction model and adapts it for the `pi-extensions-oss` package.

## Attribution

- Original project: `Graffioh/pi-screenshots-picker`
- Source: https://github.com/Graffioh/pi-screenshots-picker
- Author: Graffioh
- License: MIT

## What it does

- `/ss` opens an interactive screenshot picker
- `Ctrl+Shift+S` opens the picker directly
- `s` or `space` stages the current screenshot
- staged screenshots auto-attach to the next message you send
- `/ss-clear` or `Ctrl+Shift+X` clears staged screenshots

## Configuration

Configure sources in `~/.pi/agent/settings.json`:

```json
{
  "pi-screenshots": {
    "sources": [
      "~/Desktop",
      "~/Pictures/Screenshots",
      "/path/to/images/**/*.png"
    ]
  }
}
```

If no config is present, the extension auto-detects common screenshot locations on macOS and Linux.

## Notes

- plain directories are filtered to likely screenshot filenames such as macOS `Screenshot ...`, CleanShot `CleanShot 2026-04-17 at 14.27.29`, GNOME timestamped files, and common Linux screenshot tool prefixes
- glob patterns can match arbitrary image files, but `~/Desktop` is usually the cleaner default once CleanShot naming is recognized
- thumbnail previews work best in Kitty, Ghostty, WezTerm, and iTerm2
- inside Zellij, `/ss` automatically falls back to a text-only safe mode for paging, staging, opening, and deleting screenshots
- Zellij detection also checks the parent process tree, so the fallback still activates when Zellij does not export its usual environment variables
- if your environment hides both Zellij env vars and process ancestry, force text mode with `"pi-screenshots": { "forceTextMode": true }` in `~/.pi/agent/settings.json` or by launching Pi with `PI_SCREENSHOTS_FORCE_TEXT_MODE=1`
- the picker can also open or delete screenshots from disk
