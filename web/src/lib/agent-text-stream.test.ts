import { describe, expect, it } from "vitest";
import { agentTextStatusText, applyAgentTextEvent, createAgentTextTracker, type AgentTextState } from "./agent-text-stream";

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

    it("does not retire an unseen current attempt when an older restore arrives after its event", () => {
        const states: AgentTextState[] = [];
        const tracker = createAgentTextTracker("run", (_id, state) => states.push(state));
        tracker.event(frame("current", 0, ""), true);
        tracker.restore([{ id: "parent", type: "text", activeAttemptId: "old", textRevision: 8, visibleTextSnapshot: { attemptId: "old", revision: 8, content: "旧内容", status: "failed" } }]);
        tracker.event(frame("current", 1, "新内容"));
        expect(states.at(-1)).toMatchObject({ activeAttemptId: "current", visibleTextSnapshot: { content: "新内容" } });
        expect(states.some((state) => state.activeAttemptId === "old")).toBe(false);
    });

    it("restores an independently versioned old partial at the same retry revision", () => {
        const states: AgentTextState[] = [];
        const tracker = createAgentTextTracker("run", (_id, state) => states.push(state));
        tracker.event(frame("retry", 0, ""), true);
        tracker.restore([{ id: "parent", type: "text", activeAttemptId: "retry", textRevision: 0, visibleTextSnapshot: { attemptId: "old", revision: 8, content: "保留的旧内容", status: "failed" } }]);
        expect(states.at(-1)).toMatchObject({ activeAttemptId: "retry", textRevision: 0, visibleTextSnapshot: { attemptId: "old", content: "保留的旧内容" } });
        tracker.event(frame("retry", 1, "新内容"));
        tracker.restore([{ id: "parent", type: "text", activeAttemptId: "retry", textRevision: 0, visibleTextSnapshot: { attemptId: "old", revision: 9, content: "迟到旧内容", status: "failed" } }]);
        expect(states.at(-1)?.visibleTextSnapshot?.content).toBe("新内容");
    });
});
