import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const memory = vi.hoisted(() => ({ value: undefined as unknown }));

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

import { createFirstAdmin, createUserByAdmin, deleteUserByAdmin, updateUserByAdmin } from "./store";
import { decimal } from "@/lib/billing/decimal";
import { getWalletSnapshot, reserveWalletCredits } from "@/lib/server/points-wallet-service";

const INSTALL_TOKEN = "install-token-".padEnd(48, "x");

describe("administrator user-management duties", () => {
    beforeEach(() => {
        memory.value = undefined;
        vi.stubEnv("VOZEB_PRO_INSTALL_TOKEN", INSTALL_TOKEN);
    });

    afterEach(() => vi.unstubAllEnvs());

    it("prevents a limited administrator from managing a broader administrator", async () => {
        const owner = await createFirstAdmin({ username: "owner", password: "password123", installToken: INSTALL_TOKEN });
        const limited = await createUserByAdmin({ actorId: owner.id, username: "limited", password: "password123", role: "admin", adminPermissions: ["administrators.manage"] });
        const systemAdmin = await createUserByAdmin({ actorId: owner.id, username: "system-admin", password: "password123", role: "admin", adminPermissions: ["administrators.manage", "system.manage"] });

        await expect(updateUserByAdmin(limited.id, systemAdmin.id, { displayName: "越权修改" })).rejects.toMatchObject({ status: 403 });
        await expect(deleteUserByAdmin(limited.id, systemAdmin.id)).rejects.toMatchObject({ status: 403 });
    });

    it("allows delegation only within the current administrator permission set", async () => {
        const owner = await createFirstAdmin({ username: "owner", password: "password123", installToken: INSTALL_TOKEN });
        const limited = await createUserByAdmin({ actorId: owner.id, username: "limited", password: "password123", role: "admin", adminPermissions: ["administrators.manage"] });

        await expect(createUserByAdmin({ actorId: limited.id, username: "too-powerful", password: "password123", role: "admin", adminPermissions: ["administrators.manage", "system.manage"] })).rejects.toMatchObject({ status: 403 });
        await expect(createUserByAdmin({ actorId: limited.id, username: "peer", password: "password123", role: "admin", adminPermissions: ["administrators.manage"] })).resolves.toMatchObject({ adminPermissions: ["administrators.manage"] });
    });

    it("rejects an administrator balance adjustment below active holds with a conflict", async () => {
        const owner = await createFirstAdmin({ username: "owner", password: "password123", installToken: INSTALL_TOKEN });
        const user = await createUserByAdmin({ actorId: owner.id, username: "wallet-user", password: "password123", role: "user" });
        await updateUserByAdmin(owner.id, user.id, { settledBalance: "10.25" });
        await reserveWalletCredits({ userId: user.id, businessId: "generation:held", requestFingerprint: "a".repeat(64), amount: "8.125", description: "生成预留", now: new Date("2026-08-24T00:00:00.000Z") });

        await expect(updateUserByAdmin(owner.id, user.id, { settledBalance: "8" })).rejects.toMatchObject({ status: 409, message: "结算余额不能低于当前预留积分" });
        await expect(getWalletSnapshot(user.id)).resolves.toEqual({ settledBalance: "10.25", heldBalance: "8.125", availableBalance: "2.125" });
    });

    it("serializes a balance adjustment with a concurrent reservation without creating negative availability", async () => {
        const owner = await createFirstAdmin({ username: "owner", password: "password123", installToken: INSTALL_TOKEN });
        const user = await createUserByAdmin({ actorId: owner.id, username: "race-user", password: "password123", role: "user" });
        await updateUserByAdmin(owner.id, user.id, { settledBalance: "10" });

        const outcomes = await Promise.allSettled([
            updateUserByAdmin(owner.id, user.id, { settledBalance: "6" }),
            reserveWalletCredits({ userId: user.id, businessId: "generation:race", requestFingerprint: "b".repeat(64), amount: "8", description: "并发预留", now: new Date("2026-08-24T00:00:00.000Z") }),
        ]);

        expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
        expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
        expect(decimal((await getWalletSnapshot(user.id)).availableBalance).isNegative()).toBe(false);
    });
});
