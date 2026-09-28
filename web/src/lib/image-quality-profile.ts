export type ImageQualityControlType = "request_parameter" | "model_variant" | "prompt_flag" | "resolution_tier" | "pixel_tier" | "none";
export type ImageQualitySelectionMode = "explicit" | "derived" | "none";
export type ImageQualityProfileSource = "manual" | "structured_upstream" | "provider_preset" | "description" | "none";
export type ImageQualityValidationStatus = "VALID" | "DRIFT" | "NEEDS_REVIEW" | "INVALID";

export type ImageQualityOptionEffect =
    | { type: "request_parameter"; requestParameter: { name: string; value: string | number | boolean } }
    | { type: "model_variant"; targetBindingId: string }
    | { type: "prompt_flag"; promptSuffix: "--sd" | "--hd"; mutexGroup: "midjourney-quality" }
    | { type: "resolution_tier"; resolutionTier: string; exactSizes: string[]; sizeByAspectRatio?: Record<string, string> }
    | { type: "pixel_tier"; pixelTier: string; minMegapixels?: string; maxMegapixels?: string }
    | { type: "none" };

export type ImageQualityOption = {
    value: string;
    label: string;
    optionRevision: string;
    effect: ImageQualityOptionEffect;
};

export type ImageQualityValidationReason = { code: string; message: string; severity: "warning" | "blocking" };
export type ImageQualityValidation = { status: ImageQualityValidationStatus; reasons: ImageQualityValidationReason[]; validatedAt: string };

export type ImageQualityProfileSnapshot = {
    version: 1;
    controlType: ImageQualityControlType;
    selectionMode: ImageQualitySelectionMode;
    source: ImageQualityProfileSource;
    options: ImageQualityOption[];
    defaultValue?: string;
    profileRevision: string;
    validation: ImageQualityValidation;
};

export type ImageQualityProfile = ImageQualityProfileSnapshot & { upstreamCandidate?: ImageQualityProfileSnapshot };

export type ImageQualityIntent = {
    value?: string;
    logicalProfileRevision?: string;
    optionRevision?: string;
    requestedSize?: string;
    requestedAspectRatio?: string;
};

export type ImageQualityErrorCode = "QUALITY_PROFILE_CHANGED" | "QUALITY_OPTION_UNAVAILABLE" | "QUALITY_CONTEXT_UNRESOLVABLE" | "QUALITY_TARGET_BINDING_INVALID" | "QUALITY_PRICING_UNAVAILABLE";

export type ResolvedImageQualityContext = {
    version: 1;
    logicalModelId: string;
    bindingId: string;
    qualityProfileRevision: string;
    selectedQualityValue?: string;
    optionRevision?: string;
    controlType: ImageQualityControlType;
    selectionMode: ImageQualitySelectionMode;
    resolvedSize?: string;
    resolvedWidth?: number;
    resolvedHeight?: number;
    resolvedResolutionTier?: string;
    resolvedPixelTier?: string;
    resolvedPromptSuffix?: string;
    effectivePrompt: string;
    requestParameters?: Record<string, string | number | boolean>;
    requestCount: number;
    billableOutputCount: number;
    pricingConditions: Record<string, string>;
    saleRateCardRevision?: string;
};

export type PublicImageQualityOption = {
    value: string;
    label: string;
    optionRevision: string;
    effect:
        | { type: "request_parameter" }
        | { type: "model_variant" }
        | { type: "prompt_flag"; promptSuffix: "--sd" | "--hd" }
        | { type: "resolution_tier"; resolutionTier: string; exactSizes: string[]; sizeByAspectRatio?: Record<string, string> }
        | { type: "pixel_tier"; pixelTier: string; minMegapixels?: string; maxMegapixels?: string }
        | { type: "none" };
};

export type PublicLogicalImageQualityProfile = {
    supported: boolean;
    controlType: ImageQualityControlType;
    selectionMode: ImageQualitySelectionMode;
    options: PublicImageQualityOption[];
    defaultValue?: string;
    profileRevision: string;
    billableOutputCount?: number;
};

type ProfileRevisionInput = Pick<ImageQualityProfileSnapshot, "controlType" | "selectionMode"> & {
    defaultValue?: string;
    options: Array<Pick<ImageQualityOption, "value" | "label" | "effect">>;
};

export function imageQualityOptionRevision(option: Pick<ImageQualityOption, "value" | "label" | "effect">) {
    return `image-quality-option-v1:${stableDigest(stableJson({ value: option.value.trim(), effect: option.effect }))}`;
}

export function imageQualityProfileRevision(profile: ProfileRevisionInput) {
    return `image-quality-profile-v1:${stableDigest(
        stableJson({
            controlType: profile.controlType,
            selectionMode: profile.selectionMode,
            defaultValue: profile.defaultValue,
            options: profile.options.map((option) => ({ value: option.value, effect: option.effect })),
        }),
    )}`;
}

export function normalizeImageQualityProfile(value: unknown): ImageQualityProfile | undefined {
    if (!record(value) || value.version !== 1) return undefined;
    const controlType = imageQualityControlType(value.controlType);
    const selectionMode = imageQualitySelectionMode(value.selectionMode);
    const source = imageQualityProfileSource(value.source);
    const validation = normalizeValidation(value.validation);
    if (!controlType || !selectionMode || !source || !validation || !Array.isArray(value.options)) return undefined;
    if ((controlType === "none") !== (selectionMode === "none")) return undefined;
    const options = value.options.map(normalizeOption);
    if (options.some((option) => !option)) return undefined;
    const normalizedOptions = options as ImageQualityOption[];
    if (new Set(normalizedOptions.map((option) => option.value)).size !== normalizedOptions.length) return undefined;
    if (controlType === "none" && normalizedOptions.length) return undefined;
    if (selectionMode === "explicit" && !normalizedOptions.length) return undefined;
    if (normalizedOptions.some((option) => option.effect.type !== controlType)) return undefined;
    const defaultValue = text(value.defaultValue);
    if (defaultValue && !normalizedOptions.some((option) => option.value === defaultValue)) return undefined;
    const base: ImageQualityProfileSnapshot = {
        version: 1,
        controlType,
        selectionMode,
        source,
        options: normalizedOptions,
        ...(defaultValue ? { defaultValue } : {}),
        profileRevision: "",
        validation,
    };
    base.profileRevision = imageQualityProfileRevision(base);
    const upstreamCandidate = normalizeImageQualityProfileSnapshot(value.upstreamCandidate);
    return { ...base, ...(upstreamCandidate ? { upstreamCandidate } : {}) };
}

export function publicLogicalImageQualityProfile(
    bindings: Array<{ id: string; imageQualityProfile?: ImageQualityProfile; providerPricingProfile?: { metadata?: Record<string, unknown> }; upstreamMetadata?: { runtime?: Record<string, unknown> } }>,
): PublicLogicalImageQualityProfile | undefined {
    const profiles = bindings
        .map((binding) => normalizeImageQualityProfile(binding.imageQualityProfile))
        .filter((profile): profile is ImageQualityProfile => Boolean(profile && executableValidation(profile.validation)))
        .sort((a, b) => a.profileRevision.localeCompare(b.profileRevision));
    if (!profiles.length) return undefined;
    const first = profiles[0];
    if (profiles.some((profile) => profile.controlType !== first.controlType || profile.selectionMode !== first.selectionMode)) return undefined;
    const grouped = new Map<string, ImageQualityOption[]>();
    for (const profile of profiles) {
        for (const option of profile.options) grouped.set(option.value, [...(grouped.get(option.value) || []), option]);
    }
    const options = Array.from(grouped.entries()).map(([value, candidates]) => {
        const representative = candidates[0];
        const optionRevision = `image-quality-public-option-v1:${stableDigest(stableJson(candidates.map((candidate) => candidate.optionRevision).sort()))}`;
        return { value, label: representative.label, optionRevision, effect: publicEffect(representative.effect) } satisfies PublicImageQualityOption;
    });
    const defaultValue = profiles.map((profile) => profile.defaultValue).find((value): value is string => Boolean(value && options.some((option) => option.value === value)));
    const outputCounts = Array.from(
        new Set(
            bindings
                .map((binding) => binding.providerPricingProfile?.metadata?.imagesPerRequest ?? binding.upstreamMetadata?.runtime?.imagesPerRequest)
                .map((value) => Number(value))
                .filter((value) => Number.isSafeInteger(value) && value > 0),
        ),
    );
    return {
        supported: first.selectionMode !== "none",
        controlType: first.controlType,
        selectionMode: first.selectionMode,
        options,
        ...(defaultValue ? { defaultValue } : {}),
        profileRevision: `image-quality-public-profile-v1:${stableDigest(stableJson(profiles.map((profile) => profile.profileRevision)))}`,
        ...(outputCounts.length === 1 ? { billableOutputCount: outputCounts[0] } : {}),
    };
}

export function normalizeMidjourneyQualityFlag(userPrompt: string, targetFlag: "--sd" | "--hd") {
    const tokens = userPrompt
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .filter((token) => !/^(?:--sd|--hd)$/i.test(token));
    return [...tokens, targetFlag].join(" ");
}

function normalizeImageQualityProfileSnapshot(value: unknown): ImageQualityProfileSnapshot | undefined {
    if (!value) return undefined;
    const profile = normalizeImageQualityProfile({ ...(record(value) ? value : {}), upstreamCandidate: undefined });
    if (!profile) return undefined;
    const { upstreamCandidate: _upstreamCandidate, ...snapshot } = profile;
    return snapshot;
}

function normalizeOption(value: unknown): ImageQualityOption | undefined {
    if (!record(value)) return undefined;
    const optionValue = text(value.value);
    const label = text(value.label);
    const effect = normalizeEffect(value.effect);
    if (!optionValue || !label || !effect) return undefined;
    const option = { value: optionValue, label, effect };
    return { ...option, optionRevision: imageQualityOptionRevision(option) };
}

function normalizeEffect(value: unknown): ImageQualityOptionEffect | undefined {
    if (!record(value)) return undefined;
    if (value.type === "none") return { type: "none" };
    if (value.type === "request_parameter" && record(value.requestParameter)) {
        const name = text(value.requestParameter.name);
        const parameterValue = value.requestParameter.value;
        if (name && (typeof parameterValue === "string" || typeof parameterValue === "number" || typeof parameterValue === "boolean")) return { type: "request_parameter", requestParameter: { name, value: parameterValue } };
    }
    if (value.type === "model_variant") {
        const targetBindingId = text(value.targetBindingId);
        if (targetBindingId) return { type: "model_variant", targetBindingId };
    }
    if (value.type === "prompt_flag" && (value.promptSuffix === "--sd" || value.promptSuffix === "--hd") && value.mutexGroup === "midjourney-quality") {
        return { type: "prompt_flag", promptSuffix: value.promptSuffix, mutexGroup: value.mutexGroup };
    }
    if (value.type === "resolution_tier") {
        const resolutionTier = text(value.resolutionTier);
        const exactSizes = Array.from(new Set((Array.isArray(value.exactSizes) ? value.exactSizes : []).map(text).filter((size): size is string => Boolean(size && /^\d+x\d+$/i.test(size)))));
        if (!resolutionTier || !exactSizes.length) return undefined;
        const sizeByAspectRatio = record(value.sizeByAspectRatio)
            ? Object.fromEntries(
                  Object.entries(value.sizeByAspectRatio).flatMap(([ratioValue, sizeValue]) => {
                      const ratio = text(ratioValue);
                      const size = text(sizeValue);
                      return ratio && size && exactSizes.includes(size) ? [[ratio, size]] : [];
                  }),
              )
            : undefined;
        return { type: "resolution_tier", resolutionTier, exactSizes, ...(sizeByAspectRatio && Object.keys(sizeByAspectRatio).length ? { sizeByAspectRatio } : {}) };
    }
    if (value.type === "pixel_tier") {
        const pixelTier = text(value.pixelTier);
        const minMegapixels = decimalText(value.minMegapixels);
        const maxMegapixels = decimalText(value.maxMegapixels);
        if (pixelTier && (minMegapixels || maxMegapixels)) return { type: "pixel_tier", pixelTier, ...(minMegapixels ? { minMegapixels } : {}), ...(maxMegapixels ? { maxMegapixels } : {}) };
    }
    return undefined;
}

function publicEffect(effect: ImageQualityOptionEffect): PublicImageQualityOption["effect"] {
    if (effect.type === "model_variant" || effect.type === "request_parameter") return { type: effect.type };
    if (effect.type === "prompt_flag") return { type: effect.type, promptSuffix: effect.promptSuffix };
    if (effect.type === "resolution_tier") return { type: effect.type, resolutionTier: effect.resolutionTier, exactSizes: [...effect.exactSizes], ...(effect.sizeByAspectRatio ? { sizeByAspectRatio: { ...effect.sizeByAspectRatio } } : {}) };
    if (effect.type === "pixel_tier") return { ...effect };
    return { type: "none" };
}

function normalizeValidation(value: unknown): ImageQualityValidation | undefined {
    if (!record(value) || !["VALID", "DRIFT", "NEEDS_REVIEW", "INVALID"].includes(String(value.status)) || !Array.isArray(value.reasons)) return undefined;
    const reasons = value.reasons
        .map((reason) =>
            record(reason) && text(reason.code) && text(reason.message) && (reason.severity === "warning" || reason.severity === "blocking") ? { code: text(reason.code)!, message: text(reason.message)!, severity: reason.severity } : undefined,
        )
        .filter((reason): reason is ImageQualityValidationReason => Boolean(reason));
    if (reasons.length !== value.reasons.length) return undefined;
    return { status: value.status as ImageQualityValidationStatus, reasons, validatedAt: text(value.validatedAt) || new Date(0).toISOString() };
}

function executableValidation(validation: ImageQualityValidation) {
    return (validation.status === "VALID" || validation.status === "DRIFT") && !validation.reasons.some((reason) => reason.severity === "blocking");
}

function imageQualityControlType(value: unknown): ImageQualityControlType | undefined {
    return ["request_parameter", "model_variant", "prompt_flag", "resolution_tier", "pixel_tier", "none"].includes(String(value)) ? (value as ImageQualityControlType) : undefined;
}

function imageQualitySelectionMode(value: unknown): ImageQualitySelectionMode | undefined {
    return ["explicit", "derived", "none"].includes(String(value)) ? (value as ImageQualitySelectionMode) : undefined;
}

function imageQualityProfileSource(value: unknown): ImageQualityProfileSource | undefined {
    return ["manual", "structured_upstream", "provider_preset", "description", "none"].includes(String(value)) ? (value as ImageQualityProfileSource) : undefined;
}

function decimalText(value: unknown) {
    const normalized = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
    return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized) ? normalized.replace(/(?:\.0+|(?<=\.[0-9]*?)0+)$/, "").replace(/\.$/, "") : undefined;
}

function text(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stableJson(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    return `{${Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
        .join(",")}}`;
}

function stableDigest(value: string) {
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        first = Math.imul(first ^ code, 0x01000193);
        second = Math.imul(second ^ code, 0x85ebca6b);
    }
    return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}
