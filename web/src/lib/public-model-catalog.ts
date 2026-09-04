type PublicModelCapability = "image" | "video" | "text" | "audio";
type PublicLogicalModel = {
    id: string;
    capability: PublicModelCapability;
    bindings?: ReadonlyArray<{ enabled?: boolean; generationParameters?: { audioOperation?: "speech" | "voice-clone" } }>;
};

export function resolvePublicCapabilityModels(logicalModels: readonly PublicLogicalModel[], fallback: Record<PublicModelCapability, string[]>) {
    return Object.fromEntries(
        (Object.keys(fallback) as PublicModelCapability[]).map((capability) => {
            const logical = logicalModels.filter((model) => model.capability === capability && (capability !== "audio" || isSpeechModel(model))).map((model) => model.id);
            return [capability, logical.length ? logical : fallback[capability]];
        }),
    ) as Record<PublicModelCapability, string[]>;
}

function isSpeechModel(model: PublicLogicalModel) {
    if (!model.bindings?.length) return true;
    return model.bindings.some((binding) => binding.enabled !== false && binding.generationParameters?.audioOperation !== "voice-clone");
}

export function flattenPublicCapabilityModels(models: Record<PublicModelCapability, string[]>) {
    return Array.from(new Set([models.image, models.video, models.text, models.audio].flat()));
}
