import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { normalizePositiveInteger, normalizePositiveNumber, normalizeVideoQuality } from "@/components/creative-generation-preference-fields";
import { generationPreferenceSummary, normalizeGenerationCount } from "@/components/creative-generation-preferences";

const zhCopy = {
    smartParameters: "智能参数",
    smartRatio: "智能比例",
    smartClarity: "智能清晰度",
    withAudio: "有声",
    withoutAudio: "无声",
    withWatermark: "带水印",
    withoutWatermark: "无水印",
    imageQuality: { auto: "智能画质", high: "高画质", medium: "中画质", low: "低画质" },
    referenceMode: { reference: "智能参考", first_frame: "首帧", first_last: "首尾帧" },
    seconds: (value: number) => `${value}秒`,
    count: (value: number, capability: "image" | "video" | "audio") => `${value}${capability === "image" ? "张" : "条"}`,
};

describe("generationPreferenceSummary", () => {
    it("keeps image, video and audio settings readable in one compact label", () => {
        expect(generationPreferenceSummary("image", {}, zhCopy)).toBe("智能参数");
        expect(generationPreferenceSummary("video", { video: { size: "16:9", quality: "2160", seconds: 60, count: 3, generateAudio: false, watermark: true } }, zhCopy)).toBe("16:9 · 2160P · 60秒 · 无声 · 带水印 · 3条");
        expect(generationPreferenceSummary("image", { image: { size: "1024x1536", quality: "high", count: 2 } }, zhCopy)).toBe("1024×1536 · 高画质 · 2张");
        expect(generationPreferenceSummary("audio", { audio: { voice: "nova", format: "wav", speed: 1.25 } }, zhCopy)).toBe("Nova · WAV · 1.25x");
        expect(generationPreferenceSummary("audio", { audio: { voice: "narrator-pro", format: "m4a" } }, zhCopy)).toBe("narrator-pro · m4a");
        expect(generationPreferenceSummary("video", {}, zhCopy)).toBe("智能参数");
    });

    it("accepts custom generation counts within the server contract", () => {
        expect(normalizeGenerationCount("6")).toBe(6);
        expect(normalizeGenerationCount(10)).toBe(10);
        expect(normalizeGenerationCount(11)).toBe(11);
        expect(normalizeGenerationCount("0")).toBe(0);
        expect(normalizeGenerationCount("6份")).toBe(0);
    });

    it("accepts open-ended video and audio values without inventing capability ceilings", () => {
        expect(normalizeVideoQuality(" 8K ")).toBe("8K");
        expect(normalizePositiveInteger(60)).toBe(60);
        expect(normalizePositiveInteger(1.5)).toBe(0);
        expect(normalizePositiveNumber(8)).toBe(8);
        expect(normalizePositiveNumber(0)).toBe(0);
    });

    it("exposes the same positive custom pixel editor for images and videos", async () => {
        const source = await readFile(resolve(process.cwd(), "src/components/creative-generation-preferences.tsx"), "utf8");

        expect(source).toContain('aria-label={t("openCustomPixelSize"');
        expect(source).toContain("<CustomMediaSizeEditor capability={capability}");
        expect(source).toContain('t("customMediaWidth"');
        expect(source).toContain('t("customMediaHeight"');
    });

    it("keeps media type above the canvas and output parameter tabs", async () => {
        const source = await readFile(resolve(process.cwd(), "src/components/creative-generation-preferences.tsx"), "utf8");

        expect(source.indexOf("availableCapabilities.map")).toBeLessThan(source.indexOf("<PreferencePanel"));
        expect(source.indexOf('t("visual")')).toBeLessThan(source.indexOf('t("output")'));
        expect(source.indexOf('t("ratio")')).toBeLessThan(source.indexOf('t("customPixelSize")'));
    });
});
