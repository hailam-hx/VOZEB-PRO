import { describe, expect, it, vi } from "vitest";
import { auditGenerationPrompt } from "./generation-prompt-audit";

describe("generation prompt audit", () => {
    const originalPrompt = "  你好，请慢慢说。  ";
    const audit = { originalPrompt, executionPrompt: originalPrompt.trim(), manualPromptEnhancementEnabled: false };

    it("accepts exact speech text in a custom content field", () => {
        vi.spyOn(console, "info").mockImplementation(() => undefined);
        expect(() => auditGenerationPrompt({ audit, strict: true, body: JSON.stringify({ content: originalPrompt, voice: "alloy" }), capability: "audio", model: "voice-tts-pro" })).not.toThrow();
        vi.restoreAllMocks();
    });

    it("rejects a second rewritten speech input before upstream submission", () => {
        vi.spyOn(console, "info").mockImplementation(() => undefined);
        expect(() => auditGenerationPrompt({ audit, strict: true, body: JSON.stringify({ prompt: originalPrompt, input: `${originalPrompt} 保持语气自然` }), capability: "audio", model: "voice-tts-pro" })).toThrow("手动模型 Prompt 与用户原文不一致");
        vi.restoreAllMocks();
    });
});
