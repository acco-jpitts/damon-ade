import { describe, expect, it } from "bun:test";
import { createAgentInput } from "./create-agent-input";

/**
 * Input validation for createAgent — focused on the optional `role` field
 * captured in the New Agent modal (trimmed, empty → undefined, capped length).
 */
describe("createAgentInput role", () => {
	const base = { projectId: "cat-1", name: "Scout" };

	it("defaults role to undefined when omitted", () => {
		const parsed = createAgentInput.parse(base);
		expect(parsed.role).toBeUndefined();
	});

	it("trims surrounding whitespace", () => {
		const parsed = createAgentInput.parse({ ...base, role: "  Researcher  " });
		expect(parsed.role).toBe("Researcher");
	});

	it("treats a whitespace-only role as unset (undefined)", () => {
		const parsed = createAgentInput.parse({ ...base, role: "   " });
		expect(parsed.role).toBeUndefined();
	});

	it("treats an empty string as unset (undefined)", () => {
		const parsed = createAgentInput.parse({ ...base, role: "" });
		expect(parsed.role).toBeUndefined();
	});

	it("keeps a role at the max length", () => {
		const role = "a".repeat(280);
		const parsed = createAgentInput.parse({ ...base, role });
		expect(parsed.role).toBe(role);
	});

	it("rejects a role over the max length", () => {
		expect(() =>
			createAgentInput.parse({ ...base, role: "a".repeat(281) }),
		).toThrow();
	});
});

describe("createAgentInput model / reasoningEffort", () => {
	const base = { projectId: "cat-1", name: "Scout" };

	it("defaults both to undefined when omitted", () => {
		const parsed = createAgentInput.parse(base);
		expect(parsed.model).toBeUndefined();
		expect(parsed.reasoningEffort).toBeUndefined();
	});

	it("trims model and treats an empty string as unset", () => {
		expect(createAgentInput.parse({ ...base, model: "  opus  " }).model).toBe(
			"opus",
		);
		expect(createAgentInput.parse({ ...base, model: "" }).model).toBeUndefined();
	});

	it("accepts a valid reasoningEffort and rejects an invalid one", () => {
		expect(
			createAgentInput.parse({ ...base, reasoningEffort: "medium" })
				.reasoningEffort,
		).toBe("medium");
		expect(() =>
			createAgentInput.parse({ ...base, reasoningEffort: "extreme" }),
		).toThrow();
	});
});

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
