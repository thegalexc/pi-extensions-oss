# Zellij upstream watch list for screenshots-picker

Status: temporary text-only fallback is enabled for Zellij-first workflows.

## Why this exists

`/ss` works normally in raw Ghostty and raw iTerm2.

Inside Zellij, the image-capable path has been unreliable:

- raw Ghostty: works
- raw iTerm2: works
- raw Terminal.app: stable layout, no thumbnails, expected fallback
- Ghostty inside Zellij: layout corruption with inline preview path
- iTerm2 inside Zellij: layout corruption with inline preview path
- Terminal.app inside Zellij: stable layout, no thumbnails, expected fallback

That points to the inline image path under Zellij rather than the screenshot list itself.

## Current local mitigation

We now support a text-only safe mode for `/ss`.

This can be activated automatically by Zellij detection, or forced explicitly with:

```json
{
  "pi-screenshots": {
    "forceTextMode": true
  }
}
```

In this setup, `~/.dotfiles/pi/agent/settings.json` currently sets `forceTextMode: true` so the picker remains usable in day-to-day Zellij sessions.

## Upstream issues to watch

### 1. Zellij Kitty graphics protocol support

Issue:
- https://github.com/zellij-org/zellij/issues/2814
- Title: `[Feature Request] - Implement kittys terminal graphics protocol`

Why it matters:
- Ghostty is treated as a Kitty-graphics terminal by Pi TUI.
- If Zellij gains robust Kitty graphics passthrough support, Ghostty-inside-Zellij may become viable for thumbnails again.

### 2. Zellij support for image previews in Ghostty workflows

Issue:
- https://github.com/zellij-org/zellij/issues/4336
- Title: `Support for yazi's image preview`

Why it matters:
- This is one of the closest public reports to our own failure mode.
- It explicitly describes image preview working in Ghostty and failing once inside Zellij.

### 3. Zellij support for Kitty / icat image protocols

Issue:
- https://github.com/zellij-org/zellij/issues/4724
- Title: `support for image protocols such as kitty icat for fastfetch`

Why it matters:
- More evidence that modern terminal image protocols are still an active compatibility area in Zellij.

### 4. Kitty graphics passthrough PR

PR:
- https://github.com/zellij-org/zellij/pull/4851
- Title: `feat: add Kitty graphics protocol passthrough`

Why it matters:
- This is the most promising upstream breadcrumb.
- The PR describes a passthrough approach rather than app-specific rendering hacks.
- If this lands or is superseded by another merged implementation, we should retest `/ss` immediately.

### 5. Escape sequence corruption / leakage under Zellij

Issues:
- https://github.com/zellij-org/zellij/issues/1716
- https://github.com/zellij-org/zellij/issues/4453

Why they matter:
- These are not screenshot-picker issues directly.
- They do show that Zellij has had real problems around complex escape sequence handling, which makes our inline image suspicions more credible.

## What should trigger a retest

Retest `/ss` inside Zellij when any of these happen:

1. Zellij merges Kitty graphics passthrough or equivalent protocol support.
2. Zellij release notes mention Kitty graphics, image preview, Ghostty image compatibility, iTerm2 image compatibility, passthrough, or escape sequence fixes.
3. Pi TUI changes its image rendering model to be safer under multiplexers.
4. We switch to a different `/ss` preview strategy that no longer relies on the current inline image placement behavior.

## Retest checklist

When upstream changes land, verify all of these again:

1. raw Ghostty
2. Ghostty inside Zellij
3. raw iTerm2
4. iTerm2 inside Zellij
5. raw Terminal.app
6. Terminal.app inside Zellij

For each environment, check:

- does `/ss` open cleanly?
- do thumbnails render?
- does the first navigation action keep the layout stable?
- do staging multiple screenshots and paging still work?
- do delete and open commands still behave correctly?

## Conditions for removing `forceTextMode`

We should remove the forced text mode only after all of the following are true:

1. `/ss` works reliably in Ghostty inside Zellij.
2. `/ss` works reliably in iTerm2 inside Zellij.
3. The first navigation action no longer corrupts layout.
4. Multi-select staging remains stable across multiple pages.
5. We can run for a few real sessions without regressions.

At that point:

1. remove `"forceTextMode": true` from `~/.dotfiles/pi/agent/settings.json`
2. reload Pi
3. confirm the rich picker path works in normal Zellij sessions
4. keep this file around as historical context unless it becomes obviously obsolete

## Local notes worth remembering

- Some Pi sessions did not expose `ZELLIJ` or `ZELLIJ_SESSION_NAME` in env.
- In at least one unsafe session, the process ancestry looked like:

```text
bash -> pi -> zsh -> zellij
```

- That means environment-only detection is not always enough.
- Process-tree detection can help, but some harnesses also block `ps`, so the forced settings override remains the most reliable day-to-day switch.
