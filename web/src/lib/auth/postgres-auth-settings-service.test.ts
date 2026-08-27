import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "./store-foundation";
import { normalizeGenerationParameters } from "@/lib/generation-parameters";

const mocks = vi.hoisted(() => ({
    lock: vi.fn(),
    updateSettings: vi.fn(),
    upsertSystemModelChannel: vi.fn(),
    deleteSystemModelChannelsNotIn: vi.fn(),
    readSettings: vi.fn(),
}));

vi.mock("@/lib/server/database", () => ({
    createPostgresRepositories: vi.fn(() => ({ settings: mocks })),
    ensurePostgresSchema: vi.fn(),
    withPostgresTransaction: vi.fn(async (handler: (client: unknown) => Promise<unknown>) => handler({})),
}));

vi.mock("./store-repository", () => ({ readPostgresAuthSettings: mocks.readSettings }));

import { updatePostgresAuthSettings } from "./postgres-auth-settings-service";

describe("updatePostgresAuthSettings", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.readSettings.mockResolvedValue(structuredClone(DEFAULT_SETTINGS));
    });

    it("updates site settings without rewriting plans or channels", async () => {
        const site = {
            ...DEFAULT_SETTINGS.site,
            title: "新站点",
            socials: {
                ...DEFAULT_SETTINGS.site.socials,
                telegram: { enabled: true, label: "Telegram", url: "https://t.me/vozeb_group" },
                x: { enabled: true, label: "X", url: "https://x.com/vozeb_pro" },
                instagram: { enabled: true, label: "Instagram", url: "https://instagram.com/vozeb.pro" },
            },
        };

        const settings = await updatePostgresAuthSettings({ site });

        expect(mocks.updateSettings).toHaveBeenCalledWith({ site: expect.objectContaining({ title: "新站点", socials: site.socials }) });
        expect(settings.site.socials).toEqual(site.socials);
        expect(mocks.upsertSystemModelChannel).not.toHaveBeenCalled();
        expect(mocks.deleteSystemModelChannelsNotIn).not.toHaveBeenCalled();
    });

    it("rewrites only channel rows when channels change", async () => {
        const systemChannels = [
            {
                id: "channel-one",
                name: "主渠道",
                baseUrl: "https://api.example.com/v1",
                apiKey: "",
                apiFormat: "openai" as const,
                models: ["writer"],
                enabled: true,
            },
        ];

        await updatePostgresAuthSettings({ systemChannels });

        expect(mocks.updateSettings).not.toHaveBeenCalled();
        expect(mocks.upsertSystemModelChannel).toHaveBeenCalledTimes(1);
        expect(mocks.deleteSystemModelChannelsNotIn).toHaveBeenCalledWith(["channel-one"]);
    });

    it("writes nested generation parameters as a logical-model JSONB patch", async () => {
        mocks.readSettings.mockResolvedValue({
            ...structuredClone(DEFAULT_SETTINGS),
            systemChannels: [{ id: "one", name: "渠道", baseUrl: "https://api.example.com/v1", apiKey: "", apiFormat: "openai", models: ["image"], enabled: true }],
        });
        const logicalModels = [
            {
                id: "image",
                name: "图片",
                capability: "image" as const,
                enabled: true,
                bindings: [{ id: "image:one", channelId: "one", upstreamModel: "image", enabled: true, priority: 1, generationParameters: normalizeGenerationParameters({ aspectRatios: ["16:9"], qualities: ["ultra"], maxBatchSize: 2 })! }],
            },
        ];

        await updatePostgresAuthSettings({ logicalModels });

        expect(mocks.updateSettings).toHaveBeenCalledWith({ logicalModels: expect.arrayContaining([expect.objectContaining({ bindings: [expect.objectContaining({ generationParameters: expect.objectContaining({ qualities: ["ultra"] }) })] })]) });
    });
});
