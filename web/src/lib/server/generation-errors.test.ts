import { describe, expect, it } from "vitest";

import { imagePersistenceFailure, imageSubmissionFailure } from "./generation-errors";

describe("image generation error taxonomy", () => {
    it("maps a rejected 400 without exposing its raw body publicly", () => {
        const raw = "invalid size; signed_url=https://secret.example/token";
        expect(imageSubmissionFailure(400, raw)).toEqual({
            code: "UPSTREAM_BAD_REQUEST",
            category: "upstream",
            message: raw,
            publicMessage: "上游拒绝了当前生成参数，请调整参数或更换模型后重试。",
            actionHint: "请检查比例、尺寸、画质和参考素材是否符合当前模型要求。",
            retryable: false,
        });
    });

    it("maps a 502 to submission unknown and disables blind retry", () => {
        expect(imageSubmissionFailure(502, "<html>gateway error</html>")).toMatchObject({ code: "SUBMISSION_UNKNOWN", category: "upstream", retryable: false });
    });

    it("preserves a private persistence diagnostic separately from public copy", () => {
        const failure = imagePersistenceFailure("https://signed.example/token timed out");
        expect(failure).toMatchObject({ code: "MEDIA_DOWNLOAD_TIMEOUT", category: "persistence", retryable: false });
        expect(failure.publicMessage).not.toContain("signed.example");
    });
});
