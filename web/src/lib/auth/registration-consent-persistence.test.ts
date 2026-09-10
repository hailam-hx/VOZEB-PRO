import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPostgresRepositories, initializePostgresSchema } from "@/lib/server/database";
import { createFirstAdmin, createUser } from "./store-user-access";
import { readAuthDb, writeAuthDb } from "./store-repository";
import { getFreshAuthSettings, setAuthSettings } from "./store-settings-actions";

let dataDir = "";
afterEach(async () => {
    vi.unstubAllEnvs();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    dataDir = "";
});

describe("registration consent persistence", () => {
    for (const provider of ["file", "postgres"] as const) {
        const test = provider === "postgres" && process.env.VOZEB_PRO_RUN_POSTGRES_INTEGRATION !== "1" ? it.skip : it;
        test(`${provider} preserves registration acceptance with empty policies through persisted reads`, async () => {
            dataDir = await mkdtemp(join(tmpdir(), "registration-consent-"));
            vi.stubEnv("VOZEB_PRO_DATA_DIR", dataDir);
            vi.stubEnv("VOZEB_PRO_DATABASE_PROVIDER", provider);
            const token = "registration-consent-test-token".padEnd(48, "x");
            vi.stubEnv("VOZEB_PRO_INSTALL_TOKEN", token);
            const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
            const repositories = provider === "postgres" ? createPostgresRepositories() : undefined;
            if (repositories) await initializePostgresSchema();
            const original = await getFreshAuthSettings();
            const createdIds: string[] = [];
            try {
                if (!repositories || (await repositories.users.count()) === 0) createdIds.push((await createFirstAdmin({ username: `admin_${suffix}`, password: "password123", installToken: token })).id);
                await setAuthSettings({ registrationEnabled: true, emailRegistrationEnabled: false, site: { ...original.site, termsVersion: "", termsUrl: "", privacyVersion: "", privacyUrl: "" } });

                await expect(createUser({ username: `user_${suffix}`, password: "password123", policyAccepted: false })).rejects.toThrow("请先阅读并同意服务条款和隐私政策");
                const user = await createUser({ username: `user_${suffix}`, password: "password123", policyAccepted: true });
                createdIds.push(user.id);
                const expected = { termsVersion: "", termsUrl: "", privacyVersion: "", privacyUrl: "", acceptedAt: user.createdAt };
                if (repositories) {
                    expect((await repositories.users.getById(user.id))?.registrationConsent).toEqual(expected);
                    await repositories.users.update(user.id, { displayName: "已更新" });
                    expect((await repositories.users.getById(user.id))?.registrationConsent).toEqual(expected);
                } else {
                    const persisted = await readAuthDb();
                    expect(persisted.users.find((record) => record.id === user.id)?.registrationConsent).toEqual(expected);
                    await writeAuthDb(persisted);
                    expect((await readAuthDb()).users.find((record) => record.id === user.id)?.registrationConsent).toEqual(expected);
                }
            } finally {
                await setAuthSettings({ registrationEnabled: original.registrationEnabled, emailRegistrationEnabled: original.emailRegistrationEnabled, site: original.site });
                if (repositories) for (const id of createdIds.reverse()) await repositories.users.delete(id);
            }
        });
    }
});
