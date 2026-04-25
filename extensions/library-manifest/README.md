# library-manifest

`library-manifest` adds a startup health check for repos that declare `.pi/library-manifest.yaml`.

It helps catch the common case where a repo expects library-managed prompts, skills, or reusable agents, but the current session starts without those installs present in `.agents/*` or `~/.agents/*`.

## What it does

- checks for `.pi/library-manifest.yaml` on `session_start`
- warns once, non-blockingly, when required artifacts are missing
- distinguishes repo-authored `.pi/*` collisions from healthy library installs
- adds `/library-check` for a detailed diagnostic report
- adds `/library-hydrate` to run the Library hydrate flow and reload Pi on success

## What it does not do

- it does not block session startup
- it does not auto-hydrate on startup
- it does not edit `.pi/*`
- it does not parse `library.yaml` transitively at startup

## Manifest shape

Supported v1 shape:

```yaml
required:
  - prompt:implement
  - skill:wrapup
  - agent:impeccable-reviewer
```

## Status rules

The extension checks these install surfaces:

- project-local `.agents/*`
- global `~/.agents/*`

It also reports repo-authored `.pi/*` same-name artifacts as collisions because those block normal Library hydration for the same name.

## Commands

| Command | Purpose |
| --- | --- |
| `/library-check` | Show installed, missing, collision, and manifest-error details |
| `/library-hydrate` | Run `python3 ~/.agents/skills/library/bin/library.py hydrate --project-root <cwd>` and reload on success |
