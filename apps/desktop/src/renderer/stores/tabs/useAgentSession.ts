import {
	AGENT_LABELS,
	buildAgentLaunchCommands,
} from "@superset/shared/agent-command";
import type { AgentRuntime, ReasoningEffort, TerminalPreset } from "@superset/local-db";
import { useCallback } from "react";
import { useTabsWithPresets } from "./useTabsWithPresets";

/** Minimal shape needed to spawn an agent's runtime CLI session. */
export interface AgentSessionWorkspace {
	id: string;
	runtime?: AgentRuntime | null;
	worktreePath?: string | null;
	model?: string | null;
	reasoningEffort?: ReasoningEffort | null;
	host?: string | null;
}

/**
 * Spawns an agent's runtime CLI in a new terminal session tab.
 *
 * A "session" is just a normal terminal tab. Given an agent (workspace) with a
 * runtime, we build a synthetic TerminalPreset that launches the runtime's CLI
 * (via buildAgentLaunchCommands, applying the agent's stored model/effort
 * override) in the agent's worktree and open it as a new tab. When the agent
 * has no runtime we fall back to a plain shell tab.
 */
export function useAgentSession() {
	const { openPreset, addTab } = useTabsWithPresets();

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

	return { spawnAgentSession };
}
