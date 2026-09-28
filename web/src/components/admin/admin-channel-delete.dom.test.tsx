/** @vitest-environment jsdom */

import { act, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthSettings, SystemModelChannel } from "@/lib/auth/store";
import { DEFAULT_SETTINGS } from "@/lib/auth/store-foundation";
import type { AdminDashboardDataActions } from "./use-admin-dashboard-data-actions";
import type { AdminDashboardState } from "./use-admin-dashboard-state";
import { useAdminDashboardSettingsActions } from "./use-admin-dashboard-settings-actions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const channel: SystemModelChannel = {
    id: "channel-to-delete",
    name: "待删除渠道",
    baseUrl: "https://example.com",
    apiKey: "secret",
    apiFormat: "openai",
    models: ["audio-model"],
    enabled: false,
};

function settingsWithChannel(): AuthSettings {
    return {
        ...structuredClone(DEFAULT_SETTINGS),
        systemChannels: [channel],
        logicalModels: [
            {
                id: "audio-model",
                name: "音频模型",
                capability: "audio",
                enabled: true,
                bindings: [{ id: "audio-binding", channelId: channel.id, upstreamModel: "audio-model", enabled: true, priority: 1 }],
            },
        ],
        defaultModels: { ...DEFAULT_SETTINGS.defaultModels, audioModel: "audio-model" },
    };
}

function deferredSave() {
    let settle!: (saved: boolean) => void;
    return {
        saveSettings: vi.fn(() => new Promise<boolean>((resolve) => (settle = resolve))),
        settle: (saved: boolean) => settle(saved),
    };
}

function Harness({ saveSettings }: { saveSettings: AdminDashboardDataActions["saveSettings"] }) {
    const [settings, setSettings] = useState(settingsWithChannel);
    const actions = useAdminDashboardSettingsActions({ state: { settings, setSettings } as AdminDashboardState, data: { saveSettings } as AdminDashboardDataActions });
    return (
        <div>
            {settings.systemChannels.map((item) => (
                <span key={item.id}>{item.name}</span>
            ))}
            <button onClick={() => void actions.deleteChannel(channel.id)}>删除测试渠道</button>
        </div>
    );
}

afterEach(cleanup);

describe("admin channel deletion", () => {
    it("removes the channel after persistence succeeds and saves the matching workspace snapshot", async () => {
        const request = deferredSave();
        render(<Harness saveSettings={request.saveSettings as AdminDashboardDataActions["saveSettings"]} />);

        fireEvent.click(screen.getByRole("button", { name: "删除测试渠道" }));

        expect(screen.getByText(channel.name)).toBeTruthy();
        expect(request.saveSettings).toHaveBeenCalledWith(
            expect.objectContaining({
                systemChannels: [],
                logicalModels: [],
                defaultModels: expect.objectContaining({ audioModel: "" }),
            }),
            "渠道已删除",
        );
        await act(async () => request.settle(true));
        expect(screen.queryByText(channel.name)).toBeNull();
    });

    it("keeps the channel when persistence fails", async () => {
        const request = deferredSave();
        render(<Harness saveSettings={request.saveSettings as AdminDashboardDataActions["saveSettings"]} />);

        fireEvent.click(screen.getByRole("button", { name: "删除测试渠道" }));
        expect(screen.getByText(channel.name)).toBeTruthy();

        await act(async () => request.settle(false));
        expect(screen.getByText(channel.name)).toBeTruthy();
    });
});
