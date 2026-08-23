import { retryCreativeAgentTask } from "@/services/api/creative";

import type { CanvasNodeData } from "../types";
import type { CanvasAgentOp } from "../utils/canvas-agent-ops";
import { watchCanvasAgentRun, type CanvasAgentRunTranslate } from "./canvas-agent-run-client";

export async function retryCanvasAgentNode(node: CanvasNodeData, applyOps: (ops?: CanvasAgentOp[]) => unknown, translate?: CanvasAgentRunTranslate) {
    const runId = node.metadata?.agentRunId?.trim();
    const taskId = node.metadata?.agentTaskId?.trim();
    if (!runId || !taskId) return false;

    await retryCreativeAgentTask(runId, taskId);
    let failure = "";
    await watchCanvasAgentRun(
        runId,
        {
            onPlan: (ops) => applyOps(ops),
            onAssistant: (text, detail) => {
                if (detail?.runId) failure = text;
            },
            onStage: () => undefined,
            onPaused: () => undefined,
            onOps: (ops) => applyOps(ops),
        },
        { translate },
    );
    if (failure) throw new Error(failure);
    return true;
}
