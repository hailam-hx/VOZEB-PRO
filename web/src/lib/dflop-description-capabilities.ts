import type { DflopDescriptionCapabilityField } from "@/lib/auth/store-types";

export const DFLOP_DESCRIPTION_CAPABILITY_FIELDS = [
    "referenceImage",
    "maxReferenceImages",
    "referenceVideo",
    "maxReferenceVideos",
    "referenceAudio",
    "maxReferenceAudios",
    "firstFrame",
    "lastFrame",
    "firstLastFrame",
    "textToVideo",
    "imageToVideo",
    "videoToVideo",
    "generateAudio",
    "fps",
    "maxReferenceVideoDuration",
    "maxTotalReferenceVideoDuration",
] as const satisfies readonly DflopDescriptionCapabilityField[];

export type DflopDescriptionCapabilityValues = Record<DflopDescriptionCapabilityField, boolean | number | null>;
export type DflopDescriptionCapabilityEvidence = Partial<Record<DflopDescriptionCapabilityField, string>>;

export type DflopDescriptionCapabilities = {
    values: DflopDescriptionCapabilityValues;
    evidence: DflopDescriptionCapabilityEvidence;
};

type MutableResult = DflopDescriptionCapabilities;

export function parseDflopDescriptionCapabilities(description: unknown): DflopDescriptionCapabilities {
    const text = typeof description === "string" ? description.trim().slice(0, 4_000) : "";
    const result: MutableResult = { values: emptyValues(), evidence: {} };
    if (!text) return result;

    parseReferenceImages(text, result);
    parseReferenceVideo(text, result);
    parseReferenceAudio(text, result);
    parseFirstLastFrame(text, result);
    parseFirstFrame(text, result);
    parseGenerationModes(text, result);
    parseAudioOutput(text, result);
    parseFps(text, result);
    parseReferenceLimits(text, result);
    return result;
}

function parseReferenceImages(text: string, result: MutableResult) {
    const negative = firstMatch(text, [/不支持(?:任何)?(?:参考图片|参考图|图片参考)/i, /(?:does not support|doesn't support|no)\s+(?:reference images?|image references?)/i, /(?:reference images?|image references?)\s+(?:is|are)\s+not supported/i]);
    if (negative) set(result, "referenceImage", false, negative);
    else {
        const positive =
            multimodalEvidence(text) ||
            firstMatch(text, [
                /(?:参考图片|参考图|图片参考|图片多模态参考)/i,
                /(?:reference images?|image references?|references? from images?)/i,
                /(?:up to|≤|<=)\s*\d+\s*(?:reference\s+)?images?/i,
                /最多\s*\d+\s*张?(?:参考)?图片/i,
                /图片\s*[（(]\s*[≤<=]\s*\d+\s*张?\s*[）)]/i,
            ]);
        if (positive) set(result, "referenceImage", true, positive);
    }
    const limit = firstNumberMatch(text, [
        /图片\s*[（(]\s*[≤<=]\s*(\d+)\s*张?\s*[）)]/i,
        /最多\s*(\d+)\s*张?(?:参考)?图片/i,
        /(?:up to|≤|<=)\s*(\d+)\s*(?:reference\s+)?images?/i,
        /reference images?\s+up to\s+(\d+)/i,
        /images?\s*[（(]\s*[≤<=]\s*(\d+)\s*[）)]/i,
    ]);
    if (limit) {
        set(result, "maxReferenceImages", limit.value, limit.evidence);
        if (result.values.referenceImage === null) set(result, "referenceImage", true, limit.evidence);
    }
}

function parseReferenceVideo(text: string, result: MutableResult) {
    const negative = firstMatch(text, [/不支持(?:任何)?(?:参考视频|视频参考)/i, /(?:does not support|doesn't support|no)\s+(?:reference videos?|video references?)/i, /(?:reference videos?|video references?)\s+(?:is|are)\s+not supported/i]);
    if (negative) return set(result, "referenceVideo", false, negative);
    const positive = multimodalEvidence(text) || firstMatch(text, [/(?:参考视频|视频参考|视频作为参考|视频多模态参考)/i, /(?:reference videos?|video references?|references? from video)/i]);
    if (positive) set(result, "referenceVideo", true, positive);
}

function parseReferenceAudio(text: string, result: MutableResult) {
    const negative = firstMatch(text, [/不支持(?:任何)?(?:参考音频|音频参考)/i, /(?:does not support|doesn't support|no)\s+(?:reference audio|audio references?)/i, /(?:reference audio|audio references?)\s+(?:is|are)\s+not supported/i]);
    if (negative) return set(result, "referenceAudio", false, negative);
    const positive = multimodalEvidence(text) || firstMatch(text, [/(?:参考音频|音频参考|音频作为参考|音频多模态参考)/i, /(?:reference audio|audio references?|references? from audio)/i]);
    if (positive) set(result, "referenceAudio", true, positive);
}

function parseFirstLastFrame(text: string, result: MutableResult) {
    const negative = firstMatch(text, [/不支持(?:首尾帧|首帧\s*[/+和与]\s*尾帧)/i, /(?:does not support|doesn't support|no)\s+(?:first[- ]and[- ]last|first\s*[/+]\s*last)\s+frames?/i]);
    if (negative) {
        set(result, "firstLastFrame", false, negative);
        return;
    }
    const positive = firstMatch(text, [/(?:首尾帧|首帧\s*[/+和与]\s*尾帧)/i, /(?:first[- ]and[- ]last|first\s*[/+]\s*last)\s+frames?/i]);
    if (!positive) return;
    set(result, "firstLastFrame", true, positive);
    set(result, "firstFrame", true, positive);
    set(result, "lastFrame", true, positive);
}

function parseFirstFrame(text: string, result: MutableResult) {
    if (result.values.firstFrame === true) return;
    const negative = firstMatch(text, [/不支持(?:首帧|首帧图|首帧图片)/i, /(?:does not support|doesn't support|no)\s+first[- ]frame(?: image)?/i]);
    if (negative) return set(result, "firstFrame", false, negative);
    const positive = firstMatch(text, [/(?:首帧生成视频|首帧图片|首帧图|首帧)/i, /first[- ]frame(?: image)?/i]);
    if (positive) set(result, "firstFrame", true, positive);
}

function parseGenerationModes(text: string, result: MutableResult) {
    parseBoolean(text, result, "textToVideo", [/(?:文生视频|文本生成视频)/i, /text[- ]to[- ]video/i], [/不支持(?:文生视频|文本生成视频)/i, /(?:does not support|no)\s+text[- ]to[- ]video/i]);
    parseBoolean(text, result, "imageToVideo", [/(?:图生视频|图片生成视频)/i, /image[- ]to[- ]video/i], [/不支持(?:图生视频|图片生成视频)/i, /(?:does not support|no)\s+image[- ]to[- ]video/i]);
    parseBoolean(
        text,
        result,
        "videoToVideo",
        [/(?:视频编辑|视频生视频|视频转视频)/i, /(?:video edit(?:ing)?|video[- ]to[- ]video)/i],
        [/不支持(?:视频编辑|视频生视频|视频转视频)/i, /(?:does not support|no)\s+(?:video edit(?:ing)?|video[- ]to[- ]video)/i],
    );
}

function parseAudioOutput(text: string, result: MutableResult) {
    parseBoolean(
        text,
        result,
        "generateAudio",
        [/(?:生成有声视频|支持生成音频|音频生成|带声音输出|可生成声音)/i, /(?:can generate sound|generate audio|audio generation|generate videos? with sound|native audio output)/i],
        [/(?:不支持生成音频|不能生成声音|无声音输出)/i, /(?:does not support|cannot)\s+(?:audio generation|generate audio|generate sound)|no audio output/i],
    );
}

function parseFps(text: string, result: MutableResult) {
    const match = firstNumberMatch(text, [/(\d{1,3})\s*fps\b/i, /帧率\s*[:：]?\s*(\d{1,3})(?:\s*fps)?/i, /(\d{1,3})\s*帧\s*[\/]\s*秒/i]);
    if (match) set(result, "fps", match.value, match.evidence);
}

function parseReferenceLimits(text: string, result: MutableResult) {
    const videoCount = firstNumberMatch(text, [/(?:最多|不超过)\s*(\d+)\s*个?参考视频/i, /(?:up to|≤|<=)\s*(\d+)\s*reference videos?/i]);
    if (videoCount) {
        set(result, "maxReferenceVideos", videoCount.value, videoCount.evidence);
        if (result.values.referenceVideo === null) set(result, "referenceVideo", true, videoCount.evidence);
    }
    const audioCount = firstNumberMatch(text, [/(?:最多|不超过)\s*(\d+)\s*个?参考音频/i, /(?:up to|≤|<=)\s*(\d+)\s*reference audios?/i]);
    if (audioCount) {
        set(result, "maxReferenceAudios", audioCount.value, audioCount.evidence);
        if (result.values.referenceAudio === null) set(result, "referenceAudio", true, audioCount.evidence);
    }
    const eachDuration = firstNumberMatch(text, [/(?:每个|单个)参考视频[^。；\n]{0,24}(?:最长|不超过)?\s*(\d+)\s*秒/i, /reference videos?\s*\[\s*\d+\s*,\s*(\d+)\s*]\s*seconds?\s+each/i, /(?:each|per)\s+reference video[^.;\n]{0,20}(\d+)\s*seconds?/i]);
    if (eachDuration) set(result, "maxReferenceVideoDuration", eachDuration.value, eachDuration.evidence);
    const totalDuration = result.values.referenceVideo === true ? firstNumberMatch(text, [/(?:参考视频)?总时长[^。；\n]{0,20}(?:最长|不超过)?\s*(\d+)\s*秒/i, /(\d+)\s*seconds?\s+total/i]) : undefined;
    if (totalDuration) set(result, "maxTotalReferenceVideoDuration", totalDuration.value, totalDuration.evidence);
}

function parseBoolean(text: string, result: MutableResult, field: DflopDescriptionCapabilityField, positives: RegExp[], negatives: RegExp[]) {
    const negative = firstMatch(text, negatives);
    if (negative) return set(result, field, false, negative);
    const positive = firstMatch(text, positives);
    if (positive) set(result, field, true, positive);
}

function multimodalEvidence(text: string) {
    return firstMatch(text, [/图片[^；。\n]{0,50}视频[^；。\n]{0,30}音频[^；。\n]{0,24}(?:多模态|组合)参考/i, /multimodal references? from images?[^.;\n]{0,40}videos?[^.;\n]{0,24}(?:and|,)\s*audio/i]);
}

function firstMatch(text: string, patterns: RegExp[]) {
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[0]) return match[0].trim();
    }
    return undefined;
}

function firstNumberMatch(text: string, patterns: RegExp[]) {
    for (const pattern of patterns) {
        const match = text.match(pattern);
        const value = Number(match?.[1]);
        if (match?.[0] && Number.isFinite(value) && value > 0) return { value, evidence: match[0].trim() };
    }
    return undefined;
}

function set(result: MutableResult, field: DflopDescriptionCapabilityField, value: boolean | number, evidence: string) {
    result.values[field] = value;
    result.evidence[field] = evidence.slice(0, 500);
}

function emptyValues(): DflopDescriptionCapabilityValues {
    return Object.fromEntries(DFLOP_DESCRIPTION_CAPABILITY_FIELDS.map((field) => [field, null])) as DflopDescriptionCapabilityValues;
}
