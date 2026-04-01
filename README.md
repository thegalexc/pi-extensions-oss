# Pi Extensions - GalexC

Productivity and resilience extensions for the [Pi coding agent](https://pi.ai).

`session-notes` keeps important context visible above the editor without spending context tokens. `safe-screenshot` prevents session crashes from oversized full-page captures.

## Extensions

| Extension | What it does |
|---|---|
| [`session-notes`](#session-notes) | Zero-token session scratchpad with persistent panel and interleaved timeline |
| [`safe-screenshot`](#safe-screenshot) | Prevents session crashes from oversized full-page screenshots |

---

## session-notes

`session-notes` adds a persistent notes panel and an interleaved timeline picker for session notes and assistant messages.

It is built for the moment when a session is going well, useful snippets are flying by, and you want to keep a few things pinned in view without copying them back into the prompt.

### Demo

#### Looping teaser

![Session Notes demo](public/session-notes-demo.gif)

#### Persistent panel

![Session Notes panel screenshot](public/session-notes-panel-screenshot.png)

#### Timeline picker

![Session Notes timeline screenshot](public/session-notes-screenshot.png)

### Highlights

- persistent notes panel above the editor
- zero-token workflow for keeping notes visible
- interleaved picker that mixes your notes with assistant messages in one timeline
- direct note editing and quick pinning from the picker
- user and agent notes visually differentiated
- append-only note history where entries are never deleted
- branch, fork, tree, and reload aware state reconstruction
- keyboard-first controls with no external editor required

### What it is good for

- adding simple session objective reminders
- keeping a short plan visible while you continue coding
- pinning a useful assistant response before the conversation moves on
- jotting down a quick human note for later in the same session
- comparing your notes against recent assistant messages in chronological order
- keeping transient context out of the actual prompt

### Controls

| Action | Shortcut / Command |
| --- | --- |
| Open timeline picker | `Ctrl+Alt+K` or `/session-notes` |
| Edit active note | `Ctrl+Alt+E` |
| Hide or show panel | `Ctrl+Alt+H` |
| Clear active note content | `Ctrl+Alt+X` |
| Scroll up | `Ctrl+Alt+U` or `Ctrl+Alt+Up` |
| Scroll down | `Ctrl+Alt+D` or `Ctrl+Alt+Down` |
| Expand panel height | `Ctrl+Alt+=` |
| Contract panel height | `Ctrl+Alt+-` |

### Interaction model

- **Blank notes** are user-authored notes you type directly.
- **Pinned timeline items** are assistant messages captured into the note log.
- **Entries are append-only.** You can clear content, but the entry itself stays in history.
- **IDs are session-local.** A fresh session starts at note 1 again.
- **Ordering is chronological.** The picker interleaves notes and assistant messages by session timing.

---

## safe-screenshot

`safe-screenshot` intercepts the built-in `screenshot` tool and prevents sessions from crashing when a full-page capture would exceed Claude's 8000px image height limit.

The extension is transparent - you call `screenshot` exactly as before. When `fullPage` is not explicitly `false`, the extension clamps the capture to viewport-only mode and appends a note to the result explaining what happened and how to capture a specific section.

### Highlights

- zero config, works globally across all projects
- no change to how you call `screenshot`
- safe threshold: 7500px (500px headroom under Claude's hard limit)
- viewport default: 900px tall
- result note tells the agent what was clamped and how to re-request sections

### Behavior

| Condition | Behavior |
|---|---|
| `fullPage: false` explicitly set | passes through unchanged |
| `fullPage` unset or `true` | clamped to `fullPage: false`, height 900px; result includes a note |

> **Note:** The extension cannot probe actual page height before capture (Playwright is not exposed to the extension API). It conservatively clamps all full-page requests. To capture a tall page in sections, call `screenshot` with `fullPage: false` and explicit `height`, or use URL `#anchor` navigation.

---

## Install

```bash
pi install git:github.com/thegalexc/pi-extensions-oss
```

After installation, restart Pi or run `/reload` in an active session.

## Update

```bash
pi update
```

## Development

```bash
pnpm install
pnpm run typecheck
```

## Compatibility notes

`session-notes` is designed for interactive Pi sessions with the TUI enabled.

The extension leans into terminal-safe rendering choices:

- custom picker rows for reliable alignment
- keyboard-native interaction
- theme-aware coloring using Pi theme tokens
- glyph choices that behave well in common terminal fonts

## Repo layout

```text
pi-extensions-oss/
├── extensions/
│   ├── session-notes.ts
│   └── safe-screenshot.ts
├── package.json
├── tsconfig.json
├── CLAUDE.md
└── README.md
```

## License

MIT
