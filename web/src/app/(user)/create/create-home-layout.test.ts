import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("create Agent home layout", () => {
    it("keeps Agent input, recent work and reusable public inspiration in one flow", async () => {
        const [page, composer, messages, conversationList, generationControls, preferences, overview, inspiration, previewModal] = await Promise.all([
            readFile(resolve(process.cwd(), "src/app/(user)/create/page.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/create/components/creative-composer.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/create/components/creative-messages.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/create/components/creative-conversation-list.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/create/components/creative-generation-controls.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/components/creative-generation-preferences.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/create/components/create-workbench-overview.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/create/components/create-inspiration-gallery.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/components/works/public-work-preview-modal.tsx"), "utf8"),
        ]);

        expect(page).toContain('t("siteAgentTitle"');
        expect(page).toContain("createAgentDraftFromHash");
        expect(page).toContain("setCreationMode(incomingDraft.mode)");
        expect(page).toContain('data-testid="creative-conversation-scroll"');
        expect(page).toContain("updateConversationScrollState");
        expect(page).toContain("onWheelCapture");
        expect(page).toContain("distanceFromLatest > 48");
        expect(page).toContain("awayFromLatestRef.current = false");
        expect(page).toContain("setAwayFromLatestState(true)");
        expect(page).toContain('t("backToBottom")');
        expect(page).toContain("conversationWasLoadingRef");
        expect(page).toContain("if (wasLoading)");
        expect(page).toContain("resizeObserver.observe(content)");
        expect(messages).toContain('data-testid="creative-message-list"');
        expect(messages).toContain("[assets.length, followLatest, lastMessageId, loading]");
        expect(page).toContain("historyOpen && screens.lg");
        expect(page).toContain("historyOpen && screens.lg !== true");
        expect(page).toContain("aria-expanded={historyOpen}");
        const pageTools = page.match(/className="([^"]+)" data-testid="creative-page-tools"/)?.[1] || "";
        expect(pageTools).toContain("absolute");
        expect(pageTools).toContain("top-3");
        expect(pageTools).not.toContain("h-14");
        expect(pageTools).not.toContain("bg-");
        expect(page).toContain("w-[min(280px,24vw)]");
        expect(page).not.toContain("w-[320px]");
        expect(conversationList).toContain('className="flex h-9 w-full');
        expect(conversationList).toContain("group flex min-h-13");
        expect(page).not.toContain("最近创作");
        expect(page).toContain("<CreateInspirationGallery");
        expect(page.indexOf("<CreateWorkbenchOverview")).toBeLessThan(page.indexOf("<CreateInspirationGallery"));
        expect(page).toContain("usePublicImage");
        expect(composer).toContain('centered ? "max-w-[1080px]"');
        expect(composer).toContain('data-compact="true"');
        expect(composer).toContain('data-compact="false"');
        expect(composer).toContain("allMediaAttachments.map");
        expect(composer).toContain("<ComposerMediaThumbnail key={asset.id} asset={asset} compact");
        expect(composer).toContain("autoSize={compactMode ? { minRows: 1, maxRows: 5 }");
        expect(composer).toContain("<CreativeGenerationControls");
        expect(composer).toContain('t("useSkillTool")');
        expect(composer).toContain('aria-label={optimizing ? t("optimizingPrompt") : t("optimizePrompt")}');
        expect(page).toContain("optimizePrompt");
        expect(page).toContain("mode: creationMode");
        expect(composer).toContain('aria-label={mediaAttachments.length ? t("continueAddMaterial") : t("addMaterial")}');
        expect(composer).toContain('t("creationType")');
        expect(composer).toContain("transition hover:bg-[#eef3f6] dark:hover:bg-[#29323a]");
        expect(composer).toContain('selected ? "text-[#20242a] dark:text-white"');
        expect(composer).not.toContain('selected ? "bg-[#eef3f6]');
        expect(composer).toContain('const popoverPlacement = centered ? "bottomLeft" : "topLeft"');
        expect(composer).toContain("placement={popoverPlacement}");
        expect(composer).not.toContain("上传中");
        expect(composer).toContain("data-delete-indicator");
        expect(composer).toContain("size-[22px]");
        expect(composer).toContain("bg-[#66727f]/95");
        expect(composer).toContain("text-white");
        expect(generationControls).toContain("placement={placement}");
        expect(composer).toContain("hide-scrollbar flex min-w-0 flex-1");
        expect(generationControls).toContain('t("smartModel")');
        expect(generationControls).toContain('t("selectModel")');
        expect(generationControls).toContain("<Orbit");
        expect(generationControls).toContain("<GenerationPreferencesControl");
        expect(generationControls).toContain("max-w-[360px]");
        expect(generationControls).not.toContain("选择比例");
        expect(preferences).toContain('value: "agent"');
        expect(preferences).toContain('value: "image"');
        expect(preferences).toContain('value: "video"');
        expect(preferences).toContain('value: "audio"');
        expect(preferences).toContain('t("generationParametersSummary"');
        expect(preferences).toContain('t("ratio")');
        expect(preferences).toContain("1080P");
        expect(preferences).toContain('t("selectVoice")');
        expect(preferences).toContain("<Select");
        expect(preferences).not.toContain("选择模型");
        expect(preferences).not.toContain("修改后立即生效，例如 1024 × 1536");
        expect(preferences).not.toContain("恢复智能");
        expect(composer).not.toContain("CreativeImageSizeControl");
        const pointerDownHandler = composer.slice(composer.indexOf("const onPointerDown"), composer.indexOf("const onPointerMove"));
        const pointerMoveHandler = composer.slice(composer.indexOf("const onPointerMove"), composer.indexOf("const finishDrag"));
        expect(pointerDownHandler).not.toContain("setPointerCapture");
        expect(pointerMoveHandler).toContain("setPointerCapture");
        expect(inspiration).toContain('t("inspirationDiscovery")');
        expect(inspiration).toContain('t("usePrompt")');
        expect(inspiration).toContain('t("copyPrompt")');
        expect(inspiration).toContain('t("useImage")');
        expect(inspiration).toContain("listPublicGallery");
        expect(inspiration).toContain("<ResponsiveMasonryGrid");
        expect(inspiration).toContain("grid-cols-2");
        expect(inspiration).toContain("xl:grid-cols-6");
        expect(inspiration).not.toContain("columns-2");
        expect(inspiration).not.toContain("max-h-[560px]");
        expect(inspiration).toContain("<Dropdown");
        expect(inspiration).toContain("<PublicWorkPreviewModal");
        expect(inspiration).toContain("<LazyMediaImage");
        expect(inspiration).toContain("<PublicWorkCardTitle");
        expect(inspiration).not.toContain("href={`/share/");
        expect(overview).toContain('aria-label={t("referenceToAgent")}');
        expect(overview.indexOf('aria-labelledby="create-assets-heading"')).toBeLessThan(overview.indexOf('aria-labelledby="create-projects-heading"'));
        expect(overview).toContain("recentAssets.slice(0, recentAssetVisibilityClasses.length)");
        expect(overview).toContain("grid-cols-2");
        expect(overview).toContain("2xl:grid-cols-6");
        expect(overview).toContain('"hidden sm:block"');
        expect(overview).not.toContain("grid-flow-col");
        expect(overview).not.toContain("overflow-x-auto");
        expect(overview).not.toContain("lg:grid-cols-5");
        expect(overview).toContain('"group grid h-32');
        expect(overview).toContain("sm:h-44");
        expect(overview).toContain('title={t("referenceToAgent")}');
        expect(overview).not.toMatch(/>\s*引用\s*</);
        expect(overview).not.toContain("absolute bottom-2 right-2");
        expect(previewModal).toContain('aria-label={t("usePrompt")}');
        expect(previewModal).toContain('aria-label={t("useImage")}');
        expect(previewModal).not.toMatch(/>\s*引用到 Agent\s*</);
        expect(previewModal).toContain('t("copyPrompt")');
        expect(previewModal).toContain('aria-label={t("closeDetails")}');
        expect(previewModal).toContain("lg:grid-cols-[minmax(0,1fr)_340px]");
        expect(previewModal).toContain("xl:grid-cols-[minmax(0,1fr)_360px]");
        expect(previewModal).toContain('asset.mediaType === "image" || asset.mediaType === "video"');
    });
});
