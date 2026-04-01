# Changelog

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
