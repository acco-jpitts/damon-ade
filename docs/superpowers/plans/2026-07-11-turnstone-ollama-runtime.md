# Turnstone Runtime (Local Ollama via WSL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Turnstone" as a new `AgentRuntime` in ADE so agents can run a coding
session against a local Ollama model (via the user's existing Turnstone CLI setup
inside WSL) with the same New Agent modal experience as Claude/Codex/OpenCode.

**Architecture:** Extend the existing "typed command string" launch pattern
(`buildAgentLaunchCommands` in `packages/shared/src/agent-command.ts`) with a new
branch that wraps the command through `wsl.exe`, plus a fourth per-agent override
column (`host`) alongside the existing `model`/`reasoningEffort` columns. No changes
to the terminal/pty subsystem.

**Tech Stack:** TypeScript, Drizzle ORM (SQLite, `packages/local-db`), tRPC, React
19, Zod, bun:test.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-11-turnstone-ollama-runtime-design.md`
  (read it if anything here is ambiguous — this plan implements it exactly).
- Never manually edit generated Drizzle files (`packages/local-db/drizzle/*`) —
  always run `bun run generate` from `packages/local-db`.
- `--provider openai`, `--api-key ollama`, WSL distro `"Ubuntu"`, and
  `--skip-permissions` are hardcoded, not user-facing (per spec).
- Default Turnstone host: `192.168.1.41:11434`. Default model: `qwen3.6:latest`.
- No live health-checking of the Ollama host or model-pulled state — failures
  surface as plain terminal output, same as every other runtime (per spec,
  "Availability detection & error handling").
- Run `bun run typecheck` in every touched package/app before committing a task.

---

### Task 1: Register Turnstone as a known runtime + expand reasoning-effort vocabulary

**Files:**
- Modify: `packages/shared/src/agent-command.ts`
- Modify: `packages/shared/src/agent-command.test.ts`
- Modify: `packages/shared/src/agent-binaries.ts`
- Modify: `packages/local-db/src/schema/zod.ts`

**Interfaces:**
- Produces: `AgentType` now includes `"turnstone"`. `REASONING_EFFORTS` (both
  copies) is now `["none","minimal","low","medium","high","xhigh","max"] as const`.
  `AgentBinary` now includes `"turnstone"`. `CHECKED_BINARIES` now includes
  `"turnstone"`. Later tasks depend on all of these existing.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/agent-command.test.ts` (add the import at the top
alongside the existing one):

```typescript
import { describe, expect, it } from "bun:test";
import {
	AGENT_PRESET_COMMANDS,
	buildAgentPromptCommand,
	REASONING_EFFORTS,
} from "./agent-command";
```

Add this new `describe` block at the end of the file:

```typescript
describe("turnstone runtime registration", () => {
	it("has a default preset command wrapped through WSL", () => {
		const [command] = AGENT_PRESET_COMMANDS.turnstone;
		expect(command).toContain("wsl.exe -d Ubuntu --");
		expect(command).toContain("turnstone-venv/bin/turnstone");
		expect(command).toContain("--skip-permissions");
	});

	it("extends REASONING_EFFORTS with turnstone's full vocabulary", () => {
		expect(REASONING_EFFORTS).toEqual([
			"none",
			"minimal",
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
		]);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/shared && bun test agent-command.test.ts`
Expected: FAIL — `AGENT_PRESET_COMMANDS.turnstone` is `undefined` (TypeScript
compile error at the top of the file, since `"turnstone"` isn't a valid `AgentType`
key yet), and `REASONING_EFFORTS` doesn't yet equal the 7-value array.

- [ ] **Step 3: Add `turnstone` to `AGENT_TYPES`, `AGENT_LABELS`, and the default-host/model constants**

In `packages/shared/src/agent-command.ts`, change:

```typescript
export const AGENT_TYPES = [
	"claude",
	"codex",
	"gemini",
	"opencode",
	"copilot",
	"cursor-agent",
	"kimi",
	"minimax",
	"glm",
] as const;

export type AgentType = (typeof AGENT_TYPES)[number];

export const AGENT_LABELS: Record<AgentType, string> = {
	claude: "Claude",
	codex: "Codex",
	gemini: "Gemini",
	opencode: "OpenCode",
	copilot: "Copilot",
	"cursor-agent": "Cursor Agent",
	kimi: "Kimi K2.7",
	minimax: "MiniMax M3",
	glm: "GLM 5.2",
};
```

to:

```typescript
export const AGENT_TYPES = [
	"claude",
	"codex",
	"gemini",
	"opencode",
	"copilot",
	"cursor-agent",
	"kimi",
	"minimax",
	"glm",
	"turnstone",
] as const;

export type AgentType = (typeof AGENT_TYPES)[number];

/**
 * Turnstone (turnstonelabs/turnstone) drives local Ollama models. It must run
 * inside WSL, not native Windows — its bash tool needs a real POSIX
 * environment (verified by hand; see the design spec). These are the fixed
 * defaults from the user's own working wrapper script; overridable per-agent
 * via the `host`/`model`/`reasoningEffort` workspace columns.
 */
const TURNSTONE_WSL_DISTRO = "Ubuntu";
const TURNSTONE_DEFAULT_HOST = "192.168.1.41:11434";
const TURNSTONE_DEFAULT_MODEL = "qwen3.6:latest";

export const AGENT_LABELS: Record<AgentType, string> = {
	claude: "Claude",
	codex: "Codex",
	gemini: "Gemini",
	opencode: "OpenCode",
	copilot: "Copilot",
	"cursor-agent": "Cursor Agent",
	kimi: "Kimi K2.7",
	minimax: "MiniMax M3",
	glm: "GLM 5.2",
	turnstone: "Turnstone",
};
```

- [ ] **Step 4: Add the `turnstone` entries to `AGENT_PRESET_COMMANDS` and `AGENT_PRESET_DESCRIPTIONS`, and expand `REASONING_EFFORTS`**

Change:

```typescript
export const AGENT_PRESET_COMMANDS: Record<AgentType, string[]> = {
	claude: ["claude --dangerously-skip-permissions"],
	codex: [
		'codex --model gpt-5.5 -c model_reasoning_effort="high" --ask-for-approval never --sandbox danger-full-access -c model_reasoning_summary="detailed" -c model_supports_reasoning_summaries=true',
	],
	gemini: ["gemini --yolo"],
	opencode: ["opencode"],
	copilot: ["copilot --allow-all"],
	"cursor-agent": ["cursor-agent"],
	kimi: ['ANTHROPIC_BASE_URL="https://openrouter.ai/api" ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY" ANTHROPIC_API_KEY="" claude --model moonshotai/kimi-k2.7-code --dangerously-skip-permissions'],
	minimax: ['ANTHROPIC_BASE_URL="https://openrouter.ai/api" ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY" ANTHROPIC_API_KEY="" claude --model minimax/minimax-m3 --dangerously-skip-permissions'],
	glm: ['ANTHROPIC_BASE_URL="https://openrouter.ai/api" ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY" ANTHROPIC_API_KEY="" claude --model z-ai/glm-5.2 --dangerously-skip-permissions'],
};

export const AGENT_PRESET_DESCRIPTIONS: Record<AgentType, string> = {
	claude: "Danger mode: All permissions auto-approved",
	codex: "Danger mode: All permissions auto-approved",
	gemini: "Danger mode: All permissions auto-approved",
	opencode: "OpenCode: Open-source AI coding agent",
	copilot: "Danger mode: All permissions auto-approved",
	"cursor-agent": "Cursor AI agent for terminal-based coding assistance",
	kimi: "Kimi K2.7 via Claude Code + OpenRouter",
	minimax: "MiniMax M3 via Claude Code + OpenRouter",
	glm: "GLM 5.2 via Claude Code + OpenRouter",
};
```

to:

```typescript
export const AGENT_PRESET_COMMANDS: Record<AgentType, string[]> = {
	claude: ["claude --dangerously-skip-permissions"],
	codex: [
		'codex --model gpt-5.5 -c model_reasoning_effort="high" --ask-for-approval never --sandbox danger-full-access -c model_reasoning_summary="detailed" -c model_supports_reasoning_summaries=true',
	],
	gemini: ["gemini --yolo"],
	opencode: ["opencode"],
	copilot: ["copilot --allow-all"],
	"cursor-agent": ["cursor-agent"],
	kimi: ['ANTHROPIC_BASE_URL="https://openrouter.ai/api" ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY" ANTHROPIC_API_KEY="" claude --model moonshotai/kimi-k2.7-code --dangerously-skip-permissions'],
	minimax: ['ANTHROPIC_BASE_URL="https://openrouter.ai/api" ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY" ANTHROPIC_API_KEY="" claude --model minimax/minimax-m3 --dangerously-skip-permissions'],
	glm: ['ANTHROPIC_BASE_URL="https://openrouter.ai/api" ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY" ANTHROPIC_API_KEY="" claude --model z-ai/glm-5.2 --dangerously-skip-permissions'],
	turnstone: [
		`wsl.exe -d ${TURNSTONE_WSL_DISTRO} -- ~/turnstone-venv/bin/turnstone --base-url http://${TURNSTONE_DEFAULT_HOST}/v1 --provider openai --api-key ollama --model ${TURNSTONE_DEFAULT_MODEL} --skip-permissions`,
	],
};

export const AGENT_PRESET_DESCRIPTIONS: Record<AgentType, string> = {
	claude: "Danger mode: All permissions auto-approved",
	codex: "Danger mode: All permissions auto-approved",
	gemini: "Danger mode: All permissions auto-approved",
	opencode: "OpenCode: Open-source AI coding agent",
	copilot: "Danger mode: All permissions auto-approved",
	"cursor-agent": "Cursor AI agent for terminal-based coding assistance",
	kimi: "Kimi K2.7 via Claude Code + OpenRouter",
	minimax: "MiniMax M3 via Claude Code + OpenRouter",
	glm: "GLM 5.2 via Claude Code + OpenRouter",
	turnstone: "Turnstone: local Ollama models via WSL",
};
```

Change:

```typescript
export const REASONING_EFFORTS = ["low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
```

to:

```typescript
export const REASONING_EFFORTS = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/shared && bun test agent-command.test.ts`
Expected: PASS (all tests, including the two new ones and the pre-existing
`buildAgentPromptCommand` ones).

- [ ] **Step 6: Update `agent-binaries.ts` and its mirror in local-db, then run the full package test suites**

In `packages/shared/src/agent-binaries.ts`, change:

```typescript
export type AgentBinary = "claude" | "codex" | "opencode" | "gemini" | "git";
```

to:

```typescript
export type AgentBinary =
	| "claude"
	| "codex"
	| "opencode"
	| "gemini"
	| "git"
	| "turnstone";
```

Change:

```typescript
export const RUNTIME_BINARY: Record<AgentType, AgentBinary> = {
	claude: "claude",
	codex: "codex",
	gemini: "gemini",
	opencode: "opencode",
	// copilot / cursor-agent aren't offered in the pickers yet; map them to their
	// own binary name so a future availability check is a one-line change.
	copilot: "codex",
	"cursor-agent": "codex",
	kimi: "claude",
	minimax: "claude",
	glm: "claude",
};
```

to:

```typescript
export const RUNTIME_BINARY: Record<AgentType, AgentBinary> = {
	claude: "claude",
	codex: "codex",
	gemini: "gemini",
	opencode: "opencode",
	// copilot / cursor-agent aren't offered in the pickers yet; map them to their
	// own binary name so a future availability check is a one-line change.
	copilot: "codex",
	"cursor-agent": "codex",
	kimi: "claude",
	minimax: "claude",
	glm: "claude",
	turnstone: "turnstone",
};
```

Change:

```typescript
export const BINARY_INSTALL: Record<AgentBinary, BinaryInstallInfo> = {
	claude: {
		label: "Claude Code",
		command: "npm i -g @anthropic-ai/claude-code",
		url: "https://claude.com/claude-code",
	},
	codex: {
		label: "Codex CLI",
		command: "npm i -g @openai/codex",
		url: "https://developers.openai.com/codex/cli",
	},
	opencode: {
		label: "OpenCode",
		command: "npm i -g opencode-ai",
		url: "https://opencode.ai/docs",
		note: "Or: curl -fsSL https://opencode.ai/install | bash",
	},
	gemini: {
		label: "Gemini CLI",
		command: "npm i -g @google/gemini-cli",
		url: "https://github.com/google-gemini/gemini-cli",
	},
	git: {
		label: "Git",
		command: "xcode-select --install",
		url: "https://git-scm.com/downloads",
		note: "On macOS, Git ships with Apple's Command Line Tools.",
	},
};
```

to (adding the `turnstone` entry before the closing brace):

```typescript
export const BINARY_INSTALL: Record<AgentBinary, BinaryInstallInfo> = {
	claude: {
		label: "Claude Code",
		command: "npm i -g @anthropic-ai/claude-code",
		url: "https://claude.com/claude-code",
	},
	codex: {
		label: "Codex CLI",
		command: "npm i -g @openai/codex",
		url: "https://developers.openai.com/codex/cli",
	},
	opencode: {
		label: "OpenCode",
		command: "npm i -g opencode-ai",
		url: "https://opencode.ai/docs",
		note: "Or: curl -fsSL https://opencode.ai/install | bash",
	},
	gemini: {
		label: "Gemini CLI",
		command: "npm i -g @google/gemini-cli",
		url: "https://github.com/google-gemini/gemini-cli",
	},
	git: {
		label: "Git",
		command: "xcode-select --install",
		url: "https://git-scm.com/downloads",
		note: "On macOS, Git ships with Apple's Command Line Tools.",
	},
	turnstone: {
		label: "Turnstone",
		command: "pip install turnstone",
		url: "https://github.com/turnstonelabs/turnstone",
		note: "Must run inside WSL (Ubuntu), not native Windows — Turnstone's bash tool needs a real POSIX environment. Requires a Python venv already set up inside WSL.",
	},
};
```

Change:

```typescript
export const CHECKED_BINARIES = [
	"claude",
	"codex",
	"opencode",
	"git",
] as const satisfies readonly AgentBinary[];
```

to:

```typescript
export const CHECKED_BINARIES = [
	"claude",
	"codex",
	"opencode",
	"git",
	"turnstone",
] as const satisfies readonly AgentBinary[];
```

In `packages/local-db/src/schema/zod.ts`, change:

```typescript
export const AGENT_RUNTIMES = [
	"claude",
	"codex",
	"gemini",
	"opencode",
	"copilot",
	"cursor-agent",
	"kimi",
	"minimax",
	"glm",
] as const;
```

to:

```typescript
export const AGENT_RUNTIMES = [
	"claude",
	"codex",
	"gemini",
	"opencode",
	"copilot",
	"cursor-agent",
	"kimi",
	"minimax",
	"glm",
	"turnstone",
] as const;
```

And change:

```typescript
export const REASONING_EFFORTS = ["low", "medium", "high"] as const;
```

to:

```typescript
export const REASONING_EFFORTS = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
```

Run: `cd packages/shared && bun test`
Expected: PASS — the pre-existing `agent-binaries.test.ts` generically iterates
`AGENT_TYPES`/`CHECKED_BINARIES`, so it now exercises `turnstone` automatically
with no new test needed there.

Run: `cd packages/shared && bun run typecheck`
Expected: PASS, no type errors.

Run: `cd packages/local-db && bun run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/agent-command.ts packages/shared/src/agent-command.test.ts packages/shared/src/agent-binaries.ts packages/local-db/src/schema/zod.ts
git commit -m "Register Turnstone as a runtime and expand reasoning-effort vocabulary"
```

---

### Task 2: `buildAgentLaunchCommands` turnstone branch + `RUNTIME_EFFORT_OPTIONS`

**Files:**
- Modify: `packages/shared/src/agent-command.ts`
- Modify: `packages/shared/src/agent-command.test.ts`

**Interfaces:**
- Consumes: `AgentType`, `AGENT_PRESET_COMMANDS`, `ReasoningEffort`,
  `REASONING_EFFORTS` (all from Task 1).
- Produces: `buildAgentLaunchCommands(agent, overrides?)` where `overrides` is now
  `{ model?: string | null; reasoningEffort?: ReasoningEffort | null; host?: string | null; cwd?: string | null }`.
  `RUNTIME_EFFORT_OPTIONS: Partial<Record<AgentType, readonly ReasoningEffort[]>>`.
  Later tasks (4, 6, 7) depend on both of these exact names/shapes.

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to `packages/shared/src/agent-command.test.ts` (add
`buildAgentLaunchCommands` and `RUNTIME_EFFORT_OPTIONS` to the existing import from
`./agent-command`):

```typescript
describe("buildAgentLaunchCommands: turnstone", () => {
	it("builds the default command with no overrides", () => {
		const [command] = buildAgentLaunchCommands("turnstone");
		expect(command).toBe(
			'wsl.exe -d Ubuntu -- ~/turnstone-venv/bin/turnstone --base-url http://192.168.1.41:11434/v1 --provider openai --api-key ollama --model "qwen3.6:latest" --skip-permissions',
		);
	});

	it("embeds a custom model", () => {
		const [command] = buildAgentLaunchCommands("turnstone", {
			model: "gpt-oss:120b",
		});
		expect(command).toContain('--model "gpt-oss:120b"');
	});

	it("embeds a custom host in --base-url", () => {
		const [command] = buildAgentLaunchCommands("turnstone", {
			host: "10.0.0.5:11434",
		});
		expect(command).toContain("--base-url http://10.0.0.5:11434/v1");
	});

	it("adds --reasoning-effort only when overridden", () => {
		const [withoutEffort] = buildAgentLaunchCommands("turnstone");
		expect(withoutEffort).not.toContain("--reasoning-effort");

		const [withEffort] = buildAgentLaunchCommands("turnstone", {
			reasoningEffort: "xhigh",
		});
		expect(withEffort).toContain("--reasoning-effort xhigh");
	});

	it("passes cwd through to wsl.exe's --cd", () => {
		const [command] = buildAgentLaunchCommands("turnstone", {
			cwd: "C:\\Users\\icep9\\.ade\\agents\\abc123\\worktree",
		});
		expect(command).toContain(
			'wsl.exe -d Ubuntu --cd "C:\\Users\\icep9\\.ade\\agents\\abc123\\worktree" --',
		);
	});

	it("omits --cd when no cwd is given", () => {
		const [command] = buildAgentLaunchCommands("turnstone");
		expect(command).not.toContain("--cd");
	});
});

describe("RUNTIME_EFFORT_OPTIONS", () => {
	it("gives codex its original 3-value scale", () => {
		expect(RUNTIME_EFFORT_OPTIONS.codex).toEqual(["low", "medium", "high"]);
	});

	it("gives turnstone the full 7-value scale", () => {
		expect(RUNTIME_EFFORT_OPTIONS.turnstone).toEqual([
			"none",
			"minimal",
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
		]);
	});

	it("has no entry for runtimes that don't support an effort override", () => {
		expect(RUNTIME_EFFORT_OPTIONS.claude).toBeUndefined();
		expect(RUNTIME_EFFORT_OPTIONS.opencode).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/shared && bun test agent-command.test.ts`
Expected: FAIL — `buildAgentLaunchCommands("turnstone")` still falls through to
`AGENT_PRESET_COMMANDS.turnstone` with no host/model/effort/cwd handling, and
`RUNTIME_EFFORT_OPTIONS` doesn't exist yet (compile error).

- [ ] **Step 3: Implement the turnstone branch and `RUNTIME_EFFORT_OPTIONS`**

In `packages/shared/src/agent-command.ts`, change:

```typescript
/**
 * Builds a runtime's launch command, applying an optional model / reasoning-
 * effort override on top of its AGENT_PRESET_COMMANDS default. Only
 * claude/codex/opencode accept a `--model` override; only codex additionally
 * accepts a reasoning-effort level. Every other runtime (gemini, copilot,
 * cursor-agent, and the OpenRouter-pinned kimi/minimax/glm) ignores overrides
 * since their model is fixed by the preset.
 */
export function buildAgentLaunchCommands(
	agent: AgentType,
	overrides?: { model?: string | null; reasoningEffort?: ReasoningEffort | null },
): string[] {
	const model = overrides?.model?.trim() || undefined;
	const effort = overrides?.reasoningEffort ?? undefined;

	if (agent === "codex" && (model || effort)) {
		return [
			`codex --model ${quoteShellArg(model ?? "gpt-5.5")} -c model_reasoning_effort="${effort ?? "high"}" --ask-for-approval never --sandbox danger-full-access -c model_reasoning_summary="detailed" -c model_supports_reasoning_summaries=true`,
		];
	}
	if (agent === "claude" && model) {
		return [`claude --dangerously-skip-permissions --model ${quoteShellArg(model)}`];
	}
	if (agent === "opencode" && model) {
		return [`opencode --model ${quoteShellArg(model)}`];
	}
	return AGENT_PRESET_COMMANDS[agent];
}
```

to:

```typescript
/**
 * Which effort levels each runtime's Effort selector should offer. Runtimes
 * absent from this map don't support a reasoning-effort override at all (the
 * New Agent modal hides the Effort field for them).
 */
export const RUNTIME_EFFORT_OPTIONS: Partial<
	Record<AgentType, readonly ReasoningEffort[]>
> = {
	codex: ["low", "medium", "high"],
	turnstone: REASONING_EFFORTS,
};

/**
 * Builds a runtime's launch command, applying an optional model / reasoning-
 * effort override on top of its AGENT_PRESET_COMMANDS default. Only
 * claude/codex/opencode accept a `--model` override; only codex/turnstone
 * additionally accept a reasoning-effort level. Every other runtime (gemini,
 * copilot, cursor-agent, and the OpenRouter-pinned kimi/minimax/glm) ignores
 * overrides since their model is fixed by the preset.
 *
 * turnstone is a special case: it always builds fresh (never falls through to
 * the static AGENT_PRESET_COMMANDS entry) because it's the only runtime whose
 * cwd must be embedded in the command itself. Every other runtime's command
 * is typed into a shell pane that's already sitting in the agent's worktree,
 * so it inherits cwd for free — but `wsl.exe` starts a wholly separate Linux
 * process whose cwd needs to be set explicitly via `--cd`.
 */
export function buildAgentLaunchCommands(
	agent: AgentType,
	overrides?: {
		model?: string | null;
		reasoningEffort?: ReasoningEffort | null;
		host?: string | null;
		cwd?: string | null;
	},
): string[] {
	const model = overrides?.model?.trim() || undefined;
	const effort = overrides?.reasoningEffort ?? undefined;

	if (agent === "codex" && (model || effort)) {
		return [
			`codex --model ${quoteShellArg(model ?? "gpt-5.5")} -c model_reasoning_effort="${effort ?? "high"}" --ask-for-approval never --sandbox danger-full-access -c model_reasoning_summary="detailed" -c model_supports_reasoning_summaries=true`,
		];
	}
	if (agent === "claude" && model) {
		return [`claude --dangerously-skip-permissions --model ${quoteShellArg(model)}`];
	}
	if (agent === "opencode" && model) {
		return [`opencode --model ${quoteShellArg(model)}`];
	}
	if (agent === "turnstone") {
		const host = overrides?.host?.trim() || TURNSTONE_DEFAULT_HOST;
		const turnstoneModel = model ?? TURNSTONE_DEFAULT_MODEL;
		const cwd = overrides?.cwd?.trim() || undefined;
		const cdFlag = cwd ? ` --cd ${quoteShellArg(cwd)}` : "";
		const effortFlag = effort ? ` --reasoning-effort ${effort}` : "";
		return [
			`wsl.exe -d ${TURNSTONE_WSL_DISTRO}${cdFlag} -- ~/turnstone-venv/bin/turnstone --base-url http://${host}/v1 --provider openai --api-key ollama --model ${quoteShellArg(turnstoneModel)}${effortFlag} --skip-permissions`,
		];
	}
	return AGENT_PRESET_COMMANDS[agent];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/shared && bun test agent-command.test.ts`
Expected: PASS, all tests including the new turnstone/RUNTIME_EFFORT_OPTIONS ones.
Double check the exact quoting in the "default command" test above matches —
`quoteShellArg` wraps in double quotes, so `--model qwen3.6:latest` becomes
`--model "qwen3.6:latest"` in the output; the effort flag has no quoting since it's
always one of the fixed enum words (no spaces/special characters possible).

- [ ] **Step 5: Run the full shared package test suite and typecheck**

Run: `cd packages/shared && bun test && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/agent-command.ts packages/shared/src/agent-command.test.ts
git commit -m "Add turnstone branch to buildAgentLaunchCommands with WSL cwd handling"
```

---

### Task 3: Add `host` column to the workspaces table

**Files:**
- Modify: `packages/local-db/src/schema/schema.ts`
- Create (generated): `packages/local-db/drizzle/00XX_<auto-name>.sql`
- Create (generated): `packages/local-db/drizzle/meta/00XX_snapshot.json`
- Modify (generated): `packages/local-db/drizzle/meta/_journal.json`

**Interfaces:**
- Produces: `workspaces.host: string | null` on `SelectWorkspace`/`InsertWorkspace`.
  Task 4 depends on this column existing.

- [ ] **Step 1: Add the column to the schema**

In `packages/local-db/src/schema/schema.ts`, change:

```typescript
			// Optional per-agent model override for the runtime's launch command
			// (e.g. "opus", "gpt-5.5-mini"). Set at agent creation; null uses the
			// runtime's default model. See buildAgentLaunchCommands.
			model: text("model"),
			// Optional reasoning-effort override, only meaningful for runtimes that
			// support it (codex). Null uses the runtime's default effort.
			reasoningEffort: text("reasoning_effort").$type<ReasoningEffort>(),
		},
```

to:

```typescript
			// Optional per-agent model override for the runtime's launch command
			// (e.g. "opus", "gpt-5.5-mini"). Set at agent creation; null uses the
			// runtime's default model. See buildAgentLaunchCommands.
			model: text("model"),
			// Optional reasoning-effort override, only meaningful for runtimes that
			// support it (codex, turnstone). Null uses the runtime's default effort.
			reasoningEffort: text("reasoning_effort").$type<ReasoningEffort>(),
			// Optional per-agent Ollama host override for the turnstone runtime
			// (e.g. "10.0.0.5:11434"). Null uses TURNSTONE_DEFAULT_HOST. Meaningless
			// for every other runtime.
			host: text("host"),
		},
```

- [ ] **Step 2: Generate the migration**

Run: `cd packages/local-db && bun run generate`
Expected output ends with something like:
```
[✓] Your SQL migration file ➜ drizzle\00XX_<name>.sql 🚀
```

- [ ] **Step 3: Verify the generated migration is exactly the one column**

Read the new file at `packages/local-db/drizzle/00XX_<name>.sql`. Expected content
(exact column addition, nothing else):
```sql
ALTER TABLE `workspaces` ADD `host` text;
```
If it contains anything else (e.g. it picked up unrelated schema drift), stop and
investigate before proceeding — do not hand-edit the generated file.

- [ ] **Step 4: Typecheck**

Run: `cd packages/local-db && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/local-db/src/schema/schema.ts packages/local-db/drizzle/
git commit -m "Add host column to workspaces for per-agent Turnstone/Ollama override"
```

---

### Task 4: `host` field on the createAgent tRPC procedure

**Files:**
- Modify: `apps/desktop/src/lib/trpc/routers/workspaces/procedures/create-agent-input.ts`
- Modify: `apps/desktop/src/lib/trpc/routers/workspaces/procedures/create-agent.ts`
- Modify: `apps/desktop/src/lib/trpc/routers/workspaces/procedures/create-agent.test.ts`

**Interfaces:**
- Consumes: `workspaces.host` column (Task 3), `REASONING_EFFORTS` (Task 1).
- Produces: `createAgentInput` parses an optional `host: string | undefined`.
  `createAgent` mutation persists it. Task 6/7 depend on the mutation accepting
  `host` in its input.

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/src/lib/trpc/routers/workspaces/procedures/create-agent.test.ts`:

```typescript
describe("createAgentInput host", () => {
	const base = { projectId: "cat-1", name: "Scout" };

	it("defaults to undefined when omitted", () => {
		expect(createAgentInput.parse(base).host).toBeUndefined();
	});

	it("trims and treats an empty string as unset", () => {
		expect(
			createAgentInput.parse({ ...base, host: "  10.0.0.5:11434  " }).host,
		).toBe("10.0.0.5:11434");
		expect(createAgentInput.parse({ ...base, host: "" }).host).toBeUndefined();
	});
});

describe("createAgentInput reasoningEffort accepts turnstone's wider vocabulary", () => {
	const base = { projectId: "cat-1", name: "Scout" };

	it("accepts a turnstone-only value like xhigh", () => {
		expect(
			createAgentInput.parse({ ...base, reasoningEffort: "xhigh" })
				.reasoningEffort,
		).toBe("xhigh");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && bun test src/lib/trpc/routers/workspaces/procedures/create-agent.test.ts`
Expected: FAIL — `host` isn't a recognized key on `createAgentInput` yet (zod
strips unknown keys by default, so `.host` reads back `undefined` even for the
non-empty case), and the `xhigh` test already passes coincidentally only once
Task 1's enum expansion has landed — if Task 1 wasn't done first this would also
fail with an invalid-enum error, which is expected since Task 1 is a stated
dependency.

- [ ] **Step 3: Add `host` to the input schema**

In `apps/desktop/src/lib/trpc/routers/workspaces/procedures/create-agent-input.ts`,
change:

```typescript
	runtime: z.enum(AGENT_RUNTIMES).default("claude"),
	// Optional per-agent overrides for the runtime's launch command. Empty
	// string collapses to undefined, same treatment as `role`.
	model: z
		.string()
		.trim()
		.max(120)
		.optional()
		.transform((v) => (v ? v : undefined)),
	reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
	repo: z
```

to:

```typescript
	runtime: z.enum(AGENT_RUNTIMES).default("claude"),
	// Optional per-agent overrides for the runtime's launch command. Empty
	// string collapses to undefined, same treatment as `role`.
	model: z
		.string()
		.trim()
		.max(120)
		.optional()
		.transform((v) => (v ? v : undefined)),
	reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
	// Turnstone-only Ollama host override (e.g. "10.0.0.5:11434"). Same
	// trim/empty-to-undefined treatment as `model`.
	host: z
		.string()
		.trim()
		.max(120)
		.optional()
		.transform((v) => (v ? v : undefined)),
	repo: z
```

- [ ] **Step 4: Pass `host` through to the workspace insert**

In `apps/desktop/src/lib/trpc/routers/workspaces/procedures/create-agent.ts`,
change:

```typescript
					name: input.name,
					runtime: input.runtime,
					model: input.model,
					reasoningEffort: input.reasoningEffort,
					isUnnamed: false,
```

to:

```typescript
					name: input.name,
					runtime: input.runtime,
					model: input.model,
					reasoningEffort: input.reasoningEffort,
					host: input.host,
					isUnnamed: false,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/desktop && bun test src/lib/trpc/routers/workspaces/procedures/create-agent.test.ts`
Expected: PASS — all tests in the file (the pre-existing `role`/`model`/
`reasoningEffort` ones plus the two new blocks).

- [ ] **Step 6: Typecheck the desktop app**

Run: `cd apps/desktop && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/lib/trpc/routers/workspaces/procedures/create-agent-input.ts apps/desktop/src/lib/trpc/routers/workspaces/procedures/create-agent.ts apps/desktop/src/lib/trpc/routers/workspaces/procedures/create-agent.test.ts
git commit -m "Add host override to createAgent input/procedure"
```

---

### Task 5: WSL-based Turnstone availability check

**Files:**
- Create: `apps/desktop/src/main/lib/agent-setup/turnstone.ts`
- Modify: `apps/desktop/src/lib/trpc/routers/config/config.ts`

**Interfaces:**
- Consumes: `CHECKED_BINARIES` now includes `"turnstone"` (Task 1).
- Produces: `checkTurnstoneAvailable(): boolean`, exported from
  `main/lib/agent-setup/turnstone`. Nothing later depends on this beyond the UI's
  existing generic `isAvailable("turnstone")` call (already covered by the shared
  `RuntimeAvailability` type from Task 1 — no renderer code changes needed for
  this task specifically).

This task deliberately has no `bun:test` unit test (per the design spec: mocking
`execFileSync` would test the mock, not reality — the existing `findRealBinary` has
the same no-test precedent). Verification is a manual probe against this machine's
real WSL/Turnstone setup, which is already confirmed present.

- [ ] **Step 1: Create the check function**

Create `apps/desktop/src/main/lib/agent-setup/turnstone.ts`:

```typescript
import { execFileSync } from "node:child_process";

const WSL_DISTRO = "Ubuntu";

/**
 * Checks whether Turnstone's venv is present inside WSL. Collapses three
 * failure modes into one boolean: no WSL at all (also what naturally happens
 * on macOS/Linux — execFileSync throws ENOENT here), WSL present but no
 * Ubuntu distro, or Ubuntu present but the venv/turnstone binary missing.
 *
 * Unlike findRealBinary's near-instant native `where.exe`/`which` check, a
 * cold WSL VM can take a couple of seconds to start, so this gets a generous
 * timeout instead of hanging the availability query indefinitely.
 */
export function checkTurnstoneAvailable(): boolean {
	try {
		execFileSync(
			"wsl.exe",
			[
				"-d",
				WSL_DISTRO,
				"--",
				"bash",
				"-lc",
				"test -x ~/turnstone-venv/bin/turnstone",
			],
			{ stdio: "ignore", timeout: 5_000 },
		);
		return true;
	} catch {
		return false;
	}
}
```

- [ ] **Step 2: Wire it into `computeRuntimeAvailability`**

In `apps/desktop/src/lib/trpc/routers/config/config.ts`, change the import block:

```typescript
import { findRealBinary } from "main/lib/agent-setup/utils";
```

to:

```typescript
import { findRealBinary } from "main/lib/agent-setup/utils";
import { checkTurnstoneAvailable } from "main/lib/agent-setup/turnstone";
```

Change:

```typescript
function computeRuntimeAvailability(): RuntimeAvailability {
	const entries = CHECKED_BINARIES.map(
		(bin) => [bin, findRealBinary(bin) !== null] as const,
	);
	return Object.fromEntries(entries) as RuntimeAvailability;
}
```

to:

```typescript
function computeRuntimeAvailability(): RuntimeAvailability {
	const entries = CHECKED_BINARIES.map(
		(bin) =>
			[
				bin,
				bin === "turnstone"
					? checkTurnstoneAvailable()
					: findRealBinary(bin) !== null,
			] as const,
	);
	return Object.fromEntries(entries) as RuntimeAvailability;
}
```

Also update the comment just above the existing `AVAILABILITY_TTL_MS` constant to
mention the new, slower check (find the comment block starting with `/**\n *
Runtime-binary availability, cached briefly...`) — change:

```typescript
/**
 * Runtime-binary availability, cached briefly. Shelling out to the login shell
 * (findRealBinary) is a few hundred ms, and the ModelBar / NewAgentModal both
 * read it, so a short TTL avoids repeated probes while `force` lets the UI
 * re-check after the user installs a missing tool.
 */
```

to:

```typescript
/**
 * Runtime-binary availability, cached briefly. Shelling out to the login shell
 * (findRealBinary) is a few hundred ms, and the ModelBar / NewAgentModal both
 * read it, so a short TTL avoids repeated probes while `force` lets the UI
 * re-check after the user installs a missing tool. The turnstone check is
 * slower (a cold WSL VM can take a couple of seconds to start), so this cache
 * matters even more for it.
 */
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/desktop && bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Manually verify the check against this machine's real WSL/Turnstone setup**

Run:
```bash
cd apps/desktop
bun -e "import('./src/main/lib/agent-setup/turnstone.ts').then(m => console.log('available:', m.checkTurnstoneAvailable()))"
```
Expected output: `available: true` — this machine has Turnstone installed inside
WSL Ubuntu at `~/turnstone-venv/bin/turnstone` (confirmed during the design's
research phase via `wsl.exe -d Ubuntu -- bash -lc '$HOME/turnstone-venv/bin/turnstone --help'`).
If this prints `available: false`, stop and debug before continuing — either the
check's argv is wrong or something about this machine's WSL setup changed.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/lib/agent-setup/turnstone.ts apps/desktop/src/lib/trpc/routers/config/config.ts
git commit -m "Add WSL-based availability check for the turnstone runtime"
```

---

### Task 6: New Agent modal — Runtime/Effort/Host/Model UI for Turnstone

**Files:**
- Modify: `apps/desktop/src/renderer/components/NewAgentModal/NewAgentModal.tsx`

**Interfaces:**
- Consumes: `RUNTIME_EFFORT_OPTIONS` (Task 2), `createAgentInput.host` (Task 4),
  `CHECKED_BINARIES`/`BINARY_INSTALL.turnstone` (Task 1),
  `checkTurnstoneAvailable` wired into `runtimeAvailability` (Task 5).
- Produces: the modal now lets the user pick Turnstone as a runtime with Model/
  Effort/Host fields, and submits `host` in the `createAgent.mutateAsync` payload.
  Task 7 doesn't depend on this file directly (it depends on the DB columns
  already wired by Task 4), but this is where a user can actually create a
  Turnstone agent for Task 7's end-to-end verification to use.

- [ ] **Step 1: Add `"turnstone"` to `RUNTIME_CHOICES` and import `RUNTIME_EFFORT_OPTIONS`**

In `apps/desktop/src/renderer/components/NewAgentModal/NewAgentModal.tsx`, change
the import from `@superset/shared/agent-command`:

```typescript
import { AGENT_LABELS } from "@superset/shared/agent-command";
```

to:

```typescript
import {
	AGENT_LABELS,
	RUNTIME_EFFORT_OPTIONS,
} from "@superset/shared/agent-command";
```

Change:

```typescript
/**
 * Runtimes offered in the New Agent picker. The full AGENT_RUNTIMES enum (and
 * the launch presets) still support the rest — they return for the later
 * models stage.
 */
const RUNTIME_CHOICES = ["claude", "codex", "opencode"] as const;
```

to:

```typescript
/**
 * Runtimes offered in the New Agent picker. The full AGENT_RUNTIMES enum (and
 * the launch presets) still support the rest — they return for the later
 * models stage.
 */
const RUNTIME_CHOICES = ["claude", "codex", "opencode", "turnstone"] as const;
```

- [ ] **Step 2: Add `host` state and reset it on open**

Change:

```typescript
	const [model, setModel] = useState("");
	const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("high");
```

to:

```typescript
	const [model, setModel] = useState("");
	const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("high");
	const [host, setHost] = useState("");
```

Change:

```typescript
		setModel("");
		setReasoningEffort("high");
		setRepoMode("init");
```

to:

```typescript
		setModel("");
		setReasoningEffort("high");
		setHost("");
		setRepoMode("init");
```

- [ ] **Step 3: Drive the Effort field's visibility and options from `RUNTIME_EFFORT_OPTIONS`, and add the Host row**

Change:

```typescript
					<div className="flex gap-3">
						<div className="flex flex-1 flex-col gap-1.5">
							<Label htmlFor="agent-model">Model (optional)</Label>
							<Input
								id="agent-model"
								value={model}
								onChange={(e) => setModel(e.target.value)}
								placeholder={
									runtime === "codex" ? "gpt-5.5" : "e.g. opus, sonnet"
								}
							/>
						</div>
						{runtime === "codex" && (
							<div className="flex w-32 shrink-0 flex-col gap-1.5">
								<Label>Effort</Label>
								<Select
									value={reasoningEffort}
									onValueChange={(v) => setReasoningEffort(v as ReasoningEffort)}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{REASONING_EFFORTS.map((effort) => (
											<SelectItem key={effort} value={effort}>
												{effort[0].toUpperCase() + effort.slice(1)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}
					</div>
```

to:

```typescript
					<div className="flex gap-3">
						<div className="flex flex-1 flex-col gap-1.5">
							<Label htmlFor="agent-model">Model (optional)</Label>
							<Input
								id="agent-model"
								value={model}
								onChange={(e) => setModel(e.target.value)}
								placeholder={
									runtime === "codex"
										? "gpt-5.5"
										: runtime === "turnstone"
											? "qwen3.6:latest"
											: "e.g. opus, sonnet"
								}
							/>
						</div>
						{RUNTIME_EFFORT_OPTIONS[runtime] && (
							<div className="flex w-32 shrink-0 flex-col gap-1.5">
								<Label>Effort</Label>
								<Select
									value={reasoningEffort}
									onValueChange={(v) => setReasoningEffort(v as ReasoningEffort)}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{RUNTIME_EFFORT_OPTIONS[runtime]?.map((effort) => (
											<SelectItem key={effort} value={effort}>
												{effort[0].toUpperCase() + effort.slice(1)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}
					</div>
					{runtime === "turnstone" && (
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="agent-host">Ollama host (optional)</Label>
							<Input
								id="agent-host"
								value={host}
								onChange={(e) => setHost(e.target.value)}
								placeholder="192.168.1.41:11434"
							/>
						</div>
					)}
```

Note: this removes the only remaining usage of the `REASONING_EFFORTS` import in
this file (it's replaced by `RUNTIME_EFFORT_OPTIONS[runtime]`) — check whether
`REASONING_EFFORTS` is imported from `@superset/local-db` elsewhere in this file
(it is, alongside `AGENT_RUNTIMES` and `type ReasoningEffort`) and remove it from
that import if it's now unused, to keep the biome `noUnusedImports` lint clean.
Change:

```typescript
import {
	AGENT_RUNTIMES,
	REASONING_EFFORTS,
	type ReasoningEffort,
} from "@superset/local-db";
```

to:

```typescript
import { AGENT_RUNTIMES, type ReasoningEffort } from "@superset/local-db";
```

- [ ] **Step 4: Include `host` in the create payload**

Change:

```typescript
				role: role.trim() || undefined,
				runtime,
				model: model.trim() || undefined,
				reasoningEffort: runtime === "codex" ? reasoningEffort : undefined,
				repo:
```

to:

```typescript
				role: role.trim() || undefined,
				runtime,
				model: model.trim() || undefined,
				reasoningEffort: RUNTIME_EFFORT_OPTIONS[runtime]
					? reasoningEffort
					: undefined,
				host: runtime === "turnstone" ? host.trim() || undefined : undefined,
				repo:
```

- [ ] **Step 5: Typecheck and lint**

Run: `cd apps/desktop && bun run typecheck`
Expected: PASS.

Run (from repo root): `bunx biome lint --no-errors-on-unmatched apps/desktop/src/renderer/components/NewAgentModal/NewAgentModal.tsx`
Expected: no new warnings beyond the two pre-existing ones already present in this
file before this task (a `useImportType` note on the `@superset/local-db` import
and a `suppressions/unused` note on the reset-on-open `useEffect`'s biome-ignore
comment — both predate this change).

- [ ] **Step 6: Live verification — Runtime/Effort/Host fields render correctly**

Follow the `run-desktop` skill (`apps/desktop/.claude/skills/run-desktop/SKILL.md`):
build (`bun run build:app`), launch with CDP
(`DESKTOP_AUTOMATION_PORT=41730 SKIP_ENV_VALIDATION=1 bunx electron .`), then use
the driver (`.claude/skills/run-desktop/driver.mjs`) to open the New Agent modal
and screenshot it with Runtime set to Turnstone. Confirm:
- Runtime dropdown lists "Turnstone" (with "· not installed" only if
  `checkTurnstoneAvailable()` returns false on the machine running this — expect
  no such suffix on this machine per Task 5's manual verification).
- Model field placeholder reads `qwen3.6:latest`.
- Effort field is visible with all 7 options (None/Minimal/Low/Medium/High/
  Xhigh/Max).
- A new "Ollama host (optional)" field is visible with placeholder
  `192.168.1.41:11434`.
- Switching Runtime back to Claude hides both the Effort and Host fields again.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/components/NewAgentModal/NewAgentModal.tsx
git commit -m "Add Turnstone runtime option with Effort/Host fields to New Agent modal"
```

---

### Task 7: Wire `host` through session-spawn call sites + end-to-end verification

**Files:**
- Modify: `apps/desktop/src/renderer/stores/tabs/useAgentSession.ts`
- Modify: `apps/desktop/src/renderer/routes/_authenticated/_dashboard/workspace/$workspaceId/page.tsx`
- Modify: `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/GroupStrip/GroupStrip.tsx`

**Interfaces:**
- Consumes: `buildAgentLaunchCommands`'s `host`/`cwd` overrides (Task 2),
  `workspaces.host` flowing through `workspaces.get`'s `...workspace` spread
  (already automatic — verify via typecheck, no query.ts changes needed, same as
  how `model`/`reasoningEffort` already flowed through without touching that
  file).
- Produces: the agent's own worktree cwd and stored Ollama host now reach
  `buildAgentLaunchCommands` when a Turnstone session auto-spawns or is spawned
  via the "+" button.

- [ ] **Step 1: Add `host` to `AgentSessionWorkspace` and pass `host`/`cwd` into `buildAgentLaunchCommands`**

In `apps/desktop/src/renderer/stores/tabs/useAgentSession.ts`, change:

```typescript
/** Minimal shape needed to spawn an agent's runtime CLI session. */
export interface AgentSessionWorkspace {
	id: string;
	runtime?: AgentRuntime | null;
	worktreePath?: string | null;
	model?: string | null;
	reasoningEffort?: ReasoningEffort | null;
}
```

to:

```typescript
/** Minimal shape needed to spawn an agent's runtime CLI session. */
export interface AgentSessionWorkspace {
	id: string;
	runtime?: AgentRuntime | null;
	worktreePath?: string | null;
	model?: string | null;
	reasoningEffort?: ReasoningEffort | null;
	host?: string | null;
}
```

Change:

```typescript
	const spawnAgentSession = useCallback(
		(workspace: AgentSessionWorkspace) => {
			const { id, runtime, worktreePath, model, reasoningEffort } = workspace;
			const cwd = worktreePath || undefined;

			if (!runtime) {
				// No runtime configured — open a plain shell in the worktree.
				return addTab(id, { initialCwd: cwd });
			}

			const preset: TerminalPreset = {
				id: `agent-${runtime}`,
				name: AGENT_LABELS[runtime] ?? runtime,
				cwd: worktreePath ?? "",
				commands: buildAgentLaunchCommands(runtime, { model, reasoningEffort }),
				executionMode: "new-tab",
			};

			return openPreset(id, preset, { target: "new-tab" });
		},
		[openPreset, addTab],
	);
```

to:

```typescript
	const spawnAgentSession = useCallback(
		(workspace: AgentSessionWorkspace) => {
			const { id, runtime, worktreePath, model, reasoningEffort, host } =
				workspace;
			const cwd = worktreePath || undefined;

			if (!runtime) {
				// No runtime configured — open a plain shell in the worktree.
				return addTab(id, { initialCwd: cwd });
			}

			const preset: TerminalPreset = {
				id: `agent-${runtime}`,
				name: AGENT_LABELS[runtime] ?? runtime,
				cwd: worktreePath ?? "",
				commands: buildAgentLaunchCommands(runtime, {
					model,
					reasoningEffort,
					host,
					cwd,
				}),
				executionMode: "new-tab",
			};

			return openPreset(id, preset, { target: "new-tab" });
		},
		[openPreset, addTab],
	);
```

- [ ] **Step 2: Pass `host` at both call sites**

In `apps/desktop/src/renderer/routes/_authenticated/_dashboard/workspace/$workspaceId/page.tsx`,
change:

```typescript
	const spawnSession = useCallback(() => {
		return spawnAgentSession({
			id: workspaceId,
			runtime: workspace?.runtime ?? null,
			worktreePath: workspace?.worktreePath ?? null,
			model: workspace?.model ?? null,
			reasoningEffort: workspace?.reasoningEffort ?? null,
		});
	}, [
		spawnAgentSession,
		workspaceId,
		workspace?.runtime,
		workspace?.worktreePath,
		workspace?.model,
		workspace?.reasoningEffort,
	]);
```

to:

```typescript
	const spawnSession = useCallback(() => {
		return spawnAgentSession({
			id: workspaceId,
			runtime: workspace?.runtime ?? null,
			worktreePath: workspace?.worktreePath ?? null,
			model: workspace?.model ?? null,
			reasoningEffort: workspace?.reasoningEffort ?? null,
			host: workspace?.host ?? null,
		});
	}, [
		spawnAgentSession,
		workspaceId,
		workspace?.runtime,
		workspace?.worktreePath,
		workspace?.model,
		workspace?.reasoningEffort,
		workspace?.host,
	]);
```

In `apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/GroupStrip/GroupStrip.tsx`,
change:

```typescript
	const handleAddGroup = () => {
		if (!activeWorkspaceId) return;
		const result = spawnAgentSession({
			id: activeWorkspaceId,
			runtime: workspace?.runtime ?? null,
			worktreePath: workspace?.worktreePath ?? null,
			model: workspace?.model ?? null,
			reasoningEffort: workspace?.reasoningEffort ?? null,
		});
```

to:

```typescript
	const handleAddGroup = () => {
		if (!activeWorkspaceId) return;
		const result = spawnAgentSession({
			id: activeWorkspaceId,
			runtime: workspace?.runtime ?? null,
			worktreePath: workspace?.worktreePath ?? null,
			model: workspace?.model ?? null,
			reasoningEffort: workspace?.reasoningEffort ?? null,
			host: workspace?.host ?? null,
		});
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/desktop && bun run typecheck`
Expected: PASS — confirms `workspaces.get`'s `...workspace` spread already
surfaces `host` with no changes needed to `query.ts` (same structural-typing
behavior already proven for `model`/`reasoningEffort` in the prior feature).

- [ ] **Step 4: End-to-end live verification**

Using the same running app + driver from Task 6's Step 6 (rebuild first if the
app isn't still running with these latest changes — `bun run build:app`, then
relaunch):
1. Create a new agent named e.g. "Ollama Test" with Runtime = Turnstone, a custom
   Model (e.g. `gpt-oss:120b`), a custom Effort (e.g. `high`), and leave Host at
   its default placeholder (don't type anything, to exercise the default-fallback
   path).
2. Screenshot the auto-spawned terminal pane.
3. Confirm the pane's prompt shows the exact command:
   ```
   wsl.exe -d Ubuntu --cd "C:\Users\icep9\.ade\agents\<agent-id>\worktree" -- ~/turnstone-venv/bin/turnstone --base-url http://192.168.1.41:11434/v1 --provider openai --api-key ollama --model "gpt-oss:120b" --reasoning-effort high --skip-permissions
   ```
   (the worktree path segment will contain the real generated agent id).
4. Confirm Turnstone actually starts (its own startup banner/prompt appears in
   the pane, not a `wsl.exe`/`bash` error) and that a simple prompt typed into it
   gets a real response back from the Ollama box at `192.168.1.41:11434` — this
   is the concrete resolution of the two "Verification items for the
   implementation plan" listed in the design spec (native-Windows-typed-command
   tilde/path resolution, and `--cd` correctly landing Turnstone's bash tool in
   the worktree).
5. Quit the app (`bun .claude/skills/run-desktop/driver.mjs --port 41730 quit`).

If step 4 fails (e.g. Turnstone starts but its bash tool can't see the worktree,
or the command doesn't parse the way expected when typed into the real Windows
shell pane), stop and treat it as a design-assumption failure to debug — do not
mark this task complete until the real chat round-trip is observed.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/stores/tabs/useAgentSession.ts apps/desktop/src/renderer/routes/_authenticated/_dashboard/workspace/\$workspaceId/page.tsx apps/desktop/src/renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/GroupStrip/GroupStrip.tsx
git commit -m "Wire host override through session-spawn call sites for turnstone"
```
