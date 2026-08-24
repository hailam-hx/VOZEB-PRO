import type { DramaAssetReference, DramaProject, DramaShot } from "../types";
import type { useEffectiveConfig } from "@/stores/use-config-store";
import { resolveDramaGenerationSize } from "@/lib/drama-image-size";
import type { ReferenceImage } from "@/types/image";
import type { VideoReferenceRole } from "@/lib/video-reference-contract";
import { requestCreditCost } from "@/constant/credits";
import { decimal } from "@/lib/billing/decimal";

export function shotReferenceImages(project: DramaProject, shot: DramaShot) {
    const assetUrls = [...project.characters.filter((item) => shot.characterIds.includes(item.id)), ...project.scenes.filter((item) => item.id === shot.sceneId), ...project.props.filter((item) => shot.propIds.includes(item.id))].flatMap((item) => {
        const reference = primaryAssetReference(item);
        return reference ? [referenceImage(item.id, `${item.name}.png`, reference.url, "image/png", reference.width, reference.height)] : [];
    });
    const sourceUrls = (project.sourceAssets || []).flatMap((item) => {
        if (item.type !== "image") return [];
        const url = item.serverUrl || item.remoteUrl;
        return url ? [referenceImage(item.id, item.title, url, item.mimeType, item.width, item.height)] : [];
    });
    return [...assetUrls, ...sourceUrls];
}

export function storyboardReferenceImages(shot: DramaShot) {
    return [
        shot.storyboardImageUrl ? referenceImage(`storyboard-start-${shot.id}`, `${shot.title}-起始帧.png`, shot.storyboardImageUrl, "image/png", shot.storyboardImageWidth, shot.storyboardImageHeight, "first_frame") : null,
        shot.storyboardFrameMode === "first_last" && shot.storyboardEndImageUrl
            ? referenceImage(`storyboard-end-${shot.id}`, `${shot.title}-结束帧.png`, shot.storyboardEndImageUrl, "image/png", shot.storyboardEndImageWidth, shot.storyboardEndImageHeight, "last_frame")
            : null,
    ].filter((item): item is ReturnType<typeof referenceImage> => Boolean(item));
}

function primaryAssetReference(item: DramaProject["characters"][number]): Pick<DramaAssetReference, "url" | "width" | "height"> | undefined {
    return item.references?.find((reference) => reference.id === item.primaryReferenceId) || item.references?.[0] || (item.referenceImageUrl ? { url: item.referenceImageUrl } : undefined);
}

export function referenceImage(id: string, name: string, url: string, type = "image/png", width?: number, height?: number, videoRole?: VideoReferenceRole): ReferenceImage {
    return { id, name, type, dataUrl: url, url, width, height, ...(videoRole ? { videoRole } : {}), ...(url.startsWith("/") ? { serverUrl: url } : /^https?:\/\//i.test(url) ? { remoteUrl: url } : {}) };
}

export function dramaGenerationSize(project: DramaProject, prompt: string, references: ReferenceImage[] = []) {
    return resolveDramaGenerationSize({ projectSize: project.ratio, prompt, references });
}

export function estimateTaskPoints(config: ReturnType<typeof useEffectiveConfig>, type: "image" | "video" | "audio", duration = 5, characters?: string) {
    return Number(estimateTaskCredits(config, type, duration, characters));
}

function estimateTaskCredits(config: ReturnType<typeof useEffectiveConfig>, type: "image" | "video" | "audio", duration = 5, characters?: string) {
    const model = type === "image" ? config.imageModel || config.model : type === "video" ? config.videoModel || config.model : config.audioModel;
    return requestCreditCost({
        apiSource: config.apiSource,
        logicalModels: config.logicalModels,
        kind: type,
        model,
        count: 1,
        quality: type === "image" ? config.quality : undefined,
        videoQuality: type === "video" ? config.vquality : undefined,
        videoSeconds: type === "video" ? duration : undefined,
        resolution: type === "image" ? config.size : undefined,
        format: type === "audio" ? config.audioFormat : undefined,
        characters,
    });
}

export function estimateEpisodePoints(config: ReturnType<typeof useEffectiveConfig>, project: DramaProject, shots: DramaShot[]) {
    const total = shots.reduce((sum, shot) => {
        const mode = shot.videoMode || project.defaultVideoMode;
        const text = (shot.subtitle || shot.dialogue || shot.narration).trim();
        const image = mode === "storyboard" ? decimal(estimateTaskCredits(config, "image")).times(decimal(shot.storyboardFrameMode === "first_last" ? 2 : 1)) : decimal(0);
        const audio = shot.audioMode === "voiceover" && text ? decimal(estimateTaskCredits(config, "audio", 5, text)) : decimal(0);
        return sum
            .plus(image)
            .plus(decimal(estimateTaskCredits(config, "video", shot.duration)))
            .plus(audio);
    }, decimal(0));
    return Number(total.toString());
}
