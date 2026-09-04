import { describe, expect, it } from "vitest";

import * as generationRuntime from "./generation-runtime.mjs";

const { generationRuntimeEnvironment, resolveGenerationWorkerOrigin } = generationRuntime;

describe("generation runtime environment", () => {
    it("uses distinct configured maintenance and worker tokens", () => {
        const maintenanceToken = "a".repeat(32);
        const workerToken = "b".repeat(32);
        const result = generationRuntimeEnvironment({ environment: { VOZEB_PRO_MAINTENANCE_TOKEN: maintenanceToken, VOZEB_PRO_WORKER_TOKEN: workerToken, PORT: "3100" } });

        expect(result).toMatchObject({ ephemeralToken: false, environment: { VOZEB_PRO_MAINTENANCE_TOKEN: maintenanceToken, VOZEB_PRO_WORKER_TOKEN: workerToken, VOZEB_PRO_WORKER_API_ORIGIN: "http://127.0.0.1:3100" } });
    });

    it("generates a process-local token only for development", () => {
        const result = generationRuntimeEnvironment({ environment: {}, allowEphemeralToken: true });

        expect(result.ephemeralToken).toBe(true);
        expect(result.environment.VOZEB_PRO_MAINTENANCE_TOKEN).toHaveLength(64);
        expect(result.environment.VOZEB_PRO_WORKER_TOKEN).toHaveLength(64);
        expect(result.environment.VOZEB_PRO_WORKER_TOKEN).not.toBe(result.environment.VOZEB_PRO_MAINTENANCE_TOKEN);
    });

    it("fails production startup before the app can run without a valid token", () => {
        expect(() => generationRuntimeEnvironment({ environment: { VOZEB_PRO_MAINTENANCE_TOKEN: "short", VOZEB_PRO_WORKER_TOKEN: "b".repeat(32) } })).toThrow("distinct and contain at least 32 characters");
        expect(() => generationRuntimeEnvironment({ environment: { VOZEB_PRO_MAINTENANCE_TOKEN: "a".repeat(32), VOZEB_PRO_WORKER_TOKEN: "a".repeat(32) } })).toThrow("distinct and contain at least 32 characters");
    });

    it("normalizes a Render private hostport to an HTTP origin", () => {
        expect(resolveGenerationWorkerOrigin({ environment: { VOZEB_PRO_WORKER_API_ORIGIN: "vozeb-pro:3000" } })).toBe("http://vozeb-pro:3000");
    });

    it("maps the copied Docker data directory to the source workspace", () => {
        expect(generationRuntime.resolveSourceDevelopmentDataDir?.("/app/web/.data", "/workspace/web")).toBe("/workspace/web/.data");
    });

    it("preserves a custom source-development data directory", () => {
        expect(generationRuntime.resolveSourceDevelopmentDataDir?.("/srv/vozeb-data", "/workspace/web")).toBe("/srv/vozeb-data");
    });

    it("anchors a relative data directory to the source workspace", () => {
        expect(generationRuntime.resolveSourceDevelopmentDataDir?.(".data", "/workspace/web")).toBe("/workspace/web/.data");
    });
});
