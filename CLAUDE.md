# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The monorepo structure, tech stack, common commands, code-quality/Biome setup, component layout, and database/migration rules live in **AGENTS.md** — read it first:

@AGENTS.md

The sections below add what AGENTS.md doesn't: what this repo actually is, the desktop app's architecture, and the native-module build reality (which bites hard on Windows).

## What this repo is

This is **ADE** — a local-first, single-user Electron desktop app for running a roster of persistent coding agents (a fork/derivative of Superset). The shipped product is `apps/desktop` (`@ade/desktop`); the other apps and `packages/*` are shared Superset infrastructure. Read `README.md` for the product model (Teams → Agents → terminal Sessions, agent memory files, external CLI runtimes). ADE orchestrates coding CLIs you already have installed (Claude Code, Codex, OpenCode) — it does not bundle them.

Almost all work happens in `apps/desktop`. `apps/desktop/AGENTS.md` has desktop-specific rules — most importantly: **all main↔renderer IPC goes through tRPC (`src/lib/trpc`), and `trpc-electron` subscriptions must use the `observable` pattern, not async generators.**

## Desktop architecture (apps/desktop)

Electron app built by **electron-vite** into three bundles under `dist/`: `main/` (Node main process, entry `src/main/index.ts`), `preload/`, and `renderer/` (React 19 + TanStack Router; routes are code-generated via `tsr generate`, run automatically before typecheck). Key main-process subsystems (`src/main/lib/`):

- **Terminal Host Daemon** (`src/main/terminal-host/` = server, `src/main/lib/terminal-host/client.ts` = client). A *detached* background process that owns the PTYs (node-pty) so terminal sessions survive app restarts and updates. The main process spawns it via `ELECTRON_RUN_AS_NODE` and talks to it over a local socket — a **Unix domain socket on macOS/Linux, a named pipe on Windows** (they have no filesystem entry, so liveness is probed by connecting, not `existsSync`). Daemon output goes to `~/.ade/daemon.log` — the first place to look when terminals won't start.
- **Local DB** (`packages/local-db`, better-sqlite3 + Drizzle) at `~/.ade/local.db`. Migrations run at boot from `dist/resources/migrations`.
- **App state** (`src/main/lib/app-state`) — `~/.ade/app-state.json` via lowdb, watched for peer edits (Syncthing sync across machines).
- **Agent lifecycle** — each agent gets its own git worktree (`agent-worktree.ts`, `agent-repo.ts`) and a memory surface (`AGENT.md`/`USER.md`/`MEMORY.md`/skills) scaffolded outside the worktree. `agent-setup/` installs hooks and shell wrappers for every supported CLI (claude/codex/opencode/cursor/gemini/copilot/…) on launch.

All per-user data lives under `~/.ade/` (the `SUPERSET_HOME_DIR`; overridable for multi-worktree setups via `shared/constants`).

## Building & running the desktop app

From `apps/desktop`:

```bash
bun run compile:app     # electron-vite build → dist/ (full production build)
bunx electron .         # launch the built app
SKIP_ENV_VALIDATION=1 bun run dev   # watch-mode dev, skips env validation + sign-in
bun run typecheck       # tsr generate + tsc --noEmit
bun test                # bun test (a single file: bun test path/to/file.test.ts)
```

Do **not** use `electron-vite preview` for a full run — it can exhaust memory. `compile:app` + `bunx electron .` is the real path.

## Native modules (read before debugging install/launch)

The app has native deps, but only **better-sqlite3** is NAN-based and needs a per-Electron-ABI rebuild — the rest (**node-pty, bufferutil, utf-8-validate**, libsql, @ast-grep/napi) are N-API and their prebuilds already work on Electron. A NODE_MODULE_VERSION mismatch at launch (e.g. "compiled against … 137 … requires 143") means better-sqlite3 wasn't rebuilt for Electron.

`bun install` runs `scripts/postinstall.ts` (bun runs it natively on every OS; do not reintroduce a `.sh` here — bun can't exec `.sh` on Windows). It runs `sherif` then `bun run --filter=@ade/desktop install:deps` (`electron-builder install-app-deps`, which rebuilds native modules for Electron from source); if that fails on a machine without a C++ toolchain, it falls back to fetching better-sqlite3's Electron prebuilt so the app still runs.

Compiling native modules **from source** needs a C++ toolchain: Xcode (macOS), gcc (Linux), or on **Windows**, VS Build Tools with two easy-to-miss pieces — node-gyp new enough to recognize the installed VS (the repo pins `node-gyp` via `overrides` in the root `package.json`), and the **"Spectre-mitigated libraries" (`VC.Runtimes.x86.x64.Spectre`)** component, which `node-pty` requires or MSBuild fails with `MSB8040`. Without these, the N-API prebuilds still work — only from-source compilation is blocked.

### Native-module dev workflow

- **Kill the running app before rebuilding native modules** — a live app locks the `.node` file so the rebuild silently fails to overwrite it: `taskkill //F //IM electron.exe //T` (Windows) / `pkill -f electron` (macOS/Linux).
- **Check a native module against Electron's ABI without launching the GUI:** `ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron probe.cjs` where `probe.cjs` does `require('better-sqlite3')` in a try/catch — a `NODE_MODULE_VERSION` throw means it's still built for Node, not Electron.
- **`SUPERSET_POSTINSTALL_RUNNING=1 bun install`** skips the slow native rebuild (iterate on `package.json`/lockfile fast). A `node-gyp`/`overrides` change needs **`bun install --force`** to actually relink already-installed nested deps.
- `compile:app` writes to `apps/desktop/dist/`; the build log's `../../dist/renderer/` paths are display-relative, not the real output location.
