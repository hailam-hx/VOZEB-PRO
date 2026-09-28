import { CreativeApiError } from "@/services/api/creative";

type CreateErrorContext = "submit" | "upload" | "optimize" | "retry" | "reference" | "operation";
type CreateErrorMessageKey =
    | "createValidationFailed"
    | "createRateLimited"
    | "createTemporaryFailure"
    | "createRequestTimeout"
    | "createAuthRequired"
    | "createAccessDenied"
    | "createStateChanged"
    | "submissionUnknown"
    | "createNetworkError"
    | "createExpired"
    | "createInsufficientBalance"
    | "creationRequestFailed"
    | "createUploadTemporaryFailure"
    | "createOptimizeTemporaryFailure"
    | "createRetryTemporaryFailure"
    | "createReferenceTemporaryFailure"
    | "createOperationTemporaryFailure";
export type CreateErrorPresentation = {
    kind: "validation" | "rate_limit" | "temporary" | "timeout" | "auth" | "forbidden" | "conflict" | "network" | "expired" | "balance" | "unknown";
    messageKey: CreateErrorMessageKey;
    detail?: string;
    retryable: boolean;
    action: "retry" | "change_input" | "reupload" | "add_balance" | "none";
};

const contextFallbackKeys: Record<CreateErrorContext, CreateErrorMessageKey> = {
    submit: "creationRequestFailed",
    upload: "createUploadTemporaryFailure",
    optimize: "createOptimizeTemporaryFailure",
    retry: "createRetryTemporaryFailure",
    reference: "createReferenceTemporaryFailure",
    operation: "createOperationTemporaryFailure",
};

export function createErrorPresentation(error: unknown, context: CreateErrorContext): CreateErrorPresentation {
    const editAction = context === "upload" || context === "reference" ? "reupload" : "change_input";
    if (error instanceof CreativeApiError) {
        if (error.errorCode === "INSUFFICIENT_BALANCE" || error.status === 402) return { kind: "balance", messageKey: "createInsufficientBalance", retryable: false, action: "add_balance" };
        if (error.errorCode === "SUBMISSION_UNKNOWN") return { kind: "conflict", messageKey: "submissionUnknown", retryable: false, action: "none" };
        if (error.status === 401) return { kind: "auth", messageKey: "createAuthRequired", retryable: false, action: "none" };
        if (error.status === 403) return { kind: "forbidden", messageKey: "createAccessDenied", retryable: false, action: "none" };
        if (error.status === 404 || error.status === 410) return { kind: "expired", messageKey: "createExpired", retryable: false, action: "none" };
        if (error.status === 408 || error.status === 504) return { kind: "timeout", messageKey: "createRequestTimeout", retryable: true, action: "retry" };
        if (error.status === 429) return { kind: "rate_limit", messageKey: "createRateLimited", retryable: true, action: "retry" };
        if (error.status === 425) return { kind: "temporary", messageKey: "createTemporaryFailure", retryable: true, action: "retry" };
        if (error.status === 409) return { kind: "conflict", messageKey: "createStateChanged", ...(error.publicMessage ? { detail: error.publicMessage } : {}), retryable: false, action: "none" };
        if (error.status >= 400 && error.status < 500) return { kind: "validation", messageKey: "createValidationFailed", ...(error.publicMessage ? { detail: error.publicMessage } : {}), retryable: false, action: editAction };
        if (error.status >= 500) return { kind: "temporary", messageKey: "createTemporaryFailure", ...(error.publicMessage ? { detail: error.publicMessage } : {}), retryable: true, action: "retry" };
    }
    if (error instanceof DOMException && error.name === "AbortError") return { kind: "timeout", messageKey: "createRequestTimeout", retryable: true, action: "retry" };
    if (error instanceof TypeError) return { kind: "network", messageKey: "createNetworkError", retryable: true, action: "retry" };
    return { kind: "unknown", messageKey: contextFallbackKeys[context], retryable: true, action: "retry" };
}

export function retryableCreateTaskIds(tasks: Array<{ id: string; status: string; retryable?: boolean }>) {
    return tasks.filter((task) => task.status === "failed" && task.retryable !== false).map((task) => task.id);
}
