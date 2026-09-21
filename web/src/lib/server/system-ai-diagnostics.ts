const MAX_DIAGNOSTIC_STRING_CHARS = 4 * 1024;

export function sanitizeDiagnosticText(value: string) {
    const bounded = value.slice(0, MAX_DIAGNOSTIC_STRING_CHARS);
    if (/^data:/i.test(bounded)) return "<redacted-data-url>";
    if (/^https?:\/\//i.test(bounded)) {
        try {
            const url = new URL(bounded);
            const hadQuery = Boolean(url.search);
            url.search = "";
            url.hash = "";
            return `${url.toString()}${hadQuery ? "?<redacted>" : ""}`;
        } catch {
            return "<redacted-url>";
        }
    }
    return bounded
        .replace(/https?:\/\/[^\s"'<>]+/gi, (match) => {
            try {
                const url = new URL(match);
                const hadQuery = Boolean(url.search);
                url.search = "";
                url.hash = "";
                return `${url.toString()}${hadQuery ? "?<redacted>" : ""}`;
            } catch {
                return "<redacted-url>";
            }
        })
        .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer <redacted>")
        .replace(/([?&](?:signature|x-amz-signature|x-amz-credential|x-amz-security-token|token|access_token|api_key)=)[^&\s"']+/gi, "$1<redacted>");
}
