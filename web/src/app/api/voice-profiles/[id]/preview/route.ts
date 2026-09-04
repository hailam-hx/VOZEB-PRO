import { apiError, apiSuccess } from "@/app/api/_shared/api-response";
import { calculatePricingReserve, normalizeBillableUsage } from "@/lib/billing/pricing";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings } from "@/lib/auth/store";
import { unicodeCodePointCount } from "@/lib/voice-selection";
import { fetchInternalApi, resolveInternalOrigin } from "@/lib/server/internal-origin";
import { resolveLogicalModelCandidates } from "@/lib/server/logical-model-router";
import { resolvePublicRequestOrigin } from "@/lib/server/public-request-origin";
import { createSignedReferenceAssetUrl } from "@/lib/server/reference-asset-access";
import { getVoiceProfileForUser } from "@/lib/server/voice-profile-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
type PreviewLocale = "zh-CN" | "en" | "vi";
type PreviewResolution =
    | { response: ReturnType<typeof apiError> }
    | {
          response?: never;
          user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
          profile: NonNullable<Awaited<ReturnType<typeof getVoiceProfileForUser>>>;
          settings: Awaited<ReturnType<typeof getAuthSettings>>;
          locale: PreviewLocale;
          sample: string;
      };

const samples: Record<PreviewLocale, string> = { "zh-CN": "你好呀", en: "Hello", vi: "Xin chào" };

export async function GET(request: Request, context: Context) {
    const resolved = await resolvePreview(request, context);
    if (resolved.response) return resolved.response;
    if (resolved.profile.previewStorageKey) return apiSuccess({ cached: true, url: previewUrl(request, resolved.profile.previewStorageKey) }, "");
    const estimatedPoints = estimatePoints(resolved.settings, resolved.profile.channelId!, resolved.sample);
    return apiSuccess({ cached: false, locale: resolved.locale, text: resolved.sample, estimatedPoints }, "");
}

export async function POST(request: Request, context: Context) {
    const body: { locale?: unknown; confirmed?: unknown } = await readJsonBody<{ locale?: unknown; confirmed?: unknown }>(request).catch(() => ({}));
    if (body.confirmed !== true) return apiError(400, "请确认预览将消耗积分");
    const resolved = await resolvePreview(request, context, body.locale);
    if (resolved.response) return resolved.response;
    if (resolved.profile.previewStorageKey) return apiSuccess({ cached: true, url: previewUrl(request, resolved.profile.previewStorageKey) }, "");
    const origin = resolveInternalOrigin(new URL(request.url).origin);
    const response = await fetchInternalApi(`${origin}/api/audio-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(request.headers.get("cookie") ? { cookie: request.headers.get("cookie")! } : {}) },
        body: JSON.stringify({
            config: { model: resolved.settings.defaultModels.audioModel, voiceSelection: { type: "profile", voiceProfileId: resolved.profile.id }, format: resolved.settings.generationDefaults.audioFormat },
            prompt: resolved.sample,
            source: `voice-profile-preview:${resolved.profile.id}`,
            context: { surface: "chat", clientRequestId: `voice-preview:${resolved.profile.id}:${resolved.locale}` },
        }),
        cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return apiError(response.status, payload?.error || "创建声音预览失败");
    return apiSuccess({ cached: false, task: payload?.task }, "声音预览任务已创建");
}

async function resolvePreview(request: Request, context: Context, requestedLocale?: unknown): Promise<PreviewResolution> {
    const user = await getCurrentUser(request);
    if (!user) return { response: apiError(401, "请先登录") } as const;
    const profile = await getVoiceProfileForUser(user.id, (await context.params).id);
    if (!profile || profile.status === "deleted") return { response: apiError(404, "声音档案不存在") } as const;
    if (profile.status !== "ready" || !profile.channelId || !profile.providerVoiceId) return { response: apiError(409, "声音档案尚未就绪") } as const;
    const locale = previewLocale(requestedLocale ?? new URL(request.url).searchParams.get("locale"));
    const settings = await getAuthSettings();
    const speech = resolveLogicalModelCandidates(settings, "audio", settings.defaultModels.audioModel).some(
        (candidate) => candidate.channelId === profile.channelId && (candidate.generationParameters?.audioOperation || "speech") === "speech" && candidate.generationParameters?.supportsClonedVoices === true,
    );
    if (!speech) return { response: apiError(409, "声音档案所在渠道没有可用的语音合成绑定") } as const;
    return { user, profile, settings, locale, sample: samples[locale] } as const;
}

function estimatePoints(settings: Awaited<ReturnType<typeof getAuthSettings>>, channelId: string, sample: string) {
    const logical = settings.logicalModels.find((model) => model.id === settings.defaultModels.audioModel && model.capability === "audio" && model.enabled);
    const binding = logical?.bindings.find((item) => item.enabled && item.channelId === channelId && (item.generationParameters?.audioOperation || "speech") === "speech" && item.generationParameters?.supportsClonedVoices === true);
    if (!logical?.saleRateCard || !binding) return null;
    try {
        return Number(
            calculatePricingReserve({
                rateCard: logical.saleRateCard,
                usage: normalizeBillableUsage({ capability: "audio", source: "request", request: 1, characters: unicodeCodePointCount(sample), count: 1, format: settings.generationDefaults.audioFormat }),
            }).credits,
        );
    } catch {
        return null;
    }
}

function previewLocale(value: unknown): PreviewLocale {
    return value === "en" || value === "vi" ? value : "zh-CN";
}

function previewUrl(request: Request, key: string) {
    return createSignedReferenceAssetUrl(key, resolvePublicRequestOrigin(request)) || `/api/reference-assets/${key.split("/").map(encodeURIComponent).join("/")}`;
}
