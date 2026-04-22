# Zellij screenshots lab

Use `/ss-zellij-lab` to isolate which rendering primitive breaks inside Zellij.

The lab always loads the most recent screenshot it can find from the same screenshot sources used by `screenshots-picker`.

## Commands

- `/ss-zellij-lab` opens the interactive lab
- `/ss-zellij-report` inserts a small terminal capability report into the editor

## Lab modes

### 1. baseline text-only

No inline image rendering at all.

If this mode breaks, the issue is broader than screenshots or image protocols.

### 2. Image component

Uses Pi TUI's `Image.render()` path.

This is the closest approximation of the current `screenshots-picker` preview branch.

### 3. manual inline sequence

Bypasses the `Image` component and manually emits Kitty or iTerm2 inline image sequences with the same blank-lines plus cursor-up placement strategy.

If mode 2 breaks but mode 3 does not, the `Image` component path adds some extra behavior worth inspecting.

If both 2 and 3 break, the problem is more likely the protocol path or cursor-up placement pattern itself.

### 4. cursor-up marker

No image protocol. Just blank lines plus cursor-up and a text marker.

If this breaks, cursor movement and row reservation are enough to trigger corruption.

If this is stable while 2 and 3 break, the image protocol path is the main fault line.

## Keys

- `1` baseline text-only
- `2` Image component
- `3` manual inline sequence
- `4` cursor-up marker
- `r` trigger another render tick
- `d` send Kitty image delete for the fixed image ID when Kitty mode is active
- `esc` close

## Suggested matrix

Run the lab in these environments:

1. raw Ghostty
2. Ghostty inside Zellij
3. raw iTerm2
4. iTerm2 inside Zellij
5. raw Terminal.app
6. Terminal.app inside Zellij

Then compare which mode first breaks.

## Likely interpretations

- only mode 2 breaks: Pi TUI `Image` wrapper behavior matters
- modes 2 and 3 break, mode 4 stable: inline image protocol path is the issue
- modes 2, 3, and 4 break: cursor-up row reservation or redraw semantics are suspect
- all modes stable except full `screenshots-picker`: the remaining bug is in picker-specific redraw logic
