import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("public work preview layout", () => {
    it("keeps prompt actions in place and compacts the author interaction header", async () => {
        const [preview, community] = await Promise.all([readFile(resolve(process.cwd(), "src/components/works/public-work-preview-modal.tsx"), "utf8"), readFile(resolve(process.cwd(), "src/components/works/public-work-community-actions.tsx"), "utf8")]);

        expect(preview).toContain('aria-label={t("viewCountAria")}');
        expect(preview).toContain("flex h-8 min-w-0 flex-1 items-center");
        expect(preview).not.toContain('<p className="flex h-8 min-w-0 flex-1 items-center');
        expect(preview).toContain('className="mt-3.5 break-words text-lg');
        expect(preview).toContain("compactFollowIcon");
        expect(preview).toContain('aria-label={t("share")}');
        expect(preview).toContain('aria-label={t("closeDetails")}');
        expect(preview).toContain('<Tooltip title={t("copyPrompt")}>');
        expect(preview).toContain('t("remix")');
        expect(preview).toContain("createAgentPromptHref");
        expect(preview).not.toContain("`/${mediaType}");
        expect(preview).toContain("mt-3 inline-flex h-10 w-full");
        expect(preview).toContain('className="mt-4 flex min-w-0 flex-wrap gap-1"');
        expect(preview.indexOf('<Tooltip title={t("copyPrompt")}>')).toBeLessThan(preview.indexOf('t("remix")'));
        expect(community).toContain("compactFollowIcon");
        expect(community).toContain('shape={compact && compactFollowIcon ? "circle" : "default"}');
    });
});
