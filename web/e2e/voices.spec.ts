import { expect, test, type Page } from "@playwright/test";

import { expectNoHorizontalOverflow, expectVisibleControlsWithinViewport } from "./responsive-helpers";

test("voice management supports clone consent, preview, rename and delete without exposing provider data", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const state = await mockVoiceManagement(page);
    await page.goto("/voices", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "声音管理" })).toBeVisible();
    await expectNoHorizontalOverflow(page, `${testInfo.project.name} voices`);
    await expectVisibleControlsWithinViewport(page, `${testInfo.project.name} voices`);

    await page.getByRole("button", { name: "克隆声音" }).click();
    await page.getByPlaceholder("例如：我的旁白声").fill("E2E 克隆声音");
    await page.locator('input[type="file"]').setInputFiles({ name: "sample.wav", mimeType: "audio/wav", buffer: Buffer.from("RIFF-e2e-audio") });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "确认创建" }).click();

    await expect.poll(() => state.created).toMatchObject({ name: "E2E 克隆声音", sourceAssetToken: "permanent/e2e-source.wav", consentConfirmed: true, clientRequestId: expect.any(String) });
    await expect(page.getByText("E2E 克隆声音", { exact: true })).toBeVisible();
    await expect(page.getByText("克隆中", { exact: true })).toBeVisible();

    const readyCard = page.locator(".ant-card").filter({ hasText: "我的声音" });
    await readyCard.getByRole("button", { name: "试听" }).click();
    await expect(page.getByText("预计消耗 0.25 积分", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "确认并生成" }).click();
    await expect(page.locator("audio")).toHaveAttribute("src", "/api/reference-assets/e2e-preview.mp3");
    await page.getByRole("dialog", { name: "声音预览", exact: true }).getByRole("button", { name: "Close" }).click();

    await readyCard.getByRole("button", { name: "我的声音" }).click();
    const renameInput = page.locator(".ant-card input");
    await renameInput.fill("新旁白声音");
    await renameInput.press("Enter");
    await expect(page.getByText("新旁白声音", { exact: true })).toBeVisible();

    const renamedCard = page.locator(".ant-card").filter({ hasText: "新旁白声音" });
    await renamedCard.getByRole("button", { name: "删除" }).click();
    await page
        .locator(".ant-popconfirm")
        .getByRole("button", { name: /删\s*除/ })
        .click();
    await expect(page.getByText("新旁白声音", { exact: true })).toHaveCount(0);

    expect(JSON.stringify(state.created)).not.toContain("providerVoiceId");
    expect(state.previewCreates).toBe(1);
});

async function mockVoiceManagement(page: Page) {
    const now = "2026-09-03T00:00:00.000Z";
    const profiles = [
        { id: "profile-ready", name: "我的声音", status: "ready", source: { mimeType: "audio/wav", durationSeconds: 8 }, hasPreview: false, createdAt: now, updatedAt: now },
        { id: "profile-failed", name: "失败样本", status: "failed", source: { mimeType: "audio/mpeg", durationSeconds: 9 }, hasPreview: false, error: "上游拒绝了该样本", createdAt: now, updatedAt: now },
    ];
    const state: { created?: Record<string, unknown>; previewCreates: number } = { previewCreates: 0 };

    await page.route(/\/api\/auth\/session(?:\?.*)?$/, async (route) => {
        const response = await route.fetch();
        const payload = (await response.json()) as { settings?: { defaultModels?: Record<string, string> } };
        payload.settings = payload.settings || {};
        payload.settings.defaultModels = { ...(payload.settings.defaultModels || {}), voiceCloneModel: "e2e-voice-clone" };
        await route.fulfill({ response, json: payload });
    });
    await page.route(/\/api\/voice-profiles(?:\?.*)?$/, async (route) => {
        if (route.request().method() === "GET") return route.fulfill({ json: { code: 0, data: { items: profiles, total: profiles.length, page: 1, pageSize: 12 }, msg: "" } });
        state.created = route.request().postDataJSON() as Record<string, unknown>;
        profiles.unshift({ id: "profile-pending", name: String(state.created.name), status: "pending", source: { mimeType: "audio/wav", durationSeconds: 7 }, hasPreview: false, createdAt: now, updatedAt: now });
        return route.fulfill({ json: { code: 0, data: { profile: profiles[0] }, msg: "声音克隆任务已创建" } });
    });
    await page.route(/\/api\/voice-profiles\/profile-ready$/, async (route) => {
        const profile = profiles.find((item) => item.id === "profile-ready")!;
        if (route.request().method() === "PATCH") {
            profile.name = String((route.request().postDataJSON() as { name: string }).name);
            return route.fulfill({ json: { code: 0, data: { profile }, msg: "声音名称已更新" } });
        }
        const index = profiles.indexOf(profile);
        profiles.splice(index, 1);
        return route.fulfill({ json: { code: 0, data: { profile: { ...profile, status: "deleting" } }, msg: "声音删除已提交" } });
    });
    await page.route(/\/api\/voice-profiles\/profile-ready\/preview(?:\?.*)?$/, async (route) => {
        if (route.request().method() === "GET") return route.fulfill({ json: { code: 0, data: { cached: false, locale: "zh-CN", estimatedPoints: 0.25 }, msg: "" } });
        state.previewCreates += 1;
        return route.fulfill({ json: { code: 0, data: { cached: true, url: "/api/reference-assets/e2e-preview.mp3" }, msg: "" } });
    });
    await page.route(/\/api\/reference-assets$/, async (route) => route.fulfill({ json: { token: "permanent/e2e-source.wav" } }));
    await page.route(/\/api\/reference-assets\/e2e-preview\.mp3$/, async (route) => route.fulfill({ contentType: "audio/mpeg", body: Buffer.from([0xff, 0xfb, 0x90, 0x64]) }));
    return state;
}
