# pi-extensions-oss

Open-source Pi extension repo for GalexC.

## Conventions

- Gilman is the owner. Treat as a senior peer.
- Use pnpm for package management.
- Keep a `.mise.toml` at repo root.
- Run `pnpm run typecheck` before commits.
- Bump `package.json` version on every PR so `pi update` picks it up.
- Prefer small, composable extensions with polished README docs and clear install instructions.
- Treat this repo as a product, not a scratchpad. Keep names, copy, and defaults clean and user-facing.
- Keep public extensions self-contained. Do not introduce repo-private dependencies unless they are also published here.
- Run `pi update` locally after publish-worthy changes when verifying install behavior.
- **Verify remotes before pushing.** `pi update` must be able to pull the published package from the repo's actual install remote. Do not assume remote names like `origin` or `forgejo` - check `git remote -v` in the current clone and push to the configured install remote(s).
- No em dashes in file output.
