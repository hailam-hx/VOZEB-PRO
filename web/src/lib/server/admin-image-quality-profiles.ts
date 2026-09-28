import { AuthInputError, type AuthSettings } from "@/lib/auth/store";
import { normalizeImageQualityProfile } from "@/lib/image-quality-profile";

export function normalizeAdminImageQualityProfiles(models: AuthSettings["logicalModels"]) {
    return models.map((model) => {
        const bindingIds = new Set((model.bindings || []).map((binding) => binding.id));
        return {
            ...model,
            bindings: (model.bindings || []).map((binding) => {
                if (binding.imageQualityProfile === undefined) return binding;
                const profile = normalizeImageQualityProfile(binding.imageQualityProfile);
                if (!profile) throw new AuthInputError(`模型 ${model.id} 的图片画质控制配置无效`);
                for (const option of profile.options) {
                    if (option.effect.type === "model_variant" && !bindingIds.has(option.effect.targetBindingId)) throw new AuthInputError(`模型 ${model.id} 的画质变体目标不属于当前逻辑模型`);
                    if (option.effect.type === "resolution_tier" && !binding.generationParameters?.supportsCustomSize && binding.generationParameters?.pixelSizes?.length) {
                        const unsupported = option.effect.exactSizes.find((size) => !binding.generationParameters?.pixelSizes.includes(size));
                        if (unsupported) throw new AuthInputError(`模型 ${model.id} 的画质选项包含 binding 不支持的尺寸 ${unsupported}`);
                    }
                }
                return { ...binding, imageQualityProfile: profile };
            }),
        };
    });
}
