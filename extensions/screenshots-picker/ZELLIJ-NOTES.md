# Zellij investigation notes

Status: unresolved as of 2026-04-21.

## Symptom

Inside Zellij, `/ss` renders the initial screenshot list correctly. After the first navigation action, usually `Down`, the UI corrupts:

- list rows partially duplicate
- content shifts upward
- Pi layout breaks
- behavior reproduces even after disabling inline thumbnail rendering
- outside Zellij, the picker works normally

The issue was initially misattributed to Ghostty. Later testing showed the important variable was Zellij, not the outer terminal.

## Environments observed

- Plain Ghostty window: works
- Plain iTerm2 window: works
- Ghostty inside Zellij: broken
- iTerm2 inside Zellij: broken
- Small floating panes made the problem more obvious, but full-size single panes in Zellij also reproduced it on the MacBook

## Investigation timeline

### 1. Initial suspicion: Ghostty regression from v0.2.2

We first suspected the `v0.2.2` iTerm2 work caused a Ghostty regression.

Findings:

- Ghostty is detected by Pi TUI as `images: "kitty"`
- the dedicated iTerm2 path is not used in Ghostty
- this made Ghostty-specific breakage less likely

Conclusion:

- not enough evidence that the iTerm2 branch itself caused the bug

### 2. Attempt: force old fixed cell sizing for Kitty-family terminals

Patch idea:

- keep measured cell sizing only for iTerm2
- restore fixed `9x18` sizing for Kitty, Ghostty, WezTerm

Rationale:

- `v0.2.2` replaced fixed geometry assumptions with measured cell dimensions
- that seemed like a plausible source of terminal-specific drift

Result:

- not the root cause
- later reverted

Relevant commits:

- `0dd2f99` Fix Ghostty screenshots picker regression
- reverted by later work

### 3. Attempt: disable Kitty image delete escape sequences in Ghostty

Patch idea:

- stop emitting `deleteKittyImage(...)` under Ghostty

Rationale:

- speculative theory that Ghostty rendered Kitty images but mishandled Kitty image deletion

Result:

- also not the root cause
- later reverted

Relevant commits:

- `0e8d115` Avoid Ghostty Kitty image deletes in screenshots picker
- reverted by later work

### 4. Re-evaluation: issue is Zellij, not Ghostty

Further testing showed:

- plain Ghostty works outside Zellij
- plain iTerm2 works outside Zellij
- the common reproducer is Zellij

Conclusion:

- the real variable is the multiplexer layer

### 5. Diagnostic rollback to pre-v0.2.2 state

Patch idea:

- restore `screenshots-picker` code to pre-v0.2.2 state
- compare Zellij behavior against the earlier implementation

Result:

- still broken in Zellij
- this ruled out the v0.2.2 iTerm2 work as the primary cause

Relevant commit:

- `cf45a20` Temporarily restore pre-v0.2.2 screenshots picker

### 6. Restore best normal-terminal state

After the rollback still failed in Zellij, the picker was restored to the v0.2.2 implementation because it remained the best known state outside Zellij.

Relevant commit:

- `e25606c` Restore v0.2.2 screenshots picker state

### 7. Attempt: disable inline preview inside Zellij

Patch idea:

- keep the custom picker
- disable inline thumbnails and zoom when `ZELLIJ` is present

Rationale:

- suspected Pi TUI diff rendering of image blocks inside Zellij

Result:

- still broken
- this strongly suggests the problem is broader than image rendering alone

Relevant commit:

- `f2833da` Disable screenshots picker inline preview under Zellij

### 8. Attempt: non-custom Zellij safe mode

Patch idea:

- under `ZELLIJ`, bypass the custom live picker entirely
- use a simple text-input flow for stage, open, delete, clear

Rationale:

- if the custom live overlay was the issue, a simpler UI path might survive

Result:

- still reported broken
- no durable Zellij workaround was found in this session

Relevant commit:

- `e0b86c4` Add non-custom Zellij safe mode for screenshots picker

## Working conclusion

The evidence so far points away from `screenshots-picker` business logic and toward a broader incompatibility involving Pi interactive UI rendering under Zellij on this machine.

What we know:

- the bug reproduces on both Ghostty and iTerm2 when Zellij is in the middle
- the bug reproduces even after removing inline thumbnail rendering from the Zellij path
- the bug reproduces even after rolling back to pre-v0.2.2 picker code

Most likely explanations:

1. Pi TUI custom UI rendering and Zellij interact poorly on this machine
2. Pi UI input overlays inside Zellij are unstable independently of image rendering
3. there may be a machine-specific Zellij, font, scaling, or terminal capability interaction that does not reproduce on the desktop

## Recommended next steps

If this investigation is resumed later, start here:

1. Re-test on the current best-known outside-Zellij state
2. Compare MacBook vs desktop environment:
   - `zellij --version`
   - `echo $TERM $TERM_PROGRAM $COLORTERM $ZELLIJ`
   - font, DPI, and terminal settings
3. Try the smallest possible Pi custom UI reproducer under Zellij that does not involve screenshots at all
4. If the minimal reproducer still breaks, move the issue upstream toward Pi TUI or Pi UI rendering under Zellij
5. If only `/ss` breaks, instrument `screenshots-picker` more aggressively and compare the exact UI path being exercised

## Practical workaround for now

Use the text-only `/ss` safe mode inside Zellij. If detection misses your environment, force it with `"pi-screenshots": { "forceTextMode": true }` in `~/.pi/agent/settings.json`.

For the upstream watch list and criteria for removing the forced fallback later, see [`ZELLIJ-UPSTREAM-WATCH.md`](./ZELLIJ-UPSTREAM-WATCH.md).
