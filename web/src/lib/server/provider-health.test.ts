import { beforeEach, describe, expect, it } from "vitest";

import { InMemoryProviderHealthStore, ProviderHealthService, classifyProviderHealthFailure, type ProviderRouteIdentity } from "./provider-health";

const routeA: ProviderRouteIdentity = { workloadScope: "text_task", provider: "openai-compatible", channelId: "channel-a", model: "model-a" };
const routeB: ProviderRouteIdentity = { workloadScope: "text_task", provider: "openai-compatible", channelId: "channel-a", model: "model-b" };
const routeC: ProviderRouteIdentity = { workloadScope: "text_task", provider: "anthropic", channelId: "channel-b", model: "model-c" };

describe("provider health circuit breaker", () => {
    let service: ProviderHealthService;

    beforeEach(() => {
        service = new ProviderHealthService(new InMemoryProviderHealthStore());
    });

    it("moves from closed through degraded to open after three transient failures", async () => {
        await service.failure(routeA, { providerError: { kind: "provider_error", code: "overloaded", status: 503 } }, 1_000);
        expect(await service.get(routeA, 1_000)).toMatchObject({ state: "degraded", consecutiveFailures: 1 });
        await service.failure(routeA, { providerError: { kind: "provider_error", code: "overloaded", status: 503 } }, 2_000);
        expect(await service.get(routeA, 2_000)).toMatchObject({ state: "degraded", consecutiveFailures: 2 });
        await service.failure(routeA, { providerError: { kind: "provider_error", code: "overloaded", status: 503 } }, 3_000);
        expect(await service.get(routeA, 3_000)).toMatchObject({ state: "open", consecutiveFailures: 3, cooldownUntil: 63_000 });
    });

    it("skips an open candidate and keeps a healthy lower-priority route first", async () => {
        await open(service, routeA);
        const ranked = await service.rank([routeA, routeC], 4_000);
        expect(ranked.candidates).toEqual([routeC, routeA]);
        expect(ranked.decisions).toContainEqual(expect.objectContaining({ identity: routeA, eligible: false, reason: "circuit_open" }));
    });

    it("allows only one half-open probe after cooldown", async () => {
        await open(service, routeA);
        const attempts = await Promise.all(Array.from({ length: 10 }, () => service.acquire(routeA, 63_001)));
        expect(attempts.filter((attempt) => attempt.eligible && attempt.probe)).toHaveLength(1);
        expect(attempts.filter((attempt) => !attempt.eligible)).toHaveLength(9);
        expect(await service.get(routeA, 63_001)).toMatchObject({ state: "half_open", halfOpenProbeInFlight: true });
    });

    it("closes a half-open circuit after a successful probe", async () => {
        await open(service, routeA);
        await service.acquire(routeA, 63_001);
        await service.success(routeA, 63_100);
        expect(await service.get(routeA, 63_100)).toMatchObject({ state: "closed", consecutiveFailures: 0, halfOpenProbeInFlight: false });
    });

    it("reopens after a failed half-open probe with exponential cooldown", async () => {
        await open(service, routeA);
        await service.acquire(routeA, 63_001);
        await service.failure(routeA, { status: 503 }, 63_100);
        expect(await service.get(routeA, 63_100)).toMatchObject({ state: "open", cooldownUntil: 183_100 });
    });

    it("reopens a channel after a failed half-open probe when the observation window rolled over", async () => {
        await service.failure(routeA, { status: 503 }, 1_000);
        await service.failure(routeA, { status: 503 }, 2_000);
        await service.failure(routeA, { status: 503 }, 3_000);
        await service.failure(routeB, { status: 503 }, 4_000);
        expect(await service.getChannel(routeA, 4_000)).toMatchObject({ state: "open", openCount: 1 });

        expect(await service.acquire(routeB, 306_001)).toMatchObject({ eligible: true });
        expect(await service.getChannel(routeA, 306_001)).toMatchObject({ state: "half_open", halfOpenProbeInFlight: true });

        await service.failure(routeB, { status: 503 }, 306_100);

        expect(await service.getChannel(routeA, 306_100)).toMatchObject({
            state: "open",
            openCount: 2,
            cooldownUntil: 426_100,
            halfOpenProbeInFlight: false,
        });
        expect(await service.acquire(routeB, 306_101)).toMatchObject({ eligible: false, reason: "circuit_open", cooldownUntil: 426_100 });
    });

    it.each([
        ["invalid request", { status: 400 }, "request_invalid"],
        ["user cancellation", { cancelled: true }, "cancellation"],
        ["billing failure", { domain: "billing" as const }, "business"],
    ])("does not trip for %s", async (_name, failure, expectedClass) => {
        expect(classifyProviderHealthFailure(failure)).toMatchObject({ failureClass: expectedClass, countsTowardCircuit: false });
        await service.failure(routeA, failure, 1_000);
        expect(await service.get(routeA, 1_000)).toMatchObject({ state: "closed", consecutiveFailures: 0 });
    });

    it.each([
        ["overload", { providerError: { kind: "provider_error" as const, code: "overloaded", status: 503 } }, "provider_transient"],
        ["provider 5xx", { status: 502 }, "provider_transient"],
        ["socket reset", { error: Object.assign(new Error("socket reset"), { code: "ECONNRESET" }) }, "provider_transient"],
        ["authentication", { providerError: { kind: "provider_error" as const, code: "invalid_api_key", status: 401 } }, "auth_config"],
        ["model unavailable", { providerError: { kind: "provider_error" as const, code: "model_unavailable", status: 503 } }, "model_availability"],
    ])("classifies %s", (_name, failure, expectedClass) => {
        expect(classifyProviderHealthFailure(failure)).toMatchObject({ failureClass: expectedClass, countsTowardCircuit: true });
    });

    it("keeps generic and planner timeout failures provider-transient", () => {
        const timeout = Object.assign(new Error("planner provider timed out"), { name: "TimeoutError" });
        expect(classifyProviderHealthFailure({ error: timeout })).toMatchObject({ failureClass: "provider_transient", countsTowardCircuit: true, countsTowardChannel: true });
    });

    it("opens authentication failures immediately", async () => {
        await service.failure(routeA, { providerError: { kind: "provider_error", code: "invalid_api_key", status: 401 } }, 1_000);
        expect(await service.get(routeA, 1_000)).toMatchObject({ state: "open", lastFailureClass: "auth_config" });
    });

    it("recovers a degraded route after consecutive successes", async () => {
        await service.failure(routeA, { status: 503 }, 1_000);
        await service.success(routeA, 2_000);
        expect(await service.get(routeA, 2_000)).toMatchObject({ state: "degraded", consecutiveSuccesses: 1 });
        await service.success(routeA, 3_000);
        expect(await service.get(routeA, 3_000)).toMatchObject({ state: "closed", consecutiveFailures: 0 });
    });

    it("does not open model B when only model A fails on the same channel", async () => {
        await open(service, routeA);
        expect(await service.get(routeB, 4_000)).toMatchObject({ state: "closed" });
        expect(await service.acquire(routeB, 4_000)).toMatchObject({ eligible: true, probe: false });
    });

    it("isolates planner binding and channel state from text tasks", async () => {
        const plannerRoute = { ...routeA, workloadScope: "planner" as const };
        await open(service, plannerRoute);
        expect(await service.get(plannerRoute, 4_000)).toMatchObject({ state: "open", workloadScope: "planner" });
        expect(await service.get(routeA, 4_000)).toMatchObject({ state: "closed", workloadScope: "text_task" });
        expect(await service.getChannel(routeA, 4_000)).toMatchObject({ state: "closed", workloadScope: "text_task" });
    });

    it("releases a half-open lease without extending its cooldown", async () => {
        await open(service, routeA);
        await service.acquire(routeA, 63_001);
        await service.release(routeA, 63_100);
        expect(await service.get(routeA, 63_100)).toMatchObject({ state: "open", halfOpenProbeInFlight: false });
        expect(await service.acquire(routeA, 63_101)).toMatchObject({ eligible: true, probe: true });
    });

    it("can open channel aggregate only after independent models fail", async () => {
        await service.failure(routeA, { status: 503 }, 1_000);
        await service.failure(routeA, { status: 503 }, 2_000);
        await service.failure(routeA, { status: 503 }, 3_000);
        expect(await service.getChannel(routeA, 3_000)).toMatchObject({ state: "degraded" });
        await service.failure(routeB, { status: 503 }, 4_000);
        await service.failure(routeB, { status: 503 }, 5_000);
        await service.failure(routeB, { status: 503 }, 6_000);
        expect(await service.getChannel(routeA, 6_000)).toMatchObject({ state: "open" });
    });

    it("permits one recovery probe when all candidates are open and a cooldown expired", async () => {
        await open(service, routeA);
        await open(service, routeC);
        const selected = await service.selectForDispatch([routeA, routeC], 63_001);
        expect(selected).toEqual(expect.objectContaining({ identity: routeA, eligible: true, probe: true }));
        const concurrent = await service.selectForDispatch([routeA, routeC], 63_001);
        expect(concurrent).toEqual(expect.objectContaining({ identity: routeC, eligible: true, probe: true }));
        const exhausted = await service.selectForDispatch([routeA, routeC], 63_001);
        expect(exhausted).toBeNull();
    });

    it("expires stale open state after the health TTL", async () => {
        await open(service, routeA);
        expect(await service.get(routeA, 3_000 + 31 * 60_000)).toMatchObject({ state: "closed", consecutiveFailures: 0 });
    });

    it("opens on the configured window failure ratio", async () => {
        await service.success(routeA, 1_000);
        await service.success(routeA, 2_000);
        await service.failure(routeA, { status: 503 }, 3_000);
        await service.failure(routeA, { status: 503 }, 4_000);
        await service.failure(routeA, { status: 503 }, 5_000);
        expect(await service.get(routeA, 5_000)).toMatchObject({ state: "open", windowFailures: 3, windowSuccesses: 2 });
    });
});

async function open(service: ProviderHealthService, identity: ProviderRouteIdentity) {
    await service.failure(identity, { status: 503 }, 1_000);
    await service.failure(identity, { status: 503 }, 2_000);
    await service.failure(identity, { status: 503 }, 3_000);
}
