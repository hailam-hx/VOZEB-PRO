import { describe, expect, it } from "vitest";

import { validateGenerationParametersInput } from "./generation-parameters-admin-validation";
import { normalizeGenerationParameters } from "./generation-parameters";

describe("admin generation-parameter input validation", () => {
    it("normalizes valid ratio tags and accepts duplicate list entries", () => {
        expect(validateGenerationParametersInput({ aspectRatios: [" 16 : 9 ", "16:9"], durationMode: "discrete", durationSeconds: [5, 5] })).toBeUndefined();
        expect(normalizeGenerationParameters({ aspectRatios: [" 16 : 9 ", "16:9"], durationMode: "discrete", durationSeconds: [5, 5] })).toMatchObject({ aspectRatios: ["16:9"], durationMode: "discrete", durationSeconds: [5] });
    });

    it("rejects invalid raw tags and nonpositive or reversed ranges before normalization", () => {
        expect(validateGenerationParametersInput({ aspectRatios: ["not-a-ratio"] })).toBe("支持比例必须使用正数 W:H 格式");
        expect(validateGenerationParametersInput({ pixelSizes: ["0x1024"] })).toBe("精确尺寸必须使用正数 WIDTHxHEIGHT 格式");
        expect(validateGenerationParametersInput({ durationRange: { min: 10, max: 5 } })).toBe("视频时长范围的最小值不能大于最大值");
        expect(validateGenerationParametersInput({ speedRange: { min: 0, max: 1 } })).toBe("语速范围必须是正数");
    });

    it("keeps a newly selected video duration mode editable before its required values are entered", () => {
        expect(normalizeGenerationParameters({ durationMode: "discrete" })).toMatchObject({ durationMode: "discrete", durationSeconds: [] });
        expect(normalizeGenerationParameters({ durationMode: "range" })).toMatchObject({ durationMode: "range", durationSeconds: [] });
    });

    it("requires valid min-max ranges when custom count or duration is enabled", () => {
        expect(validateGenerationParametersInput({ supportsCustomDuration: true })).toBe("启用自定义时长时必须配置有效范围");
        expect(validateGenerationParametersInput({ supportsCustomDuration: true, customDurationRange: { min: 3, max: 20 } })).toBeUndefined();
        expect(validateGenerationParametersInput({ supportsCustomBatchSize: true, customBatchSizeRange: { min: 1.5, max: 10 } })).toBe("自定义数量范围必须是正整数");
        expect(validateGenerationParametersInput({ supportsCustomBatchSize: true, customBatchSizeRange: { min: 5, max: 10 } })).toBeUndefined();
    });

    it("validates voice cloning capability fields before normalization", () => {
        expect(validateGenerationParametersInput({ audioOperation: "speech", maxCharacters: 5000, voiceCatalog: "provider", supportsClonedVoices: true, speedAppliesTo: "cloned" })).toBeUndefined();
        expect(validateGenerationParametersInput({ audioOperation: "clone" })).toBe("音频操作类型无效");
        expect(validateGenerationParametersInput({ maxCharacters: 0 })).toBe("最大字符数必须是正整数");
        expect(validateGenerationParametersInput({ voiceCatalog: "remote" })).toBe("音色目录类型无效");
        expect(validateGenerationParametersInput({ supportsClonedVoices: "yes" })).toBe("supportsClonedVoices必须是布尔值");
        expect(validateGenerationParametersInput({ speedAppliesTo: "preset" })).toBe("语速适用范围无效");
    });
});
