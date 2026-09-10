import { describe, expect, it, vi } from "vitest";
import { insertPostgresUsers, mapPostgresUser } from "@/lib/auth/store-repository";

import type { QueryExecutor } from "./postgres";
import { EmailCodesRepository, SessionsRepository, UsersRepository } from "./user-repository";

describe("UsersRepository security fields", () => {
    it.each([
        { termsVersion: "2.0", termsUrl: "/terms", privacyVersion: "3.0", privacyUrl: "/privacy" },
        { termsVersion: "", termsUrl: "", privacyVersion: "", privacyUrl: "" },
    ])("persists and returns the accepted policy snapshot %j with a new account id", async (policy) => {
        const acceptedAt = "2026-08-09T08:30:00.000Z";
        const row = {
            id: "user-one",
            account_id: 1,
            username: "new-user",
            display_name: "新用户",
            bio: "",
            role: "user",
            status: "active",
            settled_balance: "0",
            password_hash: "hash",
            terms_version: policy.termsVersion,
            terms_url: policy.termsUrl,
            privacy_version: policy.privacyVersion,
            privacy_url: policy.privacyUrl,
            policy_accepted_at: new Date(acceptedAt),
            created_at: acceptedAt,
            updated_at: acceptedAt,
        };
        const query = vi.fn(async (_statement: string, _values?: unknown[]) => ({
            rows: [row],
            rowCount: 1,
        }));
        const repository = new UsersRepository({ query } as unknown as QueryExecutor);

        const input = {
            id: "user-one",
            username: "new-user",
            displayName: "新用户",
            bio: "",
            role: "user" as const,
            adminPermissions: [],
            status: "active" as const,
            settledBalance: "0",
            passwordHash: "hash",
            registrationConsent: { ...policy, acceptedAt },
            createdAt: acceptedAt,
            updatedAt: acceptedAt,
        };
        const user = await repository.createWithNextAccountId(input);

        const [statement, values] = query.mock.calls[0];
        expect(statement).toContain("terms_version, terms_url, privacy_version, privacy_url, policy_accepted_at");
        expect(values?.slice(13, 18)).toEqual([policy.termsVersion, policy.termsUrl, policy.privacyVersion, policy.privacyUrl, acceptedAt]);
        expect(user.registrationConsent).toEqual({ ...policy, acceptedAt });
        expect((await repository.create({ ...input, accountId: "0001" })).registrationConsent).toEqual({ ...policy, acceptedAt });
        expect(query.mock.calls[1][1]?.slice(14, 19)).toEqual([policy.termsVersion, policy.termsUrl, policy.privacyVersion, policy.privacyUrl, acceptedAt]);
        await insertPostgresUsers({ query } as unknown as QueryExecutor, [{ ...input, accountId: "0001" }]);
        expect(query.mock.calls[2][1]?.slice(14, 19)).toEqual([policy.termsVersion, policy.termsUrl, policy.privacyVersion, policy.privacyUrl, acceptedAt]);
        expect(mapPostgresUser(row).registrationConsent).toEqual({ ...policy, acceptedAt });
    });

    it("persists MFA fields and can explicitly clear both values", async () => {
        const query = vi.fn(async (_statement: string, _values?: unknown[]) => ({
            rows: [
                {
                    id: "admin-one",
                    account_id: 1,
                    username: "admin",
                    display_name: "管理员",
                    bio: "",
                    role: "admin",
                    status: "active",
                    settled_balance: "0",
                    password_hash: "hash",
                    created_at: "2026-08-09T00:00:00.000Z",
                    updated_at: "2026-08-09T00:00:00.000Z",
                },
            ],
            rowCount: 1,
        }));
        const repository = new UsersRepository({ query } as unknown as QueryExecutor);

        await repository.create({
            id: "admin-one",
            accountId: "0001",
            username: "admin",
            displayName: "管理员",
            bio: "",
            role: "admin",
            adminPermissions: ["administrators.manage"],
            status: "active",
            settledBalance: "0",
            passwordHash: "hash",
            mfaSecretCiphertext: "encrypted-secret",
            mfaEnabledAt: "2026-08-09T01:00:00.000Z",
            createdAt: "2026-08-09T00:00:00.000Z",
            updatedAt: "2026-08-09T00:00:00.000Z",
        });
        await repository.update("admin-one", { mfaSecretCiphertext: null, mfaEnabledAt: null });

        expect(query.mock.calls[0][0]).toContain("mfa_secret_ciphertext, mfa_enabled_at");
        expect(query.mock.calls[0][1]?.slice(12, 14)).toEqual(["encrypted-secret", "2026-08-09T01:00:00.000Z"]);
        expect(query.mock.calls[1][0]).toContain("mfa_secret_ciphertext = CASE WHEN $16::boolean");
        expect(query.mock.calls[1][1]?.slice(15)).toEqual([true, null, true, null]);
    });
});

describe("technical expiry repositories", () => {
    it("deletes expired sessions through a stable bounded candidate query", async () => {
        const query = vi.fn(async (_statement: string, _values?: unknown[]) => ({ rows: [], rowCount: 2 }));
        const now = new Date("2026-08-09T12:00:00.000Z");

        await expect(new SessionsRepository({ query } as unknown as QueryExecutor).pruneExpired(now, 30)).resolves.toBe(2);

        expect(query.mock.calls[0][0]).toContain("ORDER BY expires_at ASC, id ASC");
        expect(query.mock.calls[0][0]).toContain("LIMIT $2");
        expect(query.mock.calls[0][1]).toEqual([now.toISOString(), 30]);
    });

    it("deletes expired or consumed email codes through a stable bounded candidate query", async () => {
        const query = vi.fn(async (_statement: string, _values?: unknown[]) => ({ rows: [], rowCount: 3 }));
        const now = new Date("2026-08-09T12:00:00.000Z");

        await expect(new EmailCodesRepository({ query } as unknown as QueryExecutor).pruneExpired(now, 40)).resolves.toBe(3);

        expect(query.mock.calls[0][0]).toContain("expires_at <= $1 OR consumed_at IS NOT NULL");
        expect(query.mock.calls[0][0]).toContain("ORDER BY COALESCE(consumed_at, expires_at) ASC, id ASC");
        expect(query.mock.calls[0][1]).toEqual([now.toISOString(), 40]);
    });
});
