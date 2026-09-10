/** @vitest-environment jsdom */
import { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/auth/store-foundation";
import { AdminSiteSection } from "./admin-configuration-sections";
import { useAdminDashboardSettingsActions } from "./use-admin-dashboard-settings-actions";
import type { AdminDashboardController } from "./use-admin-dashboard-controller";
import type { AdminDashboardState } from "./use-admin-dashboard-state";
import type { AdminDashboardDataActions } from "./use-admin-dashboard-data-actions";

Object.defineProperty(window, "matchMedia", { value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }) });
globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
};
afterEach(cleanup);

it("edits and previews the selected locale without replacing other drafts and saves the latest full record", () => {
    let saved: unknown;
    function Harness() {
        const [settings, setSettings] = useState(() => structuredClone(DEFAULT_SETTINGS));
        const saveSettings = (patch: unknown) => {
            saved = patch;
        };
        const actions = useAdminDashboardSettingsActions({ state: { settings, setSettings } as AdminDashboardState, data: { saveSettings } as unknown as AdminDashboardDataActions });
        const ref = useRef<HTMLInputElement>(null);
        return <AdminSiteSection controller={{ ...actions, settings, activeSection: "site", saveSettings, logoInputRef: ref, iconInputRef: ref } as unknown as AdminDashboardController} />;
    }
    render(<Harness />);
    expect(screen.queryByRole("tab", { name: "VI" })).not.toBeNull();
    expect(screen.queryByText("留空后使用该语言的内置默认值。")).toBeNull();
    expect((screen.getByLabelText("SEO 标题") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("SEO 标题") as HTMLInputElement).placeholder).toBe("请输入当前语言的 SEO 标题");
    expect(screen.getByText("尚未配置 SEO 标题")).toBeTruthy();
    expect(screen.getByText("尚未配置 SEO 描述")).toBeTruthy();
    for (const [tab, title, description, keywords] of [
        ["VI", "Tiêu đề mới", "Mô tả mới", "ảnh,video"],
        ["EN", "English title", "English description", "image,video"],
        ["简体中文", "中文标题", "中文描述", "图片,视频"],
    ]) {
        fireEvent.click(screen.getByRole("tab", { name: tab }));
        for (const [label, value, limit] of [
            ["SEO 标题", title, 72],
            ["SEO 描述", description, 180],
            ["SEO 关键词", keywords, 240],
        ] as const) {
            const input = screen.getByLabelText(label) as HTMLInputElement;
            expect(input.maxLength).toBe(limit);
            fireEvent.change(input, { target: { value } });
        }
        expect(screen.getByText(title)).toBeTruthy();
        expect(screen.getByText(description, { selector: "p" })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("tab", { name: "EN" }));
    expect((screen.getByLabelText("SEO 标题") as HTMLInputElement).value).toBe("English title");
    fireEvent.click(screen.getByRole("button", { name: "保存网站设置" }));
    expect(saved).toMatchObject({
        site: {
            seo: {
                vi: { title: "Tiêu đề mới", description: "Mô tả mới", keywords: "ảnh,video" },
                en: { title: "English title", description: "English description", keywords: "image,video" },
                "zh-CN": { title: "中文标题", description: "中文描述", keywords: "图片,视频" },
            },
        },
    });
});
