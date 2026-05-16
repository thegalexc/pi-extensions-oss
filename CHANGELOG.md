# Changelog

## 0.2.35

- add `lmstudio`, migrated from the private `pi-extensions` package, so multi-instance LM Studio provider discovery and remote load or unload now live on the OSS surface
- carry over the existing `~/.pi/agent/lmstudio-instances.json` config model and `lmstudio_control` tool so current users can update without changing their setup
- add the required `@lmstudio/sdk` runtime dependency and update the public package docs for the new extension

## 0.2.34

- add `project-context`, migrated from the private `pi-extensions` package, to load a small configurable set of high-value project files into Pi's system prompt at session start
- support the existing `.pi/context.yaml` override model so repos can replace, extend, or trim the default file set without per-project extension forks
- update public package docs and metadata so the generic context-loader now lives on the OSS surface where it belongs

## 0.2.33

- add `working-prompt-snippet`, a small extension that shows a scrubbed short preview of the current prompt in Pi's transient working message while the agent is busy
- redact common credential patterns and suppress the preview entirely for obviously sensitive prompts like `/login` so the convenience hint stays conservative by default
- document the new extension in the package README and update package metadata for rollout

## 0.2.32

- preserve distinct `pluck` checkpoints and tool findings even when they share the same visible text, instead of silently collapsing them during dedupe
- filter low-signal query stopwords and reduce generic-query bias toward `user_goal` chunks so vague searches surface better answers more reliably
- cap oversized tool findings and slightly downrank verbose raw tool output so it is less likely to crowd out concise assistant summaries

## 0.2.31

- fix `/pluck` ranking so structured assistant summaries like "Where you’re at" surface above later session chatter
- ignore assistant thinking blocks when extracting pluckable chunks so previews and classification reflect the visible answer
- add a regression test covering assistant messages that include both hidden thinking and a visible summary

## 0.2.30

- migrate extension imports and package metadata to the `@earendil-works/*` Pi package scopes for Pi 0.74 compatibility
- bump Pi dev pins to `^0.74.0` and align the compact update notice with the renamed upstream package entrypoint

## 0.2.29

- bump Pi development dependencies from `^0.70.0` to `^0.70.6` so local validation tracks the current Pi 0.70.x line more closely

## 0.2.28

- restore inline README demo GIFs for `pluck` and `session-notes` because GitHub README video linking proved worse than the normal inline GIF experience
- regenerate both README demo GIFs with the newer dual-output CleanShot workflow so the README gets smaller, more focused teaser loops instead of bulky long-form artifacts
- keep the richer MP4 output path for non-README surfaces while returning this repo to the GitHub-native inline demo pattern

## 0.2.27

- replace the README demo GIF embeds with poster images that link to GitHub-hosted MP4 assets so text-heavy demos keep much better quality at a much smaller size
- add committed poster PNGs for `pluck` and `session-notes` and remove the old repo-local demo GIFs
- standardize the README demo pattern around external MP4 assets rather than large in-repo GIF files

## 0.2.26

- rename `/session-context` to `/pluck` across the public extension package
- rename the extension folder, entrypoint files, docs, screenshot asset, and regression test path so the shipped surface and repo layout stay aligned
- update the package metadata and command copy to advertise `pluck` consistently

## 0.2.25

- fix `/session-context` so it no longer appears to hang when the focused browser overlay would otherwise be invisible
- add a narrow-terminal guard with a clear warning instead of dropping into a stuck-looking state
- remove the overlay visibility gate that could still open a hidden modal in pane-width mismatch cases

## 0.2.24

- add `compact-update-notice`, a tiny Pi extension that replaces the large boxed startup update notice with a compact footer chip
- format the chip as `* <version> Available` using the theme's `mdHeading` color so it matches Pi's softer yellow heading tone instead of the loud warning block
- compact package update warnings into the same footer status area and cover the behavior with a focused regression test

## 0.2.23

- add the public `session-context` extension, moved from the private `pi-extensions` package into this OSS package
- store it under `extensions/session-context/` so the folder name now matches the command and feature name instead of the old `session-info` carryover
- add the `session-context` regression test to the package test suite and refresh package metadata and docs

## 0.2.22

- add a jiti-backed `library-manifest` entrypoint smoke test so the package test suite covers the real extension entrypoint shape, not only helper modules
- add `jiti` as a dev dependency for Pi-runtime-like extension loading in tests

## 0.2.21

- declare the package as ESM with `"type": "module"` so Node test runs stop emitting `MODULE_TYPELESS_PACKAGE_JSON` warnings
- keep extension code and test commands unchanged while making the package metadata match the repo's actual module style

## 0.2.20

- make healthy `/library-check` output end with `Status: healthy` instead of always showing remediation steps
- keep the fix section only when the manifest check finds missing installs, collisions, legacy fallbacks, or manifest issues

## 0.2.19

- add `library-manifest`, a startup health-check extension for repos that declare `.pi/library-manifest.yaml`
- warn non-blockingly when required library-managed prompts, skills, or agents are missing from `.agents/*` or `~/.agents/*`
- add `/library-check` and `/library-hydrate` commands for explicit diagnostics and remediation from inside Pi
- report same-name repo-authored `.pi/*` artifacts as collisions instead of silently treating them as healthy library installs

## 0.2.18

- bump Pi development dependency pins to `^0.70.0` and refresh the lockfile for the current Pi line
- tighten `todo` extension typing so the package typechecks cleanly against the 0.70.x Pi line

## 0.2.17

- fix `agents-prompts-discover` packaging so Pi loads only the extension entrypoint and not the helper test file during package startup
- move the extension to `extensions/agents-prompts-discover/index.ts`, matching Pi's smart extension discovery rules

## 0.2.16

- add `agents-prompts-discover`, a lightweight extension that contributes project and global `.agents/prompts` directories through Pi `resources_discover`
- verify the extension works as an additive prompt bridge so repos can discover installed library prompts without adding new per-repo prompt-path settings by default
- keep the bridge read-only and discovery-only with no repo file mutation

## 0.2.10

- restore the best-known normal-terminal `screenshots-picker` behavior after the unsuccessful Zellij safe-mode experiments
- add `extensions/screenshots-picker/ZELLIJ-NOTES.md` with a detailed investigation summary, attempted fixes, observed behavior, and recommended next steps for future debugging

## 0.2.9

- screenshots-picker: replace the Zellij path with a non-custom safe mode that avoids Pi TUI live overlay rendering entirely while preserving stage, open, delete, clear, and attach workflows for the most recent screenshots

## 0.2.8

- screenshots-picker: disable inline thumbnail and zoom preview rendering under Zellij so `/ss` keeps list, stage, open, delete, and attach behavior without triggering Pi TUI layout corruption from diff-rendered image blocks inside the multiplexer

## 0.2.7

- restore the v0.2.2 `screenshots-picker` implementation after the temporary diagnostic rollback showed Zellij was also broken on the pre-v0.2.2 code path
- keep the current best-known state for plain terminal use while we investigate Zellij behavior separately
- the temporary rollback remains recoverable via local branch `backup/pre-zellij-upstream-revert-af01a65`

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
