import { describe, expect, it } from "vitest";
import { CreativeApiError } from "@/services/api/creative";
import { createErrorPresentation, retryableCreateTaskIds } from "./create-error-ux";

describe("/create public error presentation", () => {
    it("uses only an explicitly public validation message and blocks identical retry", () => {
        const error = new CreativeApiError("provider Bearer secret", 400, "UNSUPPORTED_CAPABILITY", undefined, "当前模型不支持所选参数");
        expect(createErrorPresentation(error, "submit")).toMatchObject({ kind: "validation", detail: "当前模型不支持所选参数", retryable: false, action: "change_input" });
    });

    it("keeps an unmarked API body secret out of the UI", () => {
        const error = new CreativeApiError("provider Bearer secret", 400);
        expect(JSON.stringify(createErrorPresentation(error, "upload"))).not.toContain("secret");
    });

    it.each([
        [429, "rate_limit", true],
        [503, "temporary", true],
        [408, "timeout", true],
        [504, "timeout", true],
        [401, "auth", false],
        [403, "forbidden", false],
        [402, "balance", false],
        [409, "conflict", false],
        [404, "expired", false],
    ] as const)("maps HTTP %s to %s with retryable %s", (status, kind, retryable) => {
        expect(createErrorPresentation(new CreativeApiError("private", status), "retry")).toMatchObject({ kind, retryable });
    });

    it("does not suggest an identical retry after an uncertain submission", () => {
        expect(createErrorPresentation(new CreativeApiError("provider raw body", 409, "SUBMISSION_UNKNOWN"), "submit")).toMatchObject({ messageKey: "submissionUnknown", retryable: false, action: "none" });
    });

    it("maps network failure without echoing browser diagnostics", () => {
        expect(createErrorPresentation(new TypeError("fetch failed at http://localhost/internal"), "reference")).toMatchObject({ kind: "network", retryable: true, action: "retry" });
    });

    it("uses an upload-specific fallback for an unexpected local failure", () => {
        expect(createErrorPresentation(new Error("private storage path"), "upload")).toMatchObject({ messageKey: "createUploadTemporaryFailure" });
    });

    it("selects only retryable failed tasks from a mixed Agent Run", () => {
        expect(
            retryableCreateTaskIds([
                { id: "ready", status: "completed", retryable: true },
                { id: "temporary", status: "failed", retryable: true },
                { id: "permanent", status: "failed", retryable: false },
            ]),
        ).toEqual(["temporary"]);
    });
});
