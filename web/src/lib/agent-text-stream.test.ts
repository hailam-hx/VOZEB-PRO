import { describe, expect, it } from "vitest";
import { agentTextStatusText, applyAgentTextEvent, type AgentTextState } from "./agent-text-stream";

describe("Agent text snapshot replay", () => {
    const frame = (attemptId: string, revision: number, content: string, status = "streaming") => ({ runId: "run", taskId: "child", parentTaskId: "parent", attemptId, revision, content, status });

    it("only accepts active attempts and higher revisions and replaces accumulated content", () => {
        const start: AgentTextState = { activeAttemptId: "a", textRevision: 0 };
        const one = applyAgentTextEvent(start, frame("a", 1, "一"));
        const two = applyAgentTextEvent(one, frame("a", 2, "一二"));
        expect(two.visibleTextSnapshot?.content).toBe("一二");
        expect(applyAgentTextEvent(two, frame("a", 2, "重复"))).toBe(two);
        expect(applyAgentTextEvent(two, frame("a", 1, "倒序"))).toBe(two);
        expect(applyAgentTextEvent(two, frame("old", 90, "过期"))).toBe(two);
    });

    it("retains an old failed partial until a new attempt emits nonempty text", () => {
        const old = applyAgentTextEvent<AgentTextState>({ activeAttemptId: "a", textRevision: 0 }, frame("a", 2, "旧文案", "failed"));
        const retry = { ...old, activeAttemptId: "b", textRevision: 0 };
        const empty = applyAgentTextEvent(retry, frame("b", 1, "", "failed"));
        expect(empty.visibleTextSnapshot).toEqual(old.visibleTextSnapshot);
        expect(applyAgentTextEvent({ ...empty, activeAttemptId: "c", textRevision: 0 }, frame("c", 1, "新文案")).visibleTextSnapshot?.content).toBe("新文案");
    });

    it("labels cancellation immediately even while the attempt's final snapshot is flushing", () => {
        expect(agentTextStatusText({ textStatus: "streaming" }, "cancelled", "en")).toBe("The Agent task was cancelled.");
    });
});
