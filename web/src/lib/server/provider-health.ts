import type { SafeProviderStreamError } from "./text-stream-diagnostics";
import { PROVIDER_HEALTH_POLICY, type ProviderHealthPolicy } from "./provider-health-policy";

export type ProviderCircuitState = "closed" | "degraded" | "open" | "half_open";
export type ProviderHealthFailureClass = "provider_transient" | "model_availability" | "auth_config" | "request_invalid" | "business" | "cancellation" | "unknown";
export type ProviderHealthScope = "binding" | "channel";

export type ProviderRouteIdentity = {
    provider: string;
    channelId: string;
    model: string;
};

export type ProviderHealthFailureInput = {
    providerError?: SafeProviderStreamError;
    status?: number;
    error?: unknown;
    cancelled?: boolean;
    domain?: "billing" | "business";
};

export type ProviderHealthRecord = ProviderRouteIdentity & {
    bindingKey: string;
    scope: ProviderHealthScope;
    state: ProviderCircuitState;
    consecutiveFailures: number;
    consecutiveSuccesses: number;
    windowFailures: number;
    windowSuccesses: number;
    windowStartedAt: number;
    lastFailureAt?: number;
    lastSuccessAt?: number;
    openedAt?: number;
    cooldownUntil?: number;
    openCount: number;
    lastFailureClass?: ProviderHealthFailureClass;
    lastProviderErrorType?: string;
    lastProviderErrorCode?: string;
    lastProviderStatus?: number;
    halfOpenProbeInFlight: boolean;
    halfOpenProbeUntil?: number;
    independentModels: string[];
    updatedAt: number;
    expiresAt: number;
};

export type ProviderHealthClassification = {
    failureClass: ProviderHealthFailureClass;
    countsTowardCircuit: boolean;
    countsTowardChannel: boolean;
    openImmediately: boolean;
    providerError?: SafeProviderStreamError;
    status?: number;
};

export type ProviderRouteDecision = {
    identity: ProviderRouteIdentity;
    eligible: boolean;
    probe: boolean;
    state: ProviderCircuitState;
    reason?: "circuit_open" | "half_open_probe_in_flight";
    cooldownUntil?: number;
};

type RecordUpdater = (current: ProviderHealthRecord | undefined) => ProviderHealthRecord | undefined;

export interface ProviderHealthStore {
    read(key: string, now: number): Promise<ProviderHealthRecord | undefined>;
    update(key: string, updater: RecordUpdater, now: number): Promise<ProviderHealthRecord | undefined>;
}

export class InMemoryProviderHealthStore implements ProviderHealthStore {
    private readonly records = new Map<string, ProviderHealthRecord>();

    async read(key: string, now: number) {
        const current = this.records.get(key);
        if (current && current.expiresAt <= now) this.records.delete(key);
        return clone(this.records.get(key));
    }

    async update(key: string, updater: RecordUpdater, now: number) {
        const current = this.records.get(key);
        if (current && current.expiresAt <= now) this.records.delete(key);
        const next = updater(clone(this.records.get(key)));
        if (next) this.records.set(key, clone(next)!);
        else this.records.delete(key);
        return clone(next);
    }

    clear() {
        this.records.clear();
    }
}

export class ProviderHealthService {
    constructor(
        private readonly store: ProviderHealthStore,
        private readonly policy: ProviderHealthPolicy = PROVIDER_HEALTH_POLICY,
        private readonly logger: Pick<Console, "info"> | undefined = undefined,
    ) {}

    async get(identity: ProviderRouteIdentity, now = Date.now()) {
        return (await this.store.read(bindingKey(identity), now)) || emptyRecord(identity, "binding", now, this.policy);
    }

    async getChannel(identity: ProviderRouteIdentity, now = Date.now()) {
        return (await this.store.read(channelKey(identity), now)) || emptyRecord({ ...identity, model: "*" }, "channel", now, this.policy);
    }

    async success(identity: ProviderRouteIdentity, now = Date.now()) {
        const binding = await this.observeSuccess(identity, "binding", now);
        await this.observeSuccess({ ...identity, model: "*" }, "channel", now);
        return binding;
    }

    async failure(identity: ProviderRouteIdentity, input: ProviderHealthFailureInput, now = Date.now()) {
        const classification = classifyProviderHealthFailure(input);
        if (!classification.countsTowardCircuit) return this.get(identity, now);
        const binding = await this.observeFailure(identity, "binding", classification, now, identity.model);
        if (classification.countsTowardChannel) await this.observeFailure({ ...identity, model: "*" }, "channel", classification, now, identity.model);
        return binding;
    }

    async rank<T extends ProviderRouteIdentity>(candidates: T[], now = Date.now()) {
        const evaluated = await Promise.all(
            candidates.map(async (identity, index) => {
                const binding = await this.get(identity, now);
                const channel = await this.getChannel(identity, now);
                const blocking = blockingRecord(binding, channel, now);
                const eligible = !blocking;
                const state = blocking?.state || (binding.state === "degraded" || channel.state === "degraded" ? "degraded" : binding.state);
                return {
                    candidate: identity,
                    index,
                    score: eligible ? (state === "degraded" ? 1 : 0) : 2,
                    decision: {
                        identity,
                        eligible,
                        probe: false,
                        state,
                        ...(blocking ? { reason: blocking.state === "half_open" ? ("half_open_probe_in_flight" as const) : ("circuit_open" as const), cooldownUntil: blocking.cooldownUntil } : {}),
                    } satisfies ProviderRouteDecision,
                };
            }),
        );
        evaluated.sort((a, b) => a.score - b.score || a.index - b.index);
        return { candidates: evaluated.map((item) => item.candidate), decisions: evaluated.map((item) => item.decision) };
    }

    async acquire(identity: ProviderRouteIdentity, now = Date.now()): Promise<ProviderRouteDecision> {
        const channel = await this.getChannel(identity, now);
        const channelDecision = await this.acquireRecord({ ...identity, model: "*" }, "channel", channel, now);
        if (!channelDecision.eligible) return { ...channelDecision, identity };
        const binding = await this.get(identity, now);
        const bindingDecision = await this.acquireRecord(identity, "binding", binding, now);
        if (!bindingDecision.eligible && channelDecision.probe) await this.releaseProbe({ ...identity, model: "*" }, "channel", now);
        return bindingDecision;
    }

    async selectForDispatch<T extends ProviderRouteIdentity>(candidates: T[], now = Date.now()) {
        const { candidates: ranked } = await this.rank(candidates, now);
        for (const identity of ranked) {
            const decision = await this.acquire(identity, now);
            if (decision.eligible) return decision;
        }
        return null;
    }

    private async acquireRecord(identity: ProviderRouteIdentity, scope: ProviderHealthScope, snapshot: ProviderHealthRecord, now: number): Promise<ProviderRouteDecision> {
        if (snapshot.state === "closed" || snapshot.state === "degraded") return { identity, eligible: true, probe: false, state: snapshot.state };
        const key = scope === "binding" ? bindingKey(identity) : channelKey(identity);
        let claimed = false;
        const next = await this.store.update(
            key,
            (current) => {
                const value = current || snapshot;
                const activeProbe = value.state === "half_open" && (value.halfOpenProbeUntil || 0) > now;
                const cooling = value.state === "open" && (value.cooldownUntil || 0) > now;
                if (activeProbe || cooling) return value;
                claimed = true;
                return { ...value, state: "half_open", halfOpenProbeInFlight: true, halfOpenProbeUntil: now + this.policy.halfOpenLeaseMs, updatedAt: now, expiresAt: now + this.policy.stateTtlMs };
            },
            now,
        );
        if (claimed) {
            this.logger?.info("provider_half_open_probe", safeLog(next!));
            return { identity, eligible: true, probe: true, state: "half_open" };
        }
        return {
            identity,
            eligible: false,
            probe: false,
            state: next?.state || snapshot.state,
            reason: next?.state === "half_open" ? "half_open_probe_in_flight" : "circuit_open",
            cooldownUntil: next?.cooldownUntil,
        };
    }

    private async releaseProbe(identity: ProviderRouteIdentity, scope: ProviderHealthScope, now: number) {
        const key = scope === "binding" ? bindingKey(identity) : channelKey(identity);
        await this.store.update(key, (current) => (current?.state === "half_open" ? { ...current, state: "open", halfOpenProbeInFlight: false, halfOpenProbeUntil: undefined } : current), now);
    }

    private async observeSuccess(identity: ProviderRouteIdentity, scope: ProviderHealthScope, now: number) {
        const key = scope === "binding" ? bindingKey(identity) : channelKey(identity);
        const observation: { previousState: ProviderCircuitState } = { previousState: "closed" };
        const next = await this.store.update(
            key,
            (current) => {
                const base = normalizedWindow(current || emptyRecord(identity, scope, now, this.policy), now, this.policy);
                observation.previousState = base.state;
                const consecutiveSuccesses = base.consecutiveSuccesses + 1;
                const recovered = base.state === "half_open" || base.state === "open" || (base.state === "degraded" && consecutiveSuccesses >= this.policy.degradedRecoverySuccesses);
                return {
                    ...base,
                    state: recovered ? "closed" : base.state,
                    consecutiveFailures: recovered ? 0 : base.consecutiveFailures,
                    consecutiveSuccesses,
                    windowSuccesses: base.windowSuccesses + 1,
                    lastSuccessAt: now,
                    cooldownUntil: recovered ? undefined : base.cooldownUntil,
                    halfOpenProbeInFlight: false,
                    halfOpenProbeUntil: undefined,
                    independentModels: recovered ? [] : base.independentModels,
                    updatedAt: now,
                    expiresAt: now + this.policy.stateTtlMs,
                };
            },
            now,
        );
        if (next && observation.previousState !== next.state) {
            this.logger?.info(observation.previousState === "half_open" || observation.previousState === "open" ? "provider_circuit_recovered" : "provider_health_observation", {
                ...safeLog(next),
                previousState: observation.previousState,
                nextState: next.state,
                result: "success",
                ...(next.openedAt ? { downtimeMs: now - next.openedAt } : {}),
            });
        }
        return next!;
    }

    private async observeFailure(identity: ProviderRouteIdentity, scope: ProviderHealthScope, classification: ProviderHealthClassification, now: number, observedModel: string) {
        const key = scope === "binding" ? bindingKey(identity) : channelKey(identity);
        const observation: { previousState: ProviderCircuitState } = { previousState: "closed" };
        const next = await this.store.update(
            key,
            (current) => {
                const base = normalizedWindow(current || emptyRecord(identity, scope, now, this.policy), now, this.policy);
                observation.previousState = base.state;
                const independentModels = scope === "channel" ? Array.from(new Set([...base.independentModels, normalize(observedModel)])) : [];
                const consecutiveFailures = base.consecutiveFailures + 1;
                const windowFailures = base.windowFailures + 1;
                const samples = windowFailures + base.windowSuccesses;
                const thresholdReached = consecutiveFailures >= this.policy.consecutiveFailures || (samples >= this.policy.minSamples && windowFailures / samples >= this.policy.failureRatio);
                const channelStrong = scope === "binding" || independentModels.length >= this.policy.channelMinIndependentModels;
                const shouldOpen = channelStrong && (classification.openImmediately || base.state === "half_open" || thresholdReached);
                const openCount = shouldOpen ? base.openCount + 1 : base.openCount;
                const cooldown = classification.failureClass === "auth_config" ? this.policy.authCooldownMs : Math.min(this.policy.maxCooldownMs, this.policy.initialCooldownMs * 2 ** Math.max(0, openCount - 1));
                return {
                    ...base,
                    state: shouldOpen ? "open" : "degraded",
                    consecutiveFailures,
                    consecutiveSuccesses: 0,
                    windowFailures,
                    lastFailureAt: now,
                    openedAt: shouldOpen ? base.openedAt || now : base.openedAt,
                    cooldownUntil: shouldOpen ? now + cooldown : undefined,
                    openCount,
                    lastFailureClass: classification.failureClass,
                    lastProviderErrorType: classification.providerError?.type,
                    lastProviderErrorCode: classification.providerError?.code,
                    lastProviderStatus: classification.providerError?.status ?? classification.status,
                    halfOpenProbeInFlight: false,
                    halfOpenProbeUntil: undefined,
                    independentModels,
                    updatedAt: now,
                    expiresAt: now + this.policy.stateTtlMs,
                };
            },
            now,
        );
        if (next && (observation.previousState !== next.state || next.state === "open")) {
            this.logger?.info("provider_health_observation", { ...safeLog(next), result: "failure", failureClass: classification.failureClass, previousState: observation.previousState, nextState: next.state });
        }
        return next!;
    }
}

export function classifyProviderHealthFailure(input: ProviderHealthFailureInput): ProviderHealthClassification {
    if (input.cancelled) return classification("cancellation", false, false, false, input);
    if (input.domain) return classification("business", false, false, false, input);
    const providerError = input.providerError;
    const status = providerError?.status ?? input.status;
    const code = normalize(providerError?.code || providerError?.type || "");
    if (status === 401 || status === 403 || /auth|unauthor|forbidden|credential|api_key/.test(code)) return classification("auth_config", true, true, true, input);
    if (/model.*(?:unavailable|not_found|overload)|capacity/.test(code)) return classification("model_availability", true, false, false, input);
    if (status === 400 || status === 404 || status === 405 || status === 413 || status === 415 || status === 422 || /invalid_request|unsupported|malformed|bad_request/.test(code)) return classification("request_invalid", false, false, false, input);
    if (status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500) || /overload|rate_limit|internal|unavailable|timeout|gateway/.test(code)) return classification("provider_transient", true, true, false, input);
    const errorRecord = input.error && typeof input.error === "object" ? (input.error as { name?: unknown; message?: unknown; code?: unknown; cause?: { code?: unknown; message?: unknown } }) : undefined;
    const errorFallback = normalize([errorRecord?.name, errorRecord?.message, errorRecord?.code, errorRecord?.cause?.code, errorRecord?.cause?.message].filter((value) => typeof value === "string").join(" "));
    if (/timeout|network|socket|fetch|connection|econnreset|econnrefused|enotfound|etimedout/.test(errorFallback)) return classification("provider_transient", true, true, false, input);
    return classification("unknown", false, false, false, input);
}

export function providerRouteIdentity(input: { channelId?: string; model: string; apiFormat?: string; advancedConfig?: { protocol?: string } }): ProviderRouteIdentity | undefined {
    const channelId = input.channelId?.trim();
    const model = input.model.trim();
    if (!channelId || !model) return undefined;
    return { provider: normalize(input.advancedConfig?.protocol || input.apiFormat || "unknown"), channelId, model };
}

export function bindingKey(identity: ProviderRouteIdentity) {
    return `binding:${normalize(identity.provider)}:${normalize(identity.channelId)}:${normalize(identity.model)}`;
}

export function channelKey(identity: ProviderRouteIdentity) {
    return `channel:${normalize(identity.provider)}:${normalize(identity.channelId)}`;
}

function classification(failureClass: ProviderHealthFailureClass, countsTowardCircuit: boolean, countsTowardChannel: boolean, openImmediately: boolean, input: ProviderHealthFailureInput): ProviderHealthClassification {
    return { failureClass, countsTowardCircuit, countsTowardChannel, openImmediately, providerError: input.providerError, status: input.status };
}

function emptyRecord(identity: ProviderRouteIdentity, scope: ProviderHealthScope, now: number, policy: ProviderHealthPolicy): ProviderHealthRecord {
    return {
        ...identity,
        bindingKey: scope === "binding" ? bindingKey(identity) : channelKey(identity),
        scope,
        state: "closed",
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        windowFailures: 0,
        windowSuccesses: 0,
        windowStartedAt: now,
        openCount: 0,
        halfOpenProbeInFlight: false,
        independentModels: [],
        updatedAt: now,
        expiresAt: now + policy.stateTtlMs,
    };
}

function normalizedWindow(record: ProviderHealthRecord, now: number, policy: ProviderHealthPolicy) {
    if (now - record.windowStartedAt <= policy.windowMs) return record;
    return { ...record, windowStartedAt: now, windowFailures: 0, windowSuccesses: 0, consecutiveFailures: 0, consecutiveSuccesses: 0, independentModels: [] };
}

function blockingRecord(binding: ProviderHealthRecord, channel: ProviderHealthRecord, now: number) {
    return [binding, channel].find((record) => (record.state === "open" && (record.cooldownUntil || 0) > now) || (record.state === "half_open" && (record.halfOpenProbeUntil || 0) > now));
}

function safeLog(record: ProviderHealthRecord) {
    return {
        bindingKey: record.bindingKey,
        provider: record.provider,
        channelId: record.channelId,
        model: record.model,
        state: record.state,
        consecutiveFailures: record.consecutiveFailures,
        cooldownUntil: record.cooldownUntil,
        lastFailureClass: record.lastFailureClass,
        lastProviderErrorType: record.lastProviderErrorType,
        lastProviderErrorCode: record.lastProviderErrorCode,
        lastProviderStatus: record.lastProviderStatus,
    };
}

function normalize(value: string) {
    return value.trim().toLowerCase();
}

function clone<T>(value: T | undefined): T | undefined {
    return value === undefined ? undefined : structuredClone(value);
}
