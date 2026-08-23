import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("drama mobile list layout", () => {
    it("does not enable cached content sizing before the responsive breakpoint", async () => {
        const [page, generation] = await Promise.all([readFile(resolve(process.cwd(), "src/app/(user)/drama/[id]/page.tsx"), "utf8"), readFile(resolve(process.cwd(), "src/app/(user)/drama/[id]/drama-generation-panel.tsx"), "utf8")]);
        const source = `${page}\n${generation}`;

        expect(source).not.toMatch(/(?:^|[\s"])(?<!sm:)\[content-visibility:auto\]/m);
        expect(source).toContain("[content-visibility:visible]");
        expect(source).toContain("sm:[content-visibility:auto]");
    });

    it("uses the production workspace panels with responsive episode and Agent controls", async () => {
        const [page, sections, agent, elements] = await Promise.all([
            readFile(resolve(process.cwd(), "src/app/(user)/drama/[id]/page.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/drama/[id]/drama-project-sections.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/drama/[id]/drama-agent-panel.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/(user)/drama/[id]/drama-editor-elements.tsx"), "utf8"),
        ]);

        expect(page).not.toContain("xl:grid-cols-[184px_minmax(0,1fr)_360px]");
        expect(page).toContain("data-drama-workspace-body");
        expect(page).toContain("data-drama-production-scroll");
        expect(page).toContain("<DramaEpisodeSidebar");
        expect(page).toContain("episodeNavigatorOpen={episodeNavigatorOpen}");
        expect(page).toContain("open={agentOpen}");
        expect(sections).toContain("data-drama-workspace-header");
        expect(sections).toContain("data-drama-stage-navigation");
        expect(page).toContain("<DramaGenerationPanel");
        expect(page).toContain("<DramaStageHeader");
        expect(sections).toContain('aria-label={t("episodeNavigation")}');
        expect(sections).toContain("data-drama-episode-sidebar");
        expect(sections).toContain("min-[1366px]:block");
        expect(sections).toContain("stageStatuses");
        expect(sections).toContain('"pendingReview"');
        expect(sections).toContain('aria-label={t("openProjectAssets")}');
        expect(sections).not.toContain('value: "assets"');
        expect(sections).toContain("assetsOpen");
        expect(sections).toContain("onOpenAssets");
        expect(page).toContain("open={episodeNavigatorOpen && !assetsOpen}");
        expect(page).toContain("setAssetsOpen(true)");
        expect(sections).toContain("data-drama-script-statusbar");
        expect(sections).toContain('step="01"');
        expect(elements).toContain("data-drama-stage-metrics");
        expect(elements).toContain("border-l border-border/80");
        expect(page).toContain("data-drama-script-global-bar");
        expect(page).toContain("min-[1366px]:!pl-[210px]");
        expect(sections).toContain("w-[190px]");
        expect(sections).toContain("styles={{ container: { padding: 12, width: 320 } }}");
        expect(agent).toContain("size={360}");
        expect(agent).toContain("drama-agent-drawer");
        expect(agent).toContain('aria-label={t("panelAria")}');
        expect(agent).toContain("data-drama-agent-panel-frame");
        expect(agent).toContain("useState(404)");
        expect(agent).toContain('aria-label={t("panelAria")}');
        expect(agent).toContain('aria-label={t("resizeAria")}');
        expect(sections).toContain("data-drama-agent-trigger");
        expect(page).not.toContain("data-drama-agent-handle");
        expect(sections).not.toContain(">Agent</span>");
        expect(page).toContain('episode.reviewStatus === "draft"');
        expect(page).toContain('updateEpisode(project.id, episode.id, { reviewStatus: "content_review" })');
        expect(page).toContain('setStage("review")');
        expect(agent).not.toContain("data-drama-right-workspace");
        expect(agent).not.toContain("DramaEpisodeSettings");
        expect(sections).not.toContain("<Tabs");
        expect(agent).toContain("activated");
        expect(agent).not.toContain("剧本右侧工作栏");
        expect(agent).toContain("destroyOnHidden={false}");
    });
});
