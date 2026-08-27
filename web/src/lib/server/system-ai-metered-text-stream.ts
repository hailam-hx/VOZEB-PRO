import { createStreamingUsageAccumulator } from "@/lib/server/usage-billing-adapter";
import { attachUsageProviderEvidence, finishUsageProviderAttempt, releaseUsageBilling, settleCancelledUsageBilling, type UsageBilling } from "@/lib/server/usage-billing-runtime";

export function meteredTextResponseBody(body: ReadableStream<Uint8Array>, billing: UsageBilling, attemptNumber: number) {
    const reader = body.getReader();
    const accumulator = createStreamingUsageAccumulator("text", billing.snapshot.requestUsage);
    let finalized = false;
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
                else await releaseUsageBilling({ billing, reason: "上游文本流读取失败" });
            }
        } catch (error) {
            console.error("System API text usage settlement failed", error instanceof Error ? error.message : error);
        }
    };
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const next = await reader.read();
                if (next.done) {
                    await finalize("succeeded");
                    controller.close();
                    return;
                }
                accumulator.push(next.value);
                controller.enqueue(next.value);
            } catch (error) {
                await finalize("failed");
                controller.error(error);
            }
        },
        async cancel(reason) {
            try {
                await reader.cancel(reason);
            } finally {
                await finalize("canceled");
            }
        },
    });
}
