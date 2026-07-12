# Turnstone runtime: local Ollama models in ADE

Date: 2026-07-11
Branch: `feature/turnstone-ollama-runtime` (based on `deploy`)
Status: approved, ready for planning

## Summary

Add **Turnstone** as a new `AgentRuntime` in ADE, alongside claude/codex/opencode, so
agents can run a coding session against a local Ollama model instead of a paid API.
Turnstone (`turnstonelabs/turnstone`) is a coding-agent CLI the user already has
installed and pointed at a homelab Ollama box — see `Desktop/ProxMox 2` on this
machine, a second Proxmox server dedicated to hosting LLMs, with CT100 running
Ollama with GPU passthrough.

## Context

- ADE orchestrates coding-agent CLIs the user already has installed — it doesn't
  bundle them or talk to model APIs directly (see root `CLAUDE.md`).
- Turnstone is exactly such a CLI: an "Interactive CLI for OpenAI-compatible models
  with tool calling" (its own `--help` text), i.e. it has a bash tool and file
  access like Claude Code/Codex/OpenCode, not just a chat REPL.
- **Turnstone must run inside WSL (Ubuntu), not native Windows** — verified by the
  user via direct debugging (native-Windows Python's `subprocess.Popen(["bash", ...])`
  can't resolve a POSIX bash + POSIX temp path the same way; full story in
  `Desktop/ProxMox 2/scripts/CLAUDE.md`). The venv lives at `~/turnstone-venv` inside
  WSL's native filesystem.
- The user's existing wrapper (`scripts/turnstone.sh`) invokes:
  ```
  ~/turnstone-venv/bin/turnstone --base-url http://192.168.1.41:11434/v1 \
    --provider openai --api-key ollama --model qwen3.6:latest
  ```
  CT100 (Ollama, GPU-backed) is reachable at `192.168.1.41:11434` on the LAN.
- Verified via `wsl.exe -d Ubuntu -- bash -lc '$HOME/turnstone-venv/bin/turnstone --help'`
  during this design's research (avoiding Git Bash's own tilde-mangling, a documented
  gotcha in the user's own `scripts/CLAUDE.md`):
  - `--reasoning-effort {none,minimal,low,medium,high,xhigh,max}` (default: medium)
  - `--skip-permissions` — auto-approve all tool calls, no confirmation prompts
  - `--provider {openai,anthropic}`, `--api-key` (default `$OPENAI_API_KEY` or a dummy
    value for local servers), `--base-url`, `--model`
  - No `--cwd`/`--dir` flag — Turnstone operates on the process's current directory.
- Verified via `wsl.exe --help`: **`wsl.exe --cd <Directory>` accepts either an
  absolute Windows path or an absolute Linux path directly** — no custom
  Windows→WSL path-translation helper is needed; `wsl.exe` does it itself.

## Goals

- A new "Turnstone" entry in the Runtime dropdown (New Agent modal), on equal footing
  with Claude/Codex/OpenCode: model/effort overrides, availability detection,
  install-hint messaging.
- Route only through **direct Ollama** (no OpenWebUI/API-key flow) for this pass.
- Make the Ollama host configurable per-agent (survives the LXC's IP changing),
  defaulting to the user's current homelab IP.

## Non-goals (this pass)

- OpenWebUI routing / API-key management (`turnstone-openwebui.sh`'s path) — can be
  added later the same way kimi/minimax/glm are gated behind a stored OpenRouter key.
- Live health-checking of the Ollama host or verifying a model is actually pulled —
  see "Error handling" below for why this is deliberately out of scope.
- Any change to the terminal/pty subsystem — see "Mechanism".

## Mechanism

Extend the existing "typed command string" pattern (`buildAgentLaunchCommands` in
`packages/shared/src/agent-command.ts`), the same mechanism that already lets
kimi/minimax/glm drive the `claude` binary against OpenRouter via env-var prefixes.
Turnstone's launch command is just a longer string:

```
wsl.exe -d Ubuntu --cd "<agent worktree path, Windows form>" -- \
  ~/turnstone-venv/bin/turnstone --base-url http://<host>/v1 --provider openai \
  --api-key ollama --model <model> --skip-permissions [--reasoning-effort <effort>]
```

This is still just text typed into the existing Windows shell pane — zero changes to
the Terminal Host Daemon or pty-spawning code.

**Rejected: spawn the pty directly inside WSL** (make the tab's own shell a WSL bash
session). Would touch shell-selection logic in the terminal-host daemon for identical
end-user behavior — no justification over the command-string approach.

**Rejected: a `.sh` launcher script file** written to disk by ADE, called by the
preset. No other runtime needs an intermediate script file; codex's multi-flag preset
and kimi/minimax/glm's multi-env-var prefix are already inline strings of comparable
complexity.

## Data model & config

- `AGENT_TYPES` (shared) / `AGENT_RUNTIMES` (local-db): add `"turnstone"`.
  `AGENT_LABELS.turnstone = "Turnstone"`.
- `AgentBinary` (shared/agent-binaries.ts): add `"turnstone"`. Its availability check
  is **not** `findRealBinary` (native-PATH `where.exe` lookup) — see "Availability
  detection" below.
- `workspaces` table (local-db): add a fourth per-agent override column, **`host`**
  (nullable text), alongside the existing `model` / `reasoning_effort` columns from
  the prior model/effort feature. New drizzle migration via `drizzle-kit generate`
  (never hand-edit `packages/local-db/drizzle/*`).
- Turnstone defaults (constants next to the new branch in `buildAgentLaunchCommands`):
  `host = "192.168.1.41:11434"`, `model = "qwen3.6:latest"` (matches the user's own
  documented reasoning: only thinking-capable models avoid a harmless startup
  warning, and `qwen3.6:latest` is confirmed thinking-capable). `--base-url` is built
  as `http://<host>/v1`. Reasoning-effort is omitted unless the user overrides it,
  letting Turnstone's own default (`medium`) apply.
- `REASONING_EFFORTS` (shared) extends from `["low","medium","high"]` to the full
  Turnstone vocabulary `["none","minimal","low","medium","high","xhigh","max"]` —
  additive/non-breaking; codex's UI still only ever offers its original 3 (see UI).
- Hardcoded, not user-facing: `--provider openai`, `--api-key ollama`, WSL distro
  `"Ubuntu"`, `--skip-permissions` always on (matches every other runtime's
  "danger mode: all permissions auto-approved" default).
- `createAgentInput` (create-agent-input.ts): add optional `host` (trim, empty →
  undefined, same shape as `model`), wired through `create-agent.ts`'s workspace
  insert the same way `model`/`reasoningEffort` already are.

## UI (New Agent modal)

- `RUNTIME_CHOICES` gains `"turnstone"`.
- **Effort field becomes runtime-driven, not codex-only.** New
  `RUNTIME_EFFORT_OPTIONS: Partial<Record<AgentType, readonly ReasoningEffort[]>>`
  (next to `buildAgentLaunchCommands`): `codex: ["low","medium","high"]`,
  `turnstone: ["none","minimal","low","medium","high","xhigh","max"]`. The modal
  shows the Effort select whenever `RUNTIME_EFFORT_OPTIONS[runtime]` exists,
  populated from that runtime's list.
- **New "Host" field**, its own row below Model/Effort, shown only when
  `runtime === "turnstone"`. Optional text input; placeholder shows the default
  (`192.168.1.41:11434`) imported from the same constant the command builder falls
  back to, so the placeholder can't drift from the real default.
- Model field placeholder becomes runtime-aware for turnstone too (`qwen3.6:latest`).
- `BINARY_INSTALL.turnstone`: `command` is a best-effort one-liner
  (`pip install turnstone`, assuming WSL/Ubuntu/venv already exist — the real
  first-time setup needs an interactive `sudo apt install` password prompt that
  can't be automated anyway); `note` states plainly that it must run inside WSL, not
  native Windows, and points at the Turnstone project rather than trying to cram the
  full multi-step setup into this dialog.
- No new component file — stays inline in `NewAgentModal.tsx` as another
  conditional block, consistent with how Model/Effort were added.

## Availability detection & error handling

Stays inside the existing `computeRuntimeAvailability()` (`config.ts`) rather than
adding new plumbing. `CHECKED_BINARIES` gains `"turnstone"`; that one entry branches
to a new `checkTurnstoneAvailable()` instead of `findRealBinary()`:

```
wsl.exe -d Ubuntu -- bash -lc "test -x ~/turnstone-venv/bin/turnstone"
```

Exit 0 = available. This single call collapses three failure modes into one boolean
that the existing "not installed" banner + install-hint UI already knows how to
render, with no new UI code:
- no WSL at all (also what happens on macOS/Linux — `execFileSync` throws ENOENT,
  no `process.platform` branch needed)
- WSL present but no Ubuntu distro
- Ubuntu present but the venv/turnstone binary missing

A cold WSL VM can take a couple seconds to start (vs. `where.exe`'s near-instant
native check), so this call gets an explicit `timeout: 5000` (bounds a
hung/corrupted WSL install) and leans on the existing 5s `AVAILABILITY_TTL_MS` cache
so the cost is paid once per cache window, not per keystroke.

**Deliberately not pre-flight-checked:** Ollama host reachability and whether the
requested model is actually pulled. No new health-check code, no polling, no
toasts. Every runtime's failure mode today is "the CLI prints an error into the
terminal pane" (a dead LAN host, wrong host override, or unpulled model all surface
as plain stderr text the moment the command runs) — Turnstone gets this for free by
staying consistent with that, the same way ADE never pre-validates an OpenRouter key
before spawning a kimi/minimax session either.

## Testing

- `buildAgentLaunchCommands`'s turnstone branch (packages/shared): unit tests for —
  no-overrides default (host/model/`--skip-permissions`, no `--reasoning-effort`),
  model override, host override, effort override, and that cwd flows through to
  `--cd`. Same style as the existing model/effort tests in `create-agent.test.ts`.
  Confirm during implementation whether `packages/shared` has a bun-test setup to
  add these to, or needs one.
- `createAgentInput` schema: extend the existing test file the same way `model`/
  `reasoningEffort` were tested — trim/empty→undefined for `host`, and confirm the
  effort enum now accepts all 7 turnstone values.
- `checkTurnstoneAvailable()`: **deliberately not unit-tested** — a two-line
  try/catch around a real `wsl.exe` shell-out, same shape (and same lack of a test)
  as the existing `findRealBinary`. Mocking `execFileSync` would test the mock, not
  reality.
- **The real proof is a live run-desktop pass**: build the app, launch with CDP,
  create a Turnstone agent through the New Agent modal, confirm the spawned pane
  runs the exact `wsl.exe -d Ubuntu --cd ... -- ~/turnstone-venv/bin/turnstone ...`
  command and gets a real response from the Ollama box. Nothing in CI can exercise
  WSL+Ollama, so this is the actual acceptance test, not a supplement to unit tests.

## Verification items for the implementation plan

Things asserted here from CLI `--help` output / documented behavior, not yet proven
end-to-end through ADE's own terminal pane — call these out explicitly during
planning/execution rather than assuming they'll just work:

1. Does `~/turnstone-venv/bin/turnstone` resolve correctly when the whole command is
   *typed into a native Windows shell pane* (cmd.exe/PowerShell, via ADE's terminal
   write mechanism) rather than pre-parsed by Git Bash? (The design assumes yes —
   there's no intermediate POSIX shell mangling the string in that path, unlike the
   Git-Bash-specific tilde-mangling gotcha hit during this design's own research —
   but it hasn't been observed through ADE's actual terminal pane yet.)
2. Does `wsl.exe --cd <Windows path>` correctly land Turnstone's bash tool in a
   writable view of the agent's worktree (i.e. `/mnt/c/...` access working as
   expected for that specific worktree path under `~/.ade/agents/<id>/worktree`)?
