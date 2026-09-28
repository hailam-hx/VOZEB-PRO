import { createHash } from "node:crypto";

import { GENERATION_TRANSPORT_TIMEOUT_MS } from "./generation-http-lifecycle";
import { fetchSafeOutbound } from "./safe-outbound-fetch";
import { parseDflopClipAsrId } from "./dflop-special-video-contract";
import { canonicalJson } from "./video-validation-fingerprint";

type Step = { path: string; body: Record<string, unknown> };

export async function submitDflopSpecialVideoSteps(input: { steps: Step[]; expectedDigest: string; idempotencyKey: string; send: (step: Step, idempotencyKey: string | undefined) => Promise<unknown> }) {
    if (!input.steps.length || !input.expectedDigest || createHash("sha256").update(canonicalJson(input.steps)).digest("hex") !== input.expectedDigest) throw new Error("VALIDATION_EXECUTION_SNAPSHOT_CHANGED");
    let asrId: string | undefined;
    let result: Record<string, unknown> | undefined;
    for (const step of input.steps) {
        if (!["/videos/clip-subtitles", "/videos/generations"].includes(step.path)) throw new Error("SPECIAL_VIDEO_PATH_UNSUPPORTED");
        const body = asrId ? { ...step.body, asr_id: asrId } : step.body;
        if (step.path === "/videos/generations" && body.asr_id === "$ASR_ID") throw new Error("ASR_ID_MISSING");
        const payload = await input.send({ path: step.path, body }, step.path === "/videos/generations" ? input.idempotencyKey : undefined);
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("PROVIDER_RESPONSE_INVALID");
        result = payload as Record<string, unknown>;
        if (step.path === "/videos/clip-subtitles") asrId = parseDflopClipAsrId(payload);
    }
    const taskId = result?.id;
    if (typeof taskId !== "string" || !taskId.trim()) throw new Error("PROVIDER_TASK_ID_MISSING");
    return { taskId: taskId.trim(), status: typeof result?.status === "string" ? result.status : "pending" };
}

export async function postDflopSpecialVideoStep(input: { baseUrl: string; apiKey: string; step: Step; idempotencyKey?: string; fetcher?: typeof fetch }) {
    if (process.env.VITEST && !input.fetcher) throw new Error("TEST_TRANSPORT_REQUIRED");
    if (!input.apiKey) throw new Error("VALIDATION_RUNTIME_CONFIG_MISSING");
    const base = input.baseUrl.replace(/\/+$/, "");
    const root = base.endsWith("/v1") ? base : `${base}/v1`;
    const response = await (input.fetcher || fetchSafeOutbound)(`${root}${input.step.path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json", ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}) },
        body: JSON.stringify(input.step.body),
        signal: AbortSignal.timeout(GENERATION_TRANSPORT_TIMEOUT_MS),
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) throw new Error(`DFLOP_SPECIAL_SUBMISSION_HTTP_${response.status}`);
    return payload;
}
