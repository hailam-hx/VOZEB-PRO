import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const memory = vi.hoisted(() => ({ value: undefined as unknown }));
const TOKEN = "install-token-".padEnd(48, "x");

vi.mock("@/lib/server/database", () => ({
    ensurePostgresSchema: vi.fn(),
    isPostgresDatabaseEnabled: vi.fn(() => false),
    postgresQuery: vi.fn(),
    withPostgresTransaction: vi.fn(),
}));

vi.mock("@/lib/server/data-adapter", () => ({
    readJsonDataFile: vi.fn(async (_fileName: string, fallback: unknown) => memory.value ?? fallback),
    writeJsonDataFile: vi.fn(async (_fileName: string, value: unknown) => {
        memory.value = structuredClone(value);
    }),
}));

import { createFirstAdmin, createUser } from "./store";

describe("first administrator creation", () => {
    beforeEach(() => {
        memory.value = undefined;
        vi.stubEnv("VOZEB_PRO_INSTALL_TOKEN", TOKEN);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("rejects public registration before installation", async () => {
        await expect(createUser({ username: "attacker", password: "password123", policyAccepted: true })).rejects.toMatchObject({ status: 503 });
        expect(memory.value).toBeUndefined();
    });

    it("requires the configured token and creates exactly one administrator", async () => {
        await expect(createFirstAdmin({ username: "admin", password: "password123", installToken: "wrong-token".padEnd(48, "x") })).rejects.toMatchObject({ status: 403 });

        const admin = await createFirstAdmin({ username: "admin", password: "password123", installToken: TOKEN });
        expect(admin).toMatchObject({ role: "admin", settledBalance: "0", heldBalance: "0", availableBalance: "0" });
        await expect(createFirstAdmin({ username: "admin-two", password: "password123", installToken: TOKEN })).rejects.toMatchObject({ status: 409 });

        await expect(createUser({ username: "normal-user", password: "password123", policyAccepted: false })).rejects.toThrow("请先阅读并同意服务条款和隐私政策");

        const user = await createUser({ username: "normal-user", password: "password123", policyAccepted: true });
        expect(user).toMatchObject({ role: "user", settledBalance: "0", heldBalance: "0", availableBalance: "0" });
        const stored = (memory.value as { users: Array<Record<string, unknown>> }).users;
        expect(stored[0]).toMatchObject({ settledBalance: "0" });
        expect(stored[1]).toMatchObject({ settledBalance: "0", registrationConsent: {
            termsVersion: "1.0",
            termsUrl: "/terms",
            privacyVersion: "1.0",
            privacyUrl: "/privacy",
            acceptedAt: expect.any(String),
        } });
        for (const record of stored) {
            expect(record).not.toHaveProperty("planId");
            expect(record).not.toHaveProperty("pointsBalance");
        }
    });

    it("serializes concurrent first-admin attempts", async () => {
        const outcomes = await Promise.allSettled([createFirstAdmin({ username: "admin-one", password: "password123", installToken: TOKEN }), createFirstAdmin({ username: "admin-two", password: "password123", installToken: TOKEN })]);

        expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
        expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(1);
    });
});
