import { describe, expect, it } from "vitest";

import { resolveTextProtocol } from "./text-protocol-resolver";

describe("text protocol streaming resolution", () => {
    it("keeps a native Gemini system-proxy Text Task request on its provider path", () => {
        expect(
            resolveTextProtocol({
                model: "gemini-3.1-pro-preview",
                apiFormat: "gemini",
                advancedConfig: { protocol: "globalaiopc", globalAiOpcPreset: "text-gemini-native" } as never,
                throughSystemProxy: true,
                preserveNativeProtocol: true,
            } as never),
        ).toMatchObject({ kind: "gemini", path: "/models/gemini-3.1-pro-preview:generateContent", supportsStreaming: true });
    });

    it("marks custom text protocols as buffered", () => {
        expect(
            resolveTextProtocol({
                model: "custom-model",
                apiFormat: "openai",
                advancedConfig: { protocol: "custom", createPath: "/jobs", requestTemplate: '{"prompt":"{{prompt}}"}', resultField: "data.text" } as never,
            }),
        ).toMatchObject({ kind: "custom", supportsStreaming: false });
    });
});
