import { isIP } from "node:net";

import { decimal } from "@/lib/billing/decimal";

type Fixtures = {
    videoUrl?: string;
    videoDurationSeconds?: string;
    audioUrl?: string;
    audioDurationSeconds?: string;
    portraitUrl?: string;
    portraitUrls?: string[];
    avatarId?: string;
    motionTier?: "fast" | "standard" | "max";
    faceCount?: number;
    sourceLanguage?: string;
    targetLanguages?: string[];
    templateId?: string;
};

type Step = { path: "/videos/generations" | "/videos/clip-subtitles"; body: Record<string, unknown> };

export function buildDflopSpecialVideoSteps(modelId: string, fixtures: Fixtures): { kind: string; billingDurationSeconds: string; steps: Step[]; tier?: string; translationCount?: number } {
    const model = modelId
        .trim()
        .replace(/^models\//i, "")
        .toLowerCase();
    const video = () => publicHttps(fixtures.videoUrl, "VIDEO_FIXTURE_UNAVAILABLE");
    const audio = () => publicHttps(fixtures.audioUrl, "AUDIO_FIXTURE_UNAVAILABLE");
    const videoDuration = () => duration(fixtures.videoDurationSeconds, "VIDEO_DURATION_UNVERIFIED");
    const audioDuration = () => duration(fixtures.audioDurationSeconds, "AUDIO_DURATION_UNVERIFIED");
    if (model === "dh-avatar") {
        if (!fixtures.avatarId?.trim()) throw new Error("AVATAR_ASSET_REQUIRED");
        const seconds = audioDuration();
        return { kind: "avatar", billingDurationSeconds: String(seconds), steps: [{ path: "/videos/generations", body: { model, avatar: fixtures.avatarId.trim(), audio_url: audio(), duration: seconds } }] };
    }
    if (["dh-lipsync", "dh-lipsync-pro", "dh-lipsync-max"].includes(model)) {
        const seconds = audioDuration();
        return { kind: "lipsync", billingDurationSeconds: String(seconds), steps: [{ path: "/videos/generations", body: { model, source_video_url: video(), audio_url: audio(), duration: seconds } }] };
    }
    if (model === "dh-motion") {
        const seconds = videoDuration();
        const tier = fixtures.motionTier;
        if (!tier) throw new Error("MOTION_TIER_UNVERIFIED");
        const faceCount = fixtures.faceCount || 1;
        if (!Number.isInteger(faceCount) || faceCount < 1 || faceCount > 7) throw new Error("MOTION_FACE_COUNT_INVALID");
        const portraits = fixtures.portraitUrls || (fixtures.portraitUrl ? [fixtures.portraitUrl] : []);
        if (portraits.length !== faceCount) throw new Error("MOTION_PORTRAIT_COUNT_UNVERIFIED");
        return {
            kind: "motion",
            billingDurationSeconds: String(seconds),
            tier,
            steps: [
                {
                    path: "/videos/generations",
                    body: { model, source_video_url: video(), face_count: faceCount, resolution: tier, content: portraits.map((url) => ({ type: "image_url", image_url: { url: publicHttps(url, "PORTRAIT_FIXTURE_UNAVAILABLE") } })), duration: seconds },
                },
            ],
        };
    }
    if (model === "tvod-subtitle-soft") {
        const seconds = videoDuration();
        const language = fixtures.sourceLanguage;
        const targets = fixtures.targetLanguages;
        const supported = new Set("zh en ja ko fr es de ru pt vi id th ms ar hi it tr".split(" "));
        if (!language || !targets || !supported.has(language) || !targets.length || targets.some((target) => !supported.has(target) || target === language) || new Set(targets).size !== targets.length) throw new Error("SUBTITLE_LANGUAGE_UNVERIFIED");
        return {
            kind: "subtitle",
            billingDurationSeconds: String(seconds),
            translationCount: targets.length,
            steps: [{ path: "/videos/generations", body: { model, source_video_url: video(), source_language: language, target_languages: targets } }],
        };
    }
    if (model === "clip-compose") {
        const seconds = videoDuration();
        if (seconds > 300) throw new Error("CLIP_SOURCE_TOO_LONG");
        if (!fixtures.templateId?.trim()) throw new Error("CLIP_TEMPLATE_UNVERIFIED");
        const source = video();
        return {
            kind: "clip-compose",
            billingDurationSeconds: String(seconds),
            steps: [
                { path: "/videos/clip-subtitles", body: { video_url: source } },
                { path: "/videos/generations", body: { model, video_url: source, asr_id: "$ASR_ID", video_style_id: fixtures.templateId.trim() } },
            ],
        };
    }
    throw new Error("SPECIAL_VIDEO_CONTRACT_UNKNOWN");
}

export function parseDflopClipAsrId(payload: unknown) {
    const id = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>).asr_id : undefined;
    if (typeof id !== "string" || !id.trim()) throw new Error("ASR_ID_MISSING");
    return id.trim();
}

export function parseDflopSpecialVideoResult(modelId: string, payload: unknown) {
    if (!payload || typeof payload !== "object") throw new Error("PROVIDER_RESPONSE_INVALID");
    const result = payload as Record<string, unknown>;
    if (result.status !== "succeeded") return { status: result.status };
    if (modelId === "tvod-subtitle-soft") {
        throw new Error("SUBTITLE_RESULT_SCHEMA_UNVERIFIED");
    }
    if (typeof result.video_url !== "string" || !/^https:\/\//i.test(result.video_url)) throw new Error("VIDEO_RESULT_MISSING");
    return { status: "completed", resultUrls: [result.video_url] };
}

type SpecialPricing = {
    status: string;
    raw: Record<string, unknown>;
    conversion?: { dflopCreditsPerCny: string; cnyToUsd: string; hotxUsdPerCredit: string };
};

export function estimateDflopSpecialVideoBound(input: { contract: ReturnType<typeof buildDflopSpecialVideoSteps>; pricing: SpecialPricing }) {
    const { contract, pricing } = input;
    if (contract.kind === "avatar") return { ok: false as const, reasonCode: "AVATAR_PRICING_SOURCE_CONFLICT" };
    if (pricing.status !== "READY" || !pricing.conversion) return { ok: false as const, reasonCode: "SPECIAL_PRICING_INCOMPLETE" };
    const raw = pricing.raw;
    let rate: string | undefined;
    let pricingSource = "PUBLIC_REGISTRY_VIDEO_SECOND";
    if (contract.kind === "clip-compose") {
        rate = typeof raw.price_per_video_task === "string" ? raw.price_per_video_task : undefined;
        pricingSource = "PUBLIC_REGISTRY_COMPOSE_AND_OFFICIAL_ASR_ZERO";
    } else if (contract.kind === "motion") {
        const tiers = raw.video_price_tiers;
        rate = tiers && typeof tiers === "object" && !Array.isArray(tiers) && typeof (tiers as Record<string, unknown>)[contract.tier || ""] === "string" ? (tiers as Record<string, string>)[contract.tier || ""] : undefined;
        pricingSource = "PUBLIC_REGISTRY_MOTION_TIER";
    } else if (contract.kind === "subtitle") {
        const tiers = raw.video_price_tiers;
        if (tiers && typeof tiers === "object" && !Array.isArray(tiers)) {
            const values = tiers as Record<string, unknown>;
            if (typeof values.asr === "string" && typeof values.translate === "string")
                rate = decimal(values.asr)
                    .plus(decimal(values.translate).times(decimal(contract.translationCount || 0)))
                    .toString();
        }
        pricingSource = "PUBLIC_REGISTRY_SUBTITLE_UNITS";
    } else if (typeof raw.price_per_video_second === "string") rate = raw.price_per_video_second;
    if (!rate) return { ok: false as const, reasonCode: "SPECIAL_PRICING_INCOMPLETE" };
    try {
        const provider = contract.kind === "clip-compose" ? decimal(rate) : decimal(rate).times(decimal(contract.billingDurationSeconds));
        const conversion = pricing.conversion;
        const credits = provider.dividedBy(decimal(conversion.dflopCreditsPerCny)).times(decimal(conversion.cnyToUsd)).dividedBy(decimal(conversion.hotxUsdPerCredit));
        if (provider.isNegative() || credits.isNegative()) throw new Error("invalid cost");
        return {
            ok: true as const,
            estimatedProviderCost: { amount: provider.toString(), currency: "DFLOP_CREDITS", unit: "task" },
            estimatedCredits: credits.ceilToDecimalPlaces(8).toString(),
            pricingSource,
            ...(contract.kind === "clip-compose"
                ? {
                      stepCosts: [
                          { step: "ASR", amount: "0", source: "DFLOP_DIGITAL_HUMAN_API_DOCS_CURRENT_ZERO" },
                          { step: "COMPOSE", amount: provider.toString(), source: "PUBLIC_REGISTRY_PRICE_PER_VIDEO_TASK" },
                      ],
                  }
                : {}),
        };
    } catch {
        return { ok: false as const, reasonCode: "SPECIAL_PRICING_INCOMPLETE" };
    }
}

function duration(value: string | undefined, code: string) {
    const seconds = Number(value);
    if (!value || !Number.isSafeInteger(seconds) || seconds <= 0) throw new Error(code);
    return seconds;
}

function publicHttps(value: string | undefined, code: string) {
    try {
        const url = new URL(value || "");
        const host = url.hostname.toLowerCase();
        if (url.protocol === "https:" && !url.username && !url.password && host && host !== "localhost" && !host.endsWith(".localhost") && !host.endsWith(".local") && !host.endsWith(".internal") && !isIP(host)) return url.toString();
    } catch {
        // The missing or malformed fixture is reported with its specific field code.
    }
    throw new Error(code);
}
