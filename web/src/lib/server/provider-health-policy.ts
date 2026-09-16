export type ProviderHealthPolicy = {
    windowMs: number;
    minSamples: number;
    failureRatio: number;
    consecutiveFailures: number;
    degradedRecoverySuccesses: number;
    initialCooldownMs: number;
    maxCooldownMs: number;
    authCooldownMs: number;
    halfOpenLeaseMs: number;
    halfOpenMaxProbes: number;
    stateTtlMs: number;
    channelMinIndependentModels: number;
};

const DEFAULT_PROVIDER_HEALTH_POLICY: ProviderHealthPolicy = {
    windowMs: 5 * 60_000,
    minSamples: 5,
    failureRatio: 0.6,
    consecutiveFailures: 3,
    degradedRecoverySuccesses: 2,
    initialCooldownMs: 60_000,
    maxCooldownMs: 10 * 60_000,
    authCooldownMs: 10 * 60_000,
    halfOpenLeaseMs: 60_000,
    halfOpenMaxProbes: 1,
    stateTtlMs: 30 * 60_000,
    channelMinIndependentModels: 2,
};

export const PROVIDER_HEALTH_POLICY = providerHealthPolicyFromEnv(process.env);

export function providerHealthPolicyFromEnv(environment: Partial<Record<string, string | undefined>>): ProviderHealthPolicy {
    const initialCooldownMs = positive(environment.PROVIDER_CIRCUIT_COOLDOWN_MS, DEFAULT_PROVIDER_HEALTH_POLICY.initialCooldownMs);
    return {
        windowMs: positive(environment.PROVIDER_HEALTH_WINDOW_MS, DEFAULT_PROVIDER_HEALTH_POLICY.windowMs),
        minSamples: positive(environment.PROVIDER_HEALTH_MIN_SAMPLES, DEFAULT_PROVIDER_HEALTH_POLICY.minSamples),
        failureRatio: ratio(environment.PROVIDER_HEALTH_FAILURE_RATIO, DEFAULT_PROVIDER_HEALTH_POLICY.failureRatio),
        consecutiveFailures: positive(environment.PROVIDER_HEALTH_CONSECUTIVE_FAILURES, DEFAULT_PROVIDER_HEALTH_POLICY.consecutiveFailures),
        degradedRecoverySuccesses: positive(environment.PROVIDER_HEALTH_RECOVERY_SUCCESSES, DEFAULT_PROVIDER_HEALTH_POLICY.degradedRecoverySuccesses),
        initialCooldownMs,
        maxCooldownMs: Math.max(initialCooldownMs, positive(environment.PROVIDER_CIRCUIT_MAX_COOLDOWN_MS, DEFAULT_PROVIDER_HEALTH_POLICY.maxCooldownMs)),
        authCooldownMs: positive(environment.PROVIDER_AUTH_COOLDOWN_MS, DEFAULT_PROVIDER_HEALTH_POLICY.authCooldownMs),
        halfOpenLeaseMs: positive(environment.PROVIDER_HALF_OPEN_LEASE_MS, DEFAULT_PROVIDER_HEALTH_POLICY.halfOpenLeaseMs),
        halfOpenMaxProbes: Math.min(1, positive(environment.PROVIDER_HALF_OPEN_MAX_PROBES, DEFAULT_PROVIDER_HEALTH_POLICY.halfOpenMaxProbes)),
        stateTtlMs: positive(environment.PROVIDER_HEALTH_STATE_TTL_MS, DEFAULT_PROVIDER_HEALTH_POLICY.stateTtlMs),
        channelMinIndependentModels: positive(environment.PROVIDER_CHANNEL_MIN_MODELS, DEFAULT_PROVIDER_HEALTH_POLICY.channelMinIndependentModels),
    };
}

function positive(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function ratio(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}
