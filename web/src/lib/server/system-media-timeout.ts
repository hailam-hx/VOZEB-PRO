import { readGenerationMediaClaim } from "@/lib/server/generation-media-authorization";
import { resolveModelRequestTimeoutMs } from "@/lib/server/model-request-policy";

export function systemMediaTimeoutMs(request: Request, expected: { userId: string; channelId: string; url: string }) {
    const taskType = readGenerationMediaClaim(request, expected)?.taskType || "image";
    return resolveModelRequestTimeoutMs(undefined, taskType);
}
