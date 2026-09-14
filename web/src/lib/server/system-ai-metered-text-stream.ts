import { createStreamingUsageAccumulator } from "@/lib/server/usage-billing-adapter";
import { attachUsageProviderEvidence, finishUsageProviderAttempt, settleCancelledUsageBilling, type UsageBilling } from "@/lib/server/usage-billing-runtime";
import { TEXT_STREAM_COMPLETED, TEXT_STREAM_FAILED } from "./text-sse-decoder";

export function meteredTextResponseBody(body: ReadableStream<Uint8Array>, billing: UsageBilling, attemptNumber: number) {
    const reader = body.getReader();
    const accumulator = createStreamingUsageAccumulator("text", billing.snapshot.requestUsage);
    let finalized = false;
    let cancelled = false;
    const finalize = async (status: "succeeded" | "failed" | "canceled") => {
        if (finalized) return;
        finalized = true;
        const usage = accumulator.finish();
        try {
            if (status === "succeeded") {
                if (usage) await attachUsageProviderEvidence({ billing, attemptNumber, usage });
            } else {
                await finishUsageProviderAttempt({ billing, attemptNumber, status, normalizedUsage: usage });
                if (status === "canceled") await settleCancelledUsageBilling({ billing, description: "用户取消已由上游接受的文本生成", ...(usage?.source === "actual" ? { actualUsage: usage } : usage ? { derivedUsage: usage } : {}) });
            }
        } catch (error) {
            console.error("System API text usage settlement failed", error instanceof Error ? error.message : error);
        }
    };
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const next = await reader.read();
                if (cancelled) return;
                if (next.done) {
                    await finalize("succeeded");
                    controller.close();
                    return;
                }
                accumulator.push(next.value);
                controller.enqueue(next.value);
            } catch (error) {
                if (cancelled) return;
                await finalize("failed");
                controller.error(error);
            }
        },
        async cancel(reason) {
            cancelled = true;
            try {
                await reader.cancel(reason);
            } finally {
                // HTTP disconnects cannot carry our local cleanup Symbol across processes.
                await finalize(accumulator.terminalStatus() || (reason === TEXT_STREAM_COMPLETED ? "succeeded" : reason === TEXT_STREAM_FAILED ? "failed" : "canceled"));
                reader.releaseLock();
            }
        },
    });
}
