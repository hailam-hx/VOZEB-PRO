import { describe, expect, it } from "vitest";

import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import { buildCanvasNodeConfig, resolveCanvasGenerationModel } from "./canvas-node-config";
import { CanvasNodeType, type CanvasNodeData } from "../types";

const config: AiConfig = {
    ...defaultConfig,
    model: "image-main",
    imageModel: "image-main",
    videoModel: "studio-motion",
    textModel: "writer-main",
    audioModel: "voice-main",
    models: ["image-main", "image-alt", "studio-motion", "writer-main", "voice-main"],
    imageModels: ["image-main", "image-alt"],
    videoModels: ["studio-motion"],
    textModels: ["writer-main"],
    audioModels: ["voice-main"],
};

describe("resolveCanvasGenerationModel", () => {
    it("switches to the first model exposed by the selected capability", () => {
        expect(resolveCanvasGenerationModel(config, "video", "image-alt")).toBe("studio-motion");
        expect(resolveCanvasGenerationModel(config, "text", "studio-motion")).toBe("writer-main");
        expect(resolveCanvasGenerationModel(config, "audio", "writer-main")).toBe("voice-main");
    });

    it("preserves a model that belongs to the selected capability", () => {
        expect(resolveCanvasGenerationModel(config, "image", "IMAGE-ALT")).toBe("image-alt");
    });

    it("does not show an unavailable model when the capability has no configured model", () => {
        expect(resolveCanvasGenerationModel({ ...config, videoModels: [] }, "video", "image-main")).toBe("");
    });

    it("preserves a persisted exact size when the model changes instead of rewriting it to a default", () => {
        const node: CanvasNodeData = {
            id: "config-node",
            type: CanvasNodeType.Config,
            title: "Config",
            position: { x: 0, y: 0 },
            width: 320,
            height: 240,
            metadata: { size: "4097x17", model: "image-main" },
        };

        const next = buildCanvasNodeConfig({ ...config, size: "1:1" }, node, "image", "image-alt");

        expect(next.model).toBe("image-alt");
        expect(next.size).toBe("4097x17");
        expect(node.metadata).toEqual({ size: "4097x17", model: "image-main" });
    });
});
