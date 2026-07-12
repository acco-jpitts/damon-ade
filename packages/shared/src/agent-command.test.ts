import { describe, expect, it } from "bun:test";
import {
	AGENT_PRESET_COMMANDS,
	buildAgentPromptCommand,
	REASONING_EFFORTS,
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
