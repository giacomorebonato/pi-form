# pi-form

pi extension: agent-authored browser forms with Zod validation.

## Tooling

- **Bun is the package manager** for this project.
  - `bun install` / `bun run test` / `bun add <pkg>`
  - `bun.lock` is the lockfile; **do not use or regenerate npm `package-lock.json`** (removed 2026-11-10).
- Tests: `bun run test` (vitest run).

## Dependency pin

- `package.json` → `overrides.tldts = "7.4.19"`.
- Reason: `tldts@7.4.21` was released depending on `tldts-core@^7.4.21`, which was never published to the registry (upstream break; reached via `jsdom` → `tough-cookie@^6.0.2` → `tldts@^7.0.5`). `7.4.19` is the latest version whose dep graph resolves.
- Remove this override once `tldts`/`tldts-core` are released in sync; verify with `bun install` after deleting the override.
