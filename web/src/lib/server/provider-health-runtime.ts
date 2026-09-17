import type { TextTaskConfig } from "./text-task-store";
import type { TextStreamTransportDiagnostic } from "./text-stream-diagnostics";
import { providerRouteIdentity, type ProviderHealthFailureInput, type ProviderHealthWorkloadScope, type ProviderRouteDecision } from "./provider-health";
import { createProviderHealthService } from "./provider-health-store";
import { resolveChannelModelAdvancedConfig } from "@/lib/channel-protocol-registry";

type ResolvedProviderCandidate = { channelId: string; upstreamModel: string; channel: { apiFormat: string; advancedConfig?: Parameters<typeof resolveChannelModelAdvancedConfig>[0] } };

const untrackedDecision: ProviderRouteDecision = {
    identity: { workloadScope: "text_task", provider: "unknown", channelId: "", model: "" },
    eligible: true,
    probe: false,
    state: "closed",
};

export async function rankTextProviderConfigs<T extends TextTaskConfig>(configs: T[], now = Date.now()) {
    const untracked = configs.filter((config) => !providerRouteIdentity(config));
    const tracked = configs.flatMap((config) => {
        const identity = providerRouteIdentity(config);
        return identity ? [{ ...identity, config }] : [];
    });
    if (!tracked.length) return configs;
    try {
        const ranked = await createProviderHealthService().rank(tracked, now);
        return [...untracked, ...ranked.candidates.map((candidate) => candidate.config)];
    } catch (error) {
        console.warn("Provider health ranking unavailable", { error: safeError(error) });
        return configs;
    }
}

export async function rankResolvedProviderCandidates<T extends ResolvedProviderCandidate>(candidates: T[], now = Date.now()) {
    const tracked = candidates.map((candidate) => ({ ...resolvedProviderRouteIdentity(candidate), candidate }));
    try {
        const ranked = await createProviderHealthService().rank(tracked, now);
        return ranked.candidates.map((item) => item.candidate);
    } catch (error) {
        console.warn("Provider health logical routing unavailable", { error: safeError(error) });
        return candidates;
    }
}

export function resolvedProviderRouteIdentity(candidate: ResolvedProviderCandidate, workloadScope: ProviderHealthWorkloadScope = "text_task") {
    return {
        workloadScope,
        provider: resolveChannelModelAdvancedConfig(candidate.channel.advancedConfig, candidate.upstreamModel)?.protocol || candidate.channel.apiFormat,
        channelId: candidate.channelId,
        model: candidate.upstreamModel,
    };
}

export async function rankPlannerProviderCandidates<T extends ResolvedProviderCandidate>(candidates: T[], now = Date.now()) {
    const tracked = candidates.map((candidate) => ({ ...resolvedProviderRouteIdentity(candidate, "planner"), candidate }));
    try {
        const ranked = await createProviderHealthService().rank(tracked, now);
        return ranked.candidates.map((item) => item.candidate);
    } catch (error) {
        console.warn("Planner provider health ranking unavailable", { error: safeError(error) });
        return candidates;
    }
}

export async function acquirePlannerProviderRoute(candidate: ResolvedProviderCandidate, now = Date.now()) {
    return acquireResolvedProviderRoute(candidate, "planner", now);
}

export async function releasePlannerProviderRoute(candidate: ResolvedProviderCandidate, now = Date.now()) {
    const identity = resolvedProviderRouteIdentity(candidate, "planner");
    try {
        await createProviderHealthService().release(identity, now);
    } catch (error) {
        console.warn("Planner provider health probe release unavailable", { workloadScope: "planner", provider: identity.provider, channelId: identity.channelId, model: identity.model, error: safeError(error) });
    }
}

export async function reportPlannerProviderFailure(candidate: ResolvedProviderCandidate, input: ProviderHealthFailureInput, now = Date.now()) {
    const identity = resolvedProviderRouteIdentity(candidate, "planner");
    try {
        await createProviderHealthService().failure(identity, input, now);
    } catch (error) {
        console.warn("Planner provider health failure observation unavailable", { workloadScope: "planner", provider: identity.provider, channelId: identity.channelId, model: identity.model, error: safeError(error) });
    }
}

export async function reportPlannerProviderSuccess(candidate: ResolvedProviderCandidate, now = Date.now()) {
    const identity = resolvedProviderRouteIdentity(candidate, "planner");
    try {
        await createProviderHealthService().success(identity, now);
    } catch (error) {
        console.warn("Planner provider health success observation unavailable", { workloadScope: "planner", provider: identity.provider, channelId: identity.channelId, model: identity.model, error: safeError(error) });
    }
}

async function acquireResolvedProviderRoute(candidate: ResolvedProviderCandidate, workloadScope: ProviderHealthWorkloadScope, now: number) {
    const identity = resolvedProviderRouteIdentity(candidate, workloadScope);
    try {
        const decision = await createProviderHealthService().acquire(identity, now);
        if (!decision.eligible) console.info("provider_route_skipped", { workloadScope, provider: identity.provider, channelId: identity.channelId, model: identity.model, reason: decision.reason, cooldownUntil: decision.cooldownUntil });
        return decision;
    } catch (error) {
        console.warn("Provider health eligibility unavailable", { workloadScope, provider: identity.provider, channelId: identity.channelId, model: identity.model, error: safeError(error) });
        return { identity, eligible: true, probe: false, state: "closed" as const };
    }
}

export async function acquireTextProviderRoute(config: TextTaskConfig, now = Date.now()): Promise<ProviderRouteDecision> {
    const identity = providerRouteIdentity(config);
    if (!identity) return untrackedDecision;
    try {
        const decision = await createProviderHealthService().acquire(identity, now);
        if (!decision.eligible)
            console.info("provider_route_skipped", {
                workloadScope: "text_task",
                provider: identity.provider,
                channelId: identity.channelId,
                model: identity.model,
                reason: decision.reason,
                cooldownUntil: decision.cooldownUntil,
            });
        return decision;
    } catch (error) {
        console.warn("Provider health eligibility unavailable", { workloadScope: "text_task", provider: identity.provider, channelId: identity.channelId, model: identity.model, error: safeError(error) });
        return { identity, eligible: true, probe: false, state: "closed" };
    }
}

export async function reportTextProviderFailure(config: TextTaskConfig, input: { error?: unknown; status?: number; cancelled?: boolean; domain?: "billing" | "business"; transportDiagnostic?: TextStreamTransportDiagnostic }, now = Date.now()) {
    const identity = providerRouteIdentity(config);
    if (!identity) return;
    const observation: ProviderHealthFailureInput = {
        error: input.error,
        status: input.transportDiagnostic?.providerError?.status ?? input.status,
        cancelled: input.cancelled,
        domain: input.domain,
        providerError: input.transportDiagnostic?.providerError,
    };
    try {
        await createProviderHealthService().failure(identity, observation, now);
    } catch (error) {
        console.warn("Provider health failure observation unavailable", { provider: identity.provider, channelId: identity.channelId, model: identity.model, error: safeError(error) });
    }
}

export async function reportTextProviderSuccess(config: TextTaskConfig, now = Date.now()) {
    const identity = providerRouteIdentity(config);
    if (!identity) return;
    try {
        await createProviderHealthService().success(identity, now);
    } catch (error) {
        console.warn("Provider health success observation unavailable", { provider: identity.provider, channelId: identity.channelId, model: identity.model, error: safeError(error) });
    }
}

function safeError(error: unknown) {
    return error instanceof Error ? { name: error.name, message: error.message.slice(0, 300) } : { name: "Error", message: String(error || "unknown").slice(0, 300) };
}
