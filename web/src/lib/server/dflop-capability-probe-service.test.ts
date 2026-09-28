import { describe, expect, it, vi } from "vitest";

import { parseDflopPricing } from "@/lib/dflop-pricing";
import { runDflopGptImageCapabilityProbe, runDflopQwenSizeProbe } from "./dflop-capability-probe-service";

const channel = { id: "dflop", baseUrl: "https://api.dflop.top/v1", apiKey: "secret" };
const syncedAt = "2026-09-24T00:00:00.000Z";

describe("DFLOP controlled capability probes", () => {
    it("classifies a Responses tool_not_supported error without retrying", async () => {
        const fetcher = vi.fn(async () => json({ error: { code: "tool_not_supported", message: "unsupported" } }, 400, { "x-gateway-trace": "trace-gpt" }));
        const profile = parseDflopPricing({ input_per_1m: "10", output_per_1m: "20", price_per_image: "30", supports_image_gen: true }, { modelId: "gpt-6", category: "text", syncedAt });

        const result = await runDflopGptImageCapabilityProbe({ channel, bindingId: "binding-gpt", modelId: "gpt-6", profile, fetcher, now: () => "2026-09-24T01:00:00.000Z" });

        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ outcome: "unsupported", supported: false, statusCode: 400, upstreamErrorCode: "tool_not_supported", requestId: "trace-gpt", billingEvidence: { basis: "unresolved", authoritative: false } });
    });

    it("uses the exact call-log cost to prove token-only Responses billing", async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(
                streamResponse(
                    [{ type: "response.completed", response: { output: [{ type: "image_generation_call", result: "..." }], usage: { input_tokens: 1_000_000, output_tokens: 1_000_000, input_tokens_details: { cached_tokens: 0 } } } }],
                    "trace-token",
                ),
            )
            .mockResolvedValueOnce(json({ data: [{ id: 7, request_id: "trace-token", status: "success", input_tokens: 1_000_000, output_tokens: 1_000_000, cached_tokens: 0, unit_type: null, unit_count: null, cost: "30" }] }));
        const profile = parseDflopPricing({ input_per_1m: "10", output_per_1m: "20", price_per_image: "30", supports_image_gen: true }, { modelId: "gpt-6", category: "text", syncedAt });

        const result = await runDflopGptImageCapabilityProbe({ channel, bindingId: "binding-gpt", modelId: "gpt-6", profile, fetcher, now: () => "2026-09-24T01:00:00.000Z" });

        expect(result).toMatchObject({
            outcome: "supported",
            usageSeen: true,
            imageOutputSeen: true,
            requestId: "trace-token",
            billingEvidence: { basis: "token_only", authoritative: true, source: "provider_task_record", providerUsageRecordId: "7", providerCost: "30" },
        });
    });

    it("runs Qwen requested sizes serially and builds a mapping only from exact billed costs", async () => {
        let active = 0;
        let maxActive = 0;
        const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            const target = String(url);
            let response: Response;
            if (target.includes("/logs?")) {
                const ref = new URL(target).searchParams.get("ref")!;
                const size = ref.replace("trace-", "");
                const large = ["1536x1536", "2048x2048", "2560x2560"].includes(size);
                response = json({ data: [{ id: `log-${size}`, request_id: ref, status: "success", unit_type: "image", unit_count: 1, cost: large ? "30" : "15" }] });
            } else {
                const body = JSON.parse(String(init?.body));
                response = json({ data: [{ url: "https://cdn.example/image.png", size: body.size }], usage: { generated_images: 1 } }, 200, { "x-gateway-trace": `trace-${body.size}` });
            }
            active -= 1;
            return response;
        });
        const profile = parseDflopPricing({ price_per_image: "15", price_per_image_large: "30", price_per_input_image: "1.2" }, { modelId: "qwen-image-3.0-pro", category: "image", endpointType: "images_generations", syncedAt });

        const result = await runDflopQwenSizeProbe({ channel, bindingId: "binding-qwen", modelId: "qwen-image-3.0-pro", profile, fetcher, now: () => "2026-09-24T01:00:00.000Z", idempotencyKey: (size) => `probe-${size}` });

        expect(maxActive).toBe(1);
        expect(result.cases).toHaveLength(7);
        expect(result.billingEvidence).toMatchObject({
            basis: "size_tier",
            authoritative: true,
            source: "provider_task_record",
            sizeTierByRequestSize: { "512x512": "1K", "1024x1024": "1K", "1024x1536": "1K", "1536x1024": "1K", "1536x1536": "2K", "2048x2048": "2K", "2560x2560": "2K" },
        });
        expect(fetcher.mock.calls.filter(([url]) => !String(url).includes("/logs?")).map(([, init]) => (init?.headers as Record<string, string>)["Idempotency-Key"])).toEqual([
            "probe-512x512",
            "probe-1024x1024",
            "probe-1024x1536",
            "probe-1536x1024",
            "probe-1536x1536",
            "probe-2048x2048",
            "probe-2560x2560",
        ]);
    });

    it("keeps Qwen billing unresolved when a successful image has no authoritative log", async () => {
        const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
            if (String(url).includes("/logs?")) return json({ data: [] });
            const body = JSON.parse(String(init?.body));
            return json({ data: [{ url: "https://cdn.example/image.png", size: body.size }] }, 200, { "x-gateway-trace": `trace-${body.size}` });
        });
        const profile = parseDflopPricing({ price_per_image: "15", price_per_image_large: "30", price_per_input_image: "1.2" }, { modelId: "qwen-image-3.0-pro", category: "image", endpointType: "images_generations", syncedAt });

        const result = await runDflopQwenSizeProbe({ channel, bindingId: "binding-qwen", modelId: "qwen-image-3.0-pro", profile, fetcher, now: () => "2026-09-24T01:00:00.000Z", idempotencyKey: (size) => `probe-${size}` });

        expect(result.billingEvidence).toMatchObject({ basis: "unresolved", authoritative: false, source: "none" });
    });
});

function json(body: unknown, status = 200, headers?: HeadersInit) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function streamResponse(events: unknown[], trace: string) {
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200, headers: { "Content-Type": "text/event-stream", "x-gateway-trace": trace } });
}
