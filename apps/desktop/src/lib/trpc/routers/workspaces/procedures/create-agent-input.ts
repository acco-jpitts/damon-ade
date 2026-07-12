import { AGENT_RUNTIMES, REASONING_EFFORTS } from "@superset/local-db/schema/zod";
import { z } from "zod";

/**
 * Input schema for the createAgent procedure. Kept in its own module (importing
 * only zod + the light schema constants, no DB / main-process singletons) so the
 * validation — notably the optional `role` field — is unit-testable in isolation.
 */
export const createAgentInput = z.object({
	projectId: z.string(),
	name: z.string().min(1),
	// Optional free-text identity captured at creation. Trimmed; empty becomes
	// undefined so the scaffold treats it as unset.
	role: z
		.string()
		.trim()
		.max(280)
		.optional()
		.transform((v) => (v ? v : undefined)),
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
		.discriminatedUnion("type", [
			z.object({ type: z.literal("init") }),
			z.object({ type: z.literal("clone"), url: z.string().min(1) }),
		])
		.default({ type: "init" }),
});
