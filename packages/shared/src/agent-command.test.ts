import { describe, expect, it } from "bun:test";
import {
	AGENT_PRESET_COMMANDS,
	buildAgentLaunchCommands,
	buildAgentPromptCommand,
	REASONING_EFFORTS,
	RUNTIME_EFFORT_OPTIONS,
} from "./agent-command";

describe("buildAgentPromptCommand", () => {
	it("adds `--` before codex prompt payload", () => {
		const command = buildAgentPromptCommand({
			prompt: "- Only modified file: runtime.ts",
			randomId: "1234-5678",
			agent: "codex",
		});

		expect(command).toContain(
			"--sandbox danger-full-access -- \"$(cat <<'SUPERSET_PROMPT_12345678'",
		);
		expect(command).toContain("- Only modified file: runtime.ts");
	});

	it("does not change non-codex commands", () => {
		const command = buildAgentPromptCommand({
			prompt: "hello",
			randomId: "abcd-efgh",
			agent: "claude",
		});

		expect(command).toStartWith(
			"claude --dangerously-skip-permissions \"$(cat <<'SUPERSET_PROMPT_abcdefgh'",
		);
	});
});

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
