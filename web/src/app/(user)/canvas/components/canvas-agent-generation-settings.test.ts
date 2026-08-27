import { describe, expect, it } from "vitest";

import { canvasAgentCompactPreferenceSummary, updateCanvasAgentGenerationPreferences } from "./canvas-agent-generation-settings";

describe("Canvas Agent generation settings", () => {
    it("maps explicit image size, quality and count into the existing config surface", () => {
        const preferences = updateCanvasAgentGenerationPreferences({}, "image", { size: "1536x1024", quality: "high", count: 4 });

        expect(preferences).toEqual({ mode: "image", image: { size: "1536x1024", quality: "high", count: 4 } });
    });

    it("preserves an arbitrary administrator-configured image quality in submitted request preferences", () => {
        const preferences = updateCanvasAgentGenerationPreferences({}, "image", { quality: "studio" });
        const request = { preferences };

        expect(request.preferences).toEqual({ mode: "image", image: { quality: "studio" } });
        expect(updateCanvasAgentGenerationPreferences(preferences, "image", { quality: undefined })).toEqual({ mode: "image", image: {} });
    });

    it("maps custom video dimensions and output controls into Agent preferences", () => {
        const preferences = updateCanvasAgentGenerationPreferences({}, "video", { size: "1080x1920", quality: "1080", seconds: 10, generateAudio: false, watermark: true });

        expect(preferences).toEqual({ mode: "video", video: { size: "1080x1920", quality: "1080", seconds: 10, generateAudio: false, watermark: true } });
    });

    it("keeps the compact trigger readable without dropping the primary output values", () => {
        expect(canvasAgentCompactPreferenceSummary("image", { mode: "image", image: { size: "1:1", quality: "low", count: 4 } })).toBe("1:1 · 4 images");
        expect(canvasAgentCompactPreferenceSummary("video", { mode: "video", video: { size: "16:9", quality: "1080", seconds: 10, generateAudio: true, watermark: false } })).toBe("16:9 · 10s");
        expect(canvasAgentCompactPreferenceSummary("image", {})).toBe("Smart");
        expect(canvasAgentCompactPreferenceSummary("video", {})).toBe("Smart");
        expect(canvasAgentCompactPreferenceSummary("image", { mode: "image", image: { size: "1824x1024", quality: "high", count: 4 } })).toBe("1824×1024");
        expect(canvasAgentCompactPreferenceSummary("video", { mode: "video", video: { size: "1080x1920", quality: "1080", seconds: 10 } })).toBe("1080×1920");
    });
});
