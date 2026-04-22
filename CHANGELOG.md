# Changelog

## 0.2.6

- temporary diagnostic rollback: restore `screenshots-picker` code and related docs to the pre-v0.2.2 state so Zellij behavior can be compared against the last known upstream implementation before the iTerm2 preview work
- reversible backup branch created locally as `backup/pre-zellij-upstream-revert-af01a65`

## 0.2.5

- screenshots-picker: revert the Ghostty-specific follow-up experiments from v0.2.3 and v0.2.4 after testing showed the main remaining issue was stretched thumbnails, not broken delete handling
- screenshots-picker: restore measured cell sizing and standard Kitty delete behavior while we investigate small-pane Ghostty behavior separately

## 0.2.4

- screenshots-picker: stop sending Kitty image deletion escape sequences in Ghostty, which reports Kitty image support but can break the `/ss` UI when delete commands are emitted between preview frames

## 0.2.3

- screenshots-picker: restore fixed 9x18 preview sizing for Kitty-family terminals (Kitty, Ghostty, WezTerm) while keeping measured cell sizing only for the new iTerm2 preview path
- screenshots-picker: fix Ghostty regression introduced by the v0.2.2 shared sizing refactor

## 0.2.2

- screenshots-picker: add a protocol-aware iTerm2 preview path instead of relying on Kitty image deletion semantics
- screenshots-picker: use measured terminal cell dimensions for preview sizing instead of hardcoded 9x18 assumptions
- screenshots-picker: keep Kitty inspector behavior unchanged while making iTerm2 preview rendering more stable

## 0.2.1

- screenshots-picker: add delete feedback notification after single-file removal
- screenshots-picker docs: clarify `~/.pi/agent/settings.json` config path, add CleanShot filename recognition, and recommend `~/Desktop` as the clean default source

## 0.2.0

- add `browser-screenshot`, a self-contained Playwright-backed `screenshot` tool for webpage capture and visual QA
- fold the old `safe-screenshot` behavior into the new screenshot extension so installs are safe by default
- add `playwright` and `@mariozechner/pi-agent-core` to the package dependencies needed for the new tool
- remove the standalone `safe-screenshot` extension in favor of the integrated browser screenshot surface

## 0.1.28

- add `screenshots-picker`, a port of `Graffioh/pi-screenshots-picker`, for browsing, staging, and auto-attaching screenshots from inside Pi
- add package-level and extension-level attribution back to the original project and author
- add `glob` dependency for multi-source screenshot pattern matching

## 0.1.27

- new `aside` extension: token-efficient side-question overlay for Pi
- tool-free, single-shot aside flow with bounded current-session context only
- editor-first promotion flow that does not write to the main transcript by default
- extension-scoped README documenting workflow, access model, and non-goals

## 0.1.26

- bump Pi development dependency pins to `^0.67.6` to align with the current 0.67.x Pi line
- bump `@sinclair/typebox` to `^0.34.48` for local alignment with current Pi-adjacent packages

## 0.1.23

- add package-level `status.ts` extension that shows `oss v<version>` in Pi's footer status area
- align the OSS package with the clearer dedicated status-module pattern now used in Forge

## 0.1.22

- new `todo` extension adapted from Pi's upstream `examples/extensions/todo.ts`
- add branch-aware session todo tool with custom rendering and interactive `/todo` viewer
- use the obvious `/todo` command for the user-facing viewer

## 0.1.21

- update development dependencies to `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui` `^0.66.0`
- session-notes: migrate session lifecycle handling from removed `session_switch` and `session_fork` events to `session_start`
- safe-screenshot: clear clamped tool-call state on `session_start` instead of removed `session_switch`
- validate compatibility with pi 0.66.0

## 0.1.20

- safe-screenshot: add height guard for `fullPage: false` + oversized height (was passing through unprotected)
- safe-screenshot: fix string height coercion -- `input.height = "9000"` no longer bypasses the clamp
- safe-screenshot: note text now reports the actual effective height instead of always saying 900px
- safe-screenshot: switch from Set to Map to carry effective height through to the result annotation
- safe-screenshot: clear clamped Map on session lifecycle events (session_end, session_switch, session_tree) to prevent orphaned entries

## 0.1.19

- new safe-screenshot extension: intercepts full-page screenshots to prevent exceeding Claude's 8000px image height limit
- clamps fullPage captures to viewport-only mode (900px default) and annotates tool results with guidance

## 0.1.11

- custom colored picker rows for session-notes
- terminal-safe glyphs and fixed-width timeline prefix alignment
- refined picker spacing and help text
- user and agent notes visually differentiated
- session-local note IDs with chronological interleaving

## 0.1.0

- initial public package bootstrap
