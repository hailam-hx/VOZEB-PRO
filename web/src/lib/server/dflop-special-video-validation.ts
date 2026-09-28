import type { LogicalModelBinding } from "@/lib/auth/store-types";
import type { VideoValidationNormalizedContext } from "@/lib/video-validation";

import { buildDflopSpecialVideoSteps, estimateDflopSpecialVideoBound } from "./dflop-special-video-contract";
import { fetchSafeOutbound } from "./safe-outbound-fetch";
import { verifyDflopValidationAvatar } from "./dflop-special-avatar-fixture";
import type { verifyValidationFixturePack } from "./validation-fixture-pack";
import { canonicalJson } from "./video-validation-fingerprint";
import { createHash } from "node:crypto";

type VerifiedPack = Awaited<ReturnType<typeof verifyValidationFixturePack>>;

export async function resolveDflopSpecialVideoValidation(
    modelId: string,
    binding: LogicalModelBinding,
    pack: VerifiedPack,
    options: { channel?: { baseUrl: string; apiKey: string }; verifyClipTemplate?: (templateId: string) => Promise<boolean>; verifyAvatarReady?: (avatarId: string) => Promise<boolean> } = {},
) {
    const model = modelId.toLowerCase();
    const needed = model.startsWith("dh-lipsync")
        ? ["talking-video", "driving-audio"]
        : model === "dh-motion"
          ? ["motion-source", "portrait-1", ...(pack.assets["motion-source"]?.asset.faceCount === 2 ? ["portrait-2"] : [])]
          : model === "dh-avatar"
            ? ["driving-audio"]
            : ["talking-video"];
    const missing = needed.find((name) => !pack.assets[name]?.verified);
    if (missing)
        return { ok: false as const, reasonCode: pack.assets[missing]?.reason || (model.startsWith("dh-lipsync") ? "PUBLIC_VIDEO_AND_AUDIO_REQUIRED" : model === "dh-motion" ? "PUBLIC_VIDEO_AND_PORTRAIT_REQUIRED" : "SPECIAL_FIXTURE_UNAVAILABLE") };
    const talking = pack.assets["talking-video"]?.asset;
    const audio = pack.assets["driving-audio"]?.asset;
    const motion = pack.assets["motion-source"]?.asset;
    const portrait = pack.assets["portrait-1"]?.asset;
    if (model.startsWith("dh-lipsync") && (!talking?.faceCount || talking.faceCount < 1)) return { ok: false as const, reasonCode: "FIXTURE_FACE_UNVERIFIED" };
    if (model.startsWith("dh-lipsync") && audio?.audioPresent !== true) return { ok: false as const, reasonCode: "FIXTURE_AUDIO_UNVERIFIED" };
    if (model === "dh-avatar" && audio?.audioPresent !== true) return { ok: false as const, reasonCode: "FIXTURE_AUDIO_UNVERIFIED" };
    if (model === "clip-compose" && talking?.speechPresent !== true) return { ok: false as const, reasonCode: "FIXTURE_SPEECH_UNVERIFIED" };
    if (model === "dh-motion" && (!motion?.faceCount || motion.faceCount < 1 || !portrait?.faceCount || portrait.faceCount < 1)) return { ok: false as const, reasonCode: "FIXTURE_FACE_UNVERIFIED" };
    if (model === "dh-motion" && motion!.faceCount! > 2) return { ok: false as const, reasonCode: "MOTION_PORTRAIT_COUNT_UNVERIFIED" };
    if (model === "dh-motion" && motion!.faceCount! > 1 && !pack.assets["portrait-2"]?.verified) return { ok: false as const, reasonCode: pack.assets["portrait-2"]?.reason || "PUBLIC_VIDEO_AND_PORTRAIT_REQUIRED" };
    try {
        const contract = buildDflopSpecialVideoSteps(model, {
            videoUrl: (model === "dh-motion" ? motion : talking)?.publicUrl || undefined,
            videoDurationSeconds: String(Math.ceil(((model === "dh-motion" ? motion : talking)?.durationMs || 0) / 1000)),
            audioUrl: audio?.publicUrl || undefined,
            audioDurationSeconds: String(Math.ceil((audio?.durationMs || 0) / 1000)),
            portraitUrl: portrait?.publicUrl || undefined,
            portraitUrls: model === "dh-motion" ? [portrait?.publicUrl, ...(motion?.faceCount === 2 ? [pack.assets["portrait-2"]?.asset.publicUrl] : [])].filter((value): value is string => Boolean(value)) : undefined,
            faceCount: model === "dh-motion" ? motion?.faceCount || undefined : undefined,
            motionTier: model === "dh-motion" ? motionTier(binding) : undefined,
            avatarId: process.env.VOZEB_PRO_VIDEO_VALIDATION_AVATAR_ID,
            templateId: process.env.VOZEB_PRO_VIDEO_VALIDATION_CLIP_TEMPLATE_ID,
            sourceLanguage: process.env.VOZEB_PRO_VIDEO_VALIDATION_SUBTITLE_SOURCE_LANGUAGE,
            targetLanguages: process.env.VOZEB_PRO_VIDEO_VALIDATION_SUBTITLE_TARGET_LANGUAGES?.split(",").map((value) => value.trim()),
        });
        if (contract.kind === "avatar") {
            const avatarId = process.env.VOZEB_PRO_VIDEO_VALIDATION_AVATAR_ID?.trim();
            if (!avatarId || !(await (options.verifyAvatarReady || ((id) => (options.channel ? verifyDflopValidationAvatar({ ...options.channel, avatarId: id }) : Promise.resolve(false))))(avatarId)))
                return { ok: false as const, reasonCode: "AVATAR_ASSET_NOT_READY" };
        }
        const profile = binding.providerPricingProfile;
        const cost = estimateDflopSpecialVideoBound({ contract, pricing: { status: profile?.status || "MISSING", raw: profile?.raw || {}, conversion: profile?.conversion } });
        if (!cost.ok) return cost;
        if (contract.kind === "subtitle") return { ok: false as const, reasonCode: "SUBTITLE_RESULT_SCHEMA_UNVERIFIED" };
        if (contract.kind === "clip-compose") {
            const templateId = process.env.VOZEB_PRO_VIDEO_VALIDATION_CLIP_TEMPLATE_ID?.trim();
            if (!templateId || !(await (options.verifyClipTemplate || ((id) => verifyDflopClipTemplate(options.channel, id)))(templateId))) return { ok: false as const, reasonCode: "CLIP_TEMPLATE_UNVERIFIED" };
        }
        const fixtureHashes = Object.fromEntries(needed.map((name) => [name, pack.assets[name]!.asset.sha256!]));
        const context: VideoValidationNormalizedContext = {
            count: "1",
            durationSeconds: contract.billingDurationSeconds,
            resolution: contract.tier || "auto",
            aspectRatio: "auto",
            generateAudio: false,
            watermark: false,
            references: [],
            special: { kind: contract.kind, steps: contract.steps, fixtureHashes, pricingSource: cost.pricingSource },
        };
        return {
            ok: true as const,
            context,
            cost: {
                ...cost,
                boundEvidence: {
                    source: "DFLOP_SPECIAL_PUBLIC_REGISTRY" as const,
                    pricingRevision: binding.costRateCard?.revision || "",
                    durationSeconds: context.durationSeconds,
                    count: "1",
                    pricingSource: cost.pricingSource,
                    ...("stepCosts" in cost ? { stepCosts: cost.stepCosts } : {}),
                },
            },
            requestPayloadDigest: createHash("sha256").update(canonicalJson(contract.steps)).digest("hex"),
        };
    } catch (error) {
        return { ok: false as const, reasonCode: error instanceof Error ? error.message : "SPECIAL_CONTRACT_INVALID" };
    }
}

async function verifyDflopClipTemplate(channel: { baseUrl: string; apiKey: string } | undefined, templateId: string) {
    if (!channel?.apiKey) return false;
    try {
        const base = channel.baseUrl.replace(/\/+$/, "");
        const root = base.endsWith("/v1") ? base : `${base}/v1`;
        const response = await fetchSafeOutbound(`${root}/videos/clip-templates`, { headers: { Authorization: `Bearer ${channel.apiKey}` }, cache: "no-store" });
        if (!response.ok) return false;
        const payload: unknown = await response.json();
        return Boolean(payload && typeof payload === "object" && "list" in payload && Array.isArray(payload.list) && payload.list.some((item: unknown) => item && typeof item === "object" && "style_id" in item && item.style_id === templateId));
    } catch {
        return false;
    }
}

function motionTier(binding: LogicalModelBinding): "fast" | "standard" | "max" | undefined {
    const tiers = binding.generationParameters?.resolutions || [];
    return (["fast", "standard", "max"] as const).find((tier) => tiers.includes(tier));
}
