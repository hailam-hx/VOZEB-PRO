import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("public work share layout", () => {
    it("keeps media navigation, the main preview, public prompt and remix actions separate", async () => {
        const [page, mediaBrowser, promptActions, governanceActions, communityActions, likeButton] = await Promise.all([
            readFile(resolve(process.cwd(), "src/app/share/[slug]/page.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/components/works/public-work-media-browser.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/share/[slug]/work-prompt-actions.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/app/share/[slug]/work-governance-actions.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/components/works/public-work-community-actions.tsx"), "utf8"),
            readFile(resolve(process.cwd(), "src/components/works/public-work-like-button.tsx"), "utf8"),
        ]);

        expect(page).toContain("lg:grid-cols-[minmax(0,1fr)_340px]");
        expect(page).toContain("<PublicWorkMediaBrowser");
        expect(page).toContain("<PublicWorkCommunityActions");
        expect(page).toContain("work.publicPrompt");
        expect(page).toContain("<WorkPromptActions");
        expect(page).not.toContain("Bookmark");
        expect(page).not.toContain("MessageCircle");
        expect(page).not.toContain("WorkCommunitySection");
        expect(mediaBrowser).toContain('aria-label={t("aria")}');
        expect(mediaBrowser).toContain("aria-pressed={asset.id === active.id}");
        expect(promptActions).toContain('t("copyPrompt")');
        expect(promptActions).toContain('t("remix")');
        expect(governanceActions).toContain('t("linkCopied")');
        expect(governanceActions).toContain('t("remix")');
        expect(communityActions).toContain("PublicWorkLikeButton");
        expect(communityActions).toContain("setWorkAuthorFollow");
        expect(communityActions).not.toContain("setWorkFavorite");
        expect(communityActions).not.toContain("listWorkComments");
        expect(likeButton).toContain("setWorkLike(slug, !summary.liked)");
        expect(likeButton).toContain("aria-pressed={summary?.liked || false}");
        expect(likeButton).toContain('result.active ? t("liked") : t("unliked")');
    });
});
