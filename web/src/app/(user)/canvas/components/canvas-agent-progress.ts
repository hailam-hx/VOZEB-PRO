export type CanvasAgentStableStageKey = "planning" | "skills" | "plan" | "executing" | "reviewing" | "finalizing" | "paused";
export type CanvasAgentRunStageKey = CanvasAgentStableStageKey | "reconnecting";

export type CanvasAgentRunStage = {
    key: CanvasAgentRunStageKey;
    text: string;
    resumeKey?: CanvasAgentStableStageKey;
};

export type CanvasAgentProgressStep = {
    key: "canvas" | "skills" | "plan" | "execute" | "review" | "deliver";
    status: "pending" | "running" | "completed" | "paused";
};

const definitions: Array<Pick<CanvasAgentProgressStep, "key">> = [{ key: "canvas" }, { key: "skills" }, { key: "plan" }, { key: "execute" }, { key: "review" }, { key: "deliver" }];

export function canvasAgentProgressSteps(stage: CanvasAgentRunStage): CanvasAgentProgressStep[] {
    const activeKey = stage.key === "reconnecting" ? stage.resumeKey || "planning" : stage.key;
    const activeIndex = activeKey === "planning" ? 0 : activeKey === "skills" ? 1 : activeKey === "plan" ? 2 : activeKey === "executing" || activeKey === "paused" ? 3 : activeKey === "reviewing" ? 4 : 5;
    return definitions.map((step, index) => ({
        ...step,
        status: index < activeIndex ? "completed" : index > activeIndex ? "pending" : activeKey === "paused" ? "paused" : "running",
    }));
}
