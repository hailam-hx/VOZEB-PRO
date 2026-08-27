import { parseImageDimensions } from "@/lib/image-size";

export function normalizeDramaImageSize(value: unknown) {
    if (typeof value !== "string") return "";
    const normalized = value.trim().replace(/[：；;]/g, ":");
    if (normalized.toLowerCase() === "auto") return "auto";
    const ratio = normalized.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (ratio && Number(ratio[1]) > 0 && Number(ratio[2]) > 0) return `${Number(ratio[1])}:${Number(ratio[2])}`;
    const dimensions = normalized.match(/^(\d+)\s*(?:x|\*|×)\s*(\d+)$/i);
    if (!dimensions) return "";
    const width = Number(dimensions[1]);
    const height = Number(dimensions[2]);
    return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 ? `${width}x${height}` : "";
}

export function resolveDramaGenerationSize(input: { projectSize: string; prompt: string; references?: Array<{ width?: number; height?: number }> }) {
    const requested = extractDramaPromptSize(input.prompt);
    const project = normalizeDramaImageSize(input.projectSize);
    const custom = parseImageDimensions(project) ? project : "";
    const reference = input.references?.map((item) => exactReferenceRatio(item.width, item.height)).find(Boolean) || "";
    return requested || custom || reference || project || "auto";
}

function extractDramaPromptSize(prompt: string) {
    const dimensions = prompt.match(/(?:^|[^\d])(\d+)\s*(?:x|\*|×)\s*(\d+)(?!\d)/i);
    if (dimensions) return normalizeDramaImageSize(`${dimensions[1]}x${dimensions[2]}`);
    const ratio = prompt.match(/(?:比例|画幅|宽高比|尺寸)?\s*(?:为|是|[:：])?\s*(\d+(?:\.\d+)?)\s*[:：；;]\s*(\d+(?:\.\d+)?)/i);
    return ratio ? normalizeDramaImageSize(`${ratio[1]}:${ratio[2]}`) : "";
}

function exactReferenceRatio(width: number | undefined, height: number | undefined) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || !width || !height || width <= 0 || height <= 0) return "";
    const divisor = greatestCommonDivisor(width, height);
    return `${width / divisor}:${height / divisor}`;
}

function greatestCommonDivisor(left: number, right: number) {
    let a = left;
    let b = right;
    while (b) [a, b] = [b, a % b];
    return a;
}

export function dramaOutputDimensions(size: string, landscapeWidth = 1280, landscapeHeight = 720) {
    const dimensions = parseImageDimensions(normalizeDramaImageSize(size));
    if (dimensions) return dimensions;
    return size === "16:9" ? { width: landscapeWidth, height: landscapeHeight } : { width: landscapeHeight, height: landscapeWidth };
}
