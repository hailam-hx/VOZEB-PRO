import { describe, expect, it } from "vitest";

import { providerHealthPolicyFromEnv } from "./provider-health-policy";

describe("provider health policy", () => {
    it("loads bounded centralized overrides and falls back for invalid values", () => {
        const policy = providerHealthPolicyFromEnv({
            PROVIDER_HEALTH_WINDOW_MS: "120000",
            PROVIDER_HEALTH_MIN_SAMPLES: "8",
            PROVIDER_HEALTH_FAILURE_RATIO: "0.75",
            PROVIDER_HEALTH_CONSECUTIVE_FAILURES: "4",
            PROVIDER_CIRCUIT_COOLDOWN_MS: "90000",
            PROVIDER_CIRCUIT_MAX_COOLDOWN_MS: "bad",
            PROVIDER_HALF_OPEN_MAX_PROBES: "1",
        });

        expect(policy).toMatchObject({ windowMs: 120_000, minSamples: 8, failureRatio: 0.75, consecutiveFailures: 4, initialCooldownMs: 90_000, maxCooldownMs: 600_000, halfOpenMaxProbes: 1 });
    });
});
