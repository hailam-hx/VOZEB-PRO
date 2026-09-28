import { createHash, randomUUID } from "node:crypto";

import type { LogicalModel, SystemChannelModelConfig, SystemModelChannel } from "@/lib/auth/store-types";
import { decimal } from "@/lib/billing/decimal";
import { resolveSeedanceModelFamily } from "@/lib/billing/seedance-usage";
import { protocolModelConfig } from "@/lib/channel-protocol-registry";
import type { StartVideoValidationRunRequest, VideoValidationCanaryGroup, VideoValidationItem, VideoValidationPreview, VideoValidationPreviewItem, VideoValidationPreviewRequest, VideoValidationRun } from "@/lib/video-validation";
import { getFreshAuthSettings } from "@/lib/auth/store";
import { normalizeModelId } from "@/lib/model-capability";
import { toSystemGenerationChannel } from "@/lib/server/generation-channel";
import { fetchSafeOutbound } from "@/lib/server/safe-outbound-fetch";
import { createPostgresRepositories, getDatabaseProvider, withPostgresTransaction } from "./database";
import { dflopVideoValidationContract } from "./dflop-video-validation-contract";
import { resolveDflopSpecialVideoValidation } from "./dflop-special-video-validation";
import { loadValidationFixturePack, verifyValidationFixturePack } from "./validation-fixture-pack";
import { buildVideoContractCases, describeVideoContract, videoContractFamilyFingerprint } from "./video-validation-contract";
import { resolveMinimumVideoValidationContext } from "./video-validation-context";
import { estimateValidationCost, selectLowestCostCanaries } from "./video-validation-cost";
import { buildValidationExecutionSnapshot, buildVideoCanaryContractFingerprint, buildVideoValidationFingerprint, videoValidationCredentialRevision, type ValidationFingerprintV1 } from "./video-validation-fingerprint";
import { configuredValidationFixtures, validationFixtureUrl } from "./video-validation-fixtures";
import { probeVideoBinding } from "./video-validation-probe";
import { captureVideoValidationRequest } from "./video-generation-application";

export class VideoValidationServiceError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly status = 400,
    ) {
        super(message);
        this.name = "VideoValidationServiceError";
    }
}

type Snapshot = { logicalModels: LogicalModel[]; channels: SystemModelChannel[]; pricingPolicyVersion: string; publicRegistryModelIds?: ReadonlyMap<string, ReadonlySet<string>> };

export async function buildVideoValidationPreview(input: {
    request: VideoValidationPreviewRequest;
    logicalModels: LogicalModel[];
    channels: SystemModelChannel[];
    pricingPolicyVersion: string;
    publicRegistryModelIds?: ReadonlyMap<string, ReadonlySet<string>>;
    referenceFixtures?: { image: boolean; lastFrame?: boolean; video: boolean };
    specialFixturePack?: Awaited<ReturnType<typeof verifyValidationFixturePack>>;
    verifyClipTemplate?: (templateId: string) => Promise<boolean>;
    verifyAvatarReady?: (avatarId: string) => Promise<boolean>;
    latestVerifications?: Map<string, { fingerprintVersion: number; fingerprintHash: string; status: string }>;
}): Promise<VideoValidationPreview> {
    validateRequest(input.request);
    const channelMap = new Map(input.channels.map((channel) => [channel.id, channel]));
    const fixtures = input.referenceFixtures || (await configuredValidationFixtures());
    const selectedModels = input.logicalModels.filter((model) => model.capability === "video" && model.enabled && (!input.request.modelIds?.length || input.request.modelIds.includes(model.id)));
    const needsSpecialPack = selectedModels.some((model) =>
        model.bindings.some((binding) => {
            const channel = channelMap.get(binding.channelId);
            const contract = channel?.advancedConfig?.protocol === "dflop" ? dflopVideoValidationContract(binding.upstreamModel) : null;
            return contract && !contract.requestBranch.startsWith("grok-");
        }),
    );
    const specialFixturePack = input.specialFixturePack || (needsSpecialPack ? await verifyValidationFixturePack(await loadValidationFixturePack()) : { ready: false, assets: {} });
    const items: VideoValidationPreviewItem[] = [];
    for (const model of selectedModels) {
        for (const binding of model.bindings.filter((item) => !input.request.bindingIds?.length || input.request.bindingIds.includes(item.id))) {
            const channel = channelMap.get(binding.channelId);
            if (!channel) continue;
            const operation = videoOperation(channel, binding.upstreamModel);
            const probe = probeVideoBinding({ binding, channel, operation, credentialAvailable: channel.hasApiKey === true || Boolean(channel.apiKey), eligible: model.enabled && binding.enabled });
            const descriptor = describeVideoContract({
                protocol: channel.advancedConfig?.protocol || "auto",
                operation,
                generationParameters: binding.generationParameters,
                billingBases: pricingBases(binding.costRateCard),
                runtimeOptions: runtimeOptions(operation),
            });
            const contractFamily = videoContractFamilyFingerprint(descriptor);
            const dflopContract = channel.advancedConfig?.protocol === "dflop" ? dflopVideoValidationContract(binding.upstreamModel) : null;
            const specialCase = Boolean(dflopContract && !dflopContract.requestBranch.startsWith("grok-"));
            const pricingRevision = hash(binding.costRateCard || null);
            const fingerprint = buildVideoValidationFingerprint({
                provider: channel.advancedConfig?.protocol || "auto",
                endpointType: binding.upstreamMetadata?.endpointType || null,
                endpoints: { create: operation.createPath || "", query: operation.queryPath || "", ...(operation.imageToVideoPath ? { imageToVideo: operation.imageToVideoPath } : {}), ...(operation.cancelPath ? { cancel: operation.cancelPath } : {}) },
                protocol: {
                    protocolId: channel.advancedConfig?.protocol || "auto",
                    requestSchemaVersion: hash({ builder: "video-builder:v1", template: operation.requestTemplate || "" }),
                    parserVersion: hash({ parser: "video-parser:v1", status: operation.statusField, result: operation.resultField }),
                },
                capabilityProfile: {
                    generationParameters: binding.generationParameters || null,
                    executionOptions: runtimeOptions(operation),
                    referenceContract: { image: operation.supportsReferenceImage, video: operation.supportsReferenceVideo, audio: operation.supportsReferenceAudio },
                },
                billing: { billingBasis: pricingBases(binding.costRateCard), pricingRevision, normalizationRevision: "video-validation-usage:v1", conversionRevision: input.pricingPolicyVersion, actualCostCapabilityRevision: "unavailable:v1" },
                runtime: {
                    relevantConfigRevision: hash({
                        baseUrl: channel.baseUrl,
                        apiFormat: channel.apiFormat,
                        authMode: channel.advancedConfig?.authMode,
                        authHeader: channel.advancedConfig?.authHeader,
                        authPrefix: channel.advancedConfig?.authPrefix,
                        operation,
                        upstreamModel: binding.upstreamModel,
                    }),
                    credentialRevision: videoValidationCredentialRevision(channel.apiKey || "", process.env.VOZEB_PRO_ENCRYPTION_KEY || ""),
                    idempotencyReplayContractRevision: "unverified:v1",
                },
            });
            const contractCases = dflopContract
                ? [{ id: dflopContract.caseId, applicability: "APPLICABLE" as const }]
                : buildVideoContractCases({ operation, generationParameters: binding.generationParameters, runtimeOptions: runtimeOptions(operation) }).filter(
                      (item) => ["text-to-video", "image-to-video", "first-frame", "first-last-frame"].includes(item.id) && item.applicability === "APPLICABLE",
                  );
            for (const contractCase of contractCases) {
                const contractFingerprint = buildVideoCanaryContractFingerprint({
                    executionFingerprint: fingerprint,
                    caseId: contractCase.id,
                    pricingComponents: binding.costRateCard?.components || [],
                    usageAlgorithm: pricingBases(binding.costRateCard).includes("VIDEO_TOKEN") ? resolveSeedanceModelFamily(binding.upstreamModel) || "unverified-token" : "normalized-video-usage:v1",
                    requestBranch: dflopContract?.requestBranch,
                });
                const referenceMode = contractCase.id === "image-to-video" ? "reference" : contractCase.id === "first-frame" ? "first_frame" : contractCase.id === "first-last-frame" ? "first_last" : "text";
                const special =
                    specialCase && probe.status === "CONTRACT_READY"
                        ? await resolveDflopSpecialVideoValidation(binding.upstreamModel, binding, specialFixturePack, { channel, verifyClipTemplate: input.verifyClipTemplate, verifyAvatarReady: input.verifyAvatarReady })
                        : undefined;
                const resolved = specialCase
                    ? special?.ok
                        ? { ok: true as const, context: special.context, capabilityRevision: hash({ generationParameters: binding.generationParameters, fixtures: special.context.special?.fixtureHashes }) }
                        : undefined
                    : probe.status === "CONTRACT_READY" && !dflopContract?.blockedReason
                      ? resolveMinimumVideoValidationContext({ binding, referenceMode, allowAutoResolution: dflopContract?.allowAutoResolution, runtimeOptions: { generateAudio: true, watermark: true } })
                      : undefined;
                const fixtureReady = !resolved?.ok || resolved.context.references.every((reference) => (reference.role === "last_frame" ? (fixtures.lastFrame ?? fixtures.image) : fixtures[reference.fixture]));
                const cost = special?.ok
                    ? special.cost
                    : resolved?.ok && binding.costRateCard
                      ? estimateValidationCost({
                            rateCard: binding.costRateCard,
                            context: resolved.context,
                            providerPricingProfile: binding.providerPricingProfile,
                            seedanceModelFamily: resolveSeedanceModelFamily(binding.upstreamModel),
                            aspectRatios: binding.generationParameters?.aspectRatios,
                        })
                      : undefined;
                let requestPayloadDigest: string | undefined = special?.ok ? special.requestPayloadDigest : undefined;
                if (!specialCase && probe.status === "CONTRACT_READY" && resolved?.ok && cost?.ok && fixtureReady) {
                    try {
                        const config = toSystemGenerationChannel({ logicalModelId: model.id, upstreamModel: binding.upstreamModel, channelId: channel.id, channel, logicalModel: model, binding, generationParameters: binding.generationParameters });
                        const references = resolved.context.references.map((reference) => ({
                            type: reference.fixture,
                            role: reference.role,
                            url: validationFixtureUrl(reference) || `https://validation.invalid/${reference.fixture}`,
                        }));
                        requestPayloadDigest = await captureVideoValidationRequest({
                            channel: config,
                            raw: { size: resolved.context.aspectRatio, vquality: resolved.context.resolution, videoSeconds: resolved.context.durationSeconds, videoGenerateAudio: resolved.context.generateAudio, videoWatermark: resolved.context.watermark },
                            references,
                            multipliers: {} as Parameters<typeof captureVideoValidationRequest>[0]["multipliers"],
                            idempotencyKey: "validation-preview",
                        });
                    } catch {
                        requestPayloadDigest = undefined;
                    }
                }
                const ready = (!dflopContract?.blockedReason || special?.ok === true) && probe.status === "CONTRACT_READY" && resolved?.ok === true && cost?.ok === true && fixtureReady && Boolean(requestPayloadDigest);
                const prior = input.latestVerifications?.get(`${binding.id}:${contractCase.id}`);
                const credentialKnown = fingerprint.fingerprintSnapshot.runtime.credentialRevision !== null;
                const unchanged = credentialKnown && prior?.status === "PASSED" && prior.fingerprintVersion === fingerprint.fingerprintVersion && prior.fingerprintHash === fingerprint.fingerprintHash;
                const needsReconciliation = prior?.status === "UNKNOWN";
                items.push({
                    logicalModelId: model.id,
                    bindingId: binding.id,
                    channelId: channel.id,
                    upstreamModelId: binding.upstreamModel,
                    contractFamily,
                    caseId: contractCase.id,
                    fingerprintVersion: fingerprint.fingerprintVersion,
                    fingerprintHash: fingerprint.fingerprintHash,
                    contractFingerprintVersion: contractFingerprint.version,
                    contractFingerprintHash: contractFingerprint.hash,
                    sharedContractReason: contractFingerprint.sharedContractReason,
                    fingerprintSnapshot: fingerprint.fingerprintSnapshot as unknown as Record<string, unknown>,
                    requestPayloadDigest,
                    probe,
                    ...(resolved?.ok ? { normalizedContext: resolved.context, capabilityRevision: resolved.capabilityRevision } : { capabilityRevision: "" }),
                    pricingRevision,
                    estimatedProviderCost: cost?.ok ? cost.estimatedProviderCost : null,
                    estimatedCredits: cost?.ok ? cost.estimatedCredits : "0",
                    boundEvidence: cost?.ok ? cost.boundEvidence : undefined,
                    actualCostCapability: "UNAVAILABLE",
                    actualCostCapabilityEvidence: { source: "ADAPTER_CONTRACT", revision: "video-validation-actual-cost:v1", reason: "AUTHORITATIVE_PROVIDER_COST_NOT_EXPOSED" },
                    estimatedCostHotxCredits: cost?.ok ? cost.estimatedCredits : "0",
                    liveSelected: false,
                    contractReady: ready,
                    ...(channel.advancedConfig?.protocol === "dflop" &&
                    (input.publicRegistryModelIds?.get(channel.id)
                        ? !input.publicRegistryModelIds.get(channel.id)!.has(normalizeModelId(binding.upstreamModel))
                        : channel.advancedConfig.modelDiscovery?.[normalizeModelId(binding.upstreamModel)]?.matched === false)
                        ? { auditFlags: ["PUBLIC_REGISTRY_MISMATCH"] }
                        : {}),
                    ...(!ready
                        ? {
                              skipReason:
                                  (specialCase ? (!special?.ok ? special?.reasonCode : undefined) : dflopContract?.blockedReason) ||
                                  (resolved?.ok && !fixtureReady
                                      ? "REFERENCE_FIXTURE_UNAVAILABLE"
                                      : cost && !cost.ok
                                        ? cost.reasonCode
                                        : resolved && !resolved.ok
                                          ? resolved.reasonCode
                                          : probe.status !== "CONTRACT_READY"
                                            ? probe.reasonCode
                                            : "REQUEST_DESCRIPTOR_UNAVAILABLE"),
                          }
                        : ["changed_models", "family_sample"].includes(input.request.mode) && needsReconciliation
                          ? { skipReason: "NEEDS_RECONCILIATION" }
                          : ["changed_models", "family_sample"].includes(input.request.mode) && !credentialKnown && prior
                            ? { skipReason: "NEEDS_REVIEW_CREDENTIAL_REVISION" }
                            : ["changed_models", "family_sample"].includes(input.request.mode) && unchanged
                              ? { skipReason: "SKIPPED_UNCHANGED" }
                              : {}),
                });
            }
        }
    }
    if (input.request.mode !== "contract_only") {
        const ready = items.filter((item) => !item.skipReason && item.normalizedContext);
        const chosen = input.request.mode === "family_sample" ? selectLowestCostCanaries(ready.map((item) => ({ ...item, family: item.contractFamily, estimatedCost: item.estimatedCredits || "0" }))) : ready;
        const chosenIds = new Set(chosen.map((item) => `${item.bindingId}:${item.caseId}`));
        for (const item of items) {
            if (chosenIds.has(`${item.bindingId}:${item.caseId}`)) item.liveSelected = true;
            else if (!item.skipReason) item.skipReason = input.request.mode === "family_sample" ? "SKIPPED_CANARY_NOT_SELECTED" : undefined;
        }
    }
    const estimated = items
        .filter((item) => item.liveSelected)
        .reduce((sum, item) => sum.plus(decimal(item.estimatedCostHotxCredits)), decimal(0))
        .toString();
    const providerCostGroups = new Map<string, { amount: ReturnType<typeof decimal>; currency: string; unit: string }>();
    for (const item of items.filter((candidate) => candidate.liveSelected && candidate.estimatedProviderCost)) {
        const cost = item.estimatedProviderCost!;
        const key = `${cost.currency}:${cost.unit}`;
        const current = providerCostGroups.get(key);
        providerCostGroups.set(key, { currency: cost.currency, unit: cost.unit, amount: (current?.amount || decimal(0)).plus(decimal(cost.amount)) });
    }
    const registryRevision = hash({ models: selectedModels, channels: input.channels.map(redactChannel) });
    const previewBase = { request: input.request, registryRevision, pricingPolicyVersion: input.pricingPolicyVersion, items };
    const modelCases = new Map<string, VideoValidationPreviewItem[]>();
    for (const item of items) modelCases.set(item.logicalModelId, [...(modelCases.get(item.logicalModelId) || []), item]);
    const contractReadyModels = [...modelCases.values()].filter((cases) => cases.every((item) => item.contractReady)).length;
    const partialModels = [...modelCases.values()].filter((cases) => cases.some((item) => item.contractReady) && cases.some((item) => !item.contractReady)).length;
    const groups = new Map<string, VideoValidationPreviewItem[]>();
    for (const item of items) {
        const key = `${item.contractFingerprintVersion}:${item.contractFingerprintHash}`;
        groups.set(key, [...(groups.get(key) || []), item]);
    }
    const bindingMap = new Map(selectedModels.flatMap((model) => model.bindings.map((binding) => [binding.id, binding] as const)));
    const overBudget = decimal(estimated).greaterThan(decimal(input.request.maxBudgetHotxCredits));
    const canaryGroups: VideoValidationCanaryGroup[] = [...groups.values()].map((members) => {
        const selected = members.find((item) => item.liveSelected);
        const binding = selected && bindingMap.get(selected.bindingId);
        const channel = selected && channelMap.get(selected.channelId);
        const blockedReason = selected
            ? overBudget
                ? "BUDGET_EXCEEDED"
                : null
            : members.find((item) => item.skipReason && item.skipReason !== "SKIPPED_CANARY_NOT_SELECTED")?.skipReason || (input.request.mode === "contract_only" ? "CONTRACT_ONLY_NO_LIVE" : "NO_ELIGIBLE_BINDING");
        return {
            contractFingerprint: { version: members[0].contractFingerprintVersion || 1, hash: members[0].contractFingerprintHash || "", caseId: members[0].caseId },
            modelsInGroup: [...new Set(members.map((item) => item.logicalModelId))],
            sharedContractReason: members[0].sharedContractReason || "",
            selectedCanaryModel: selected?.logicalModelId || null,
            selectedTestCase: selected?.caseId || null,
            selectionReason: selected ? "LOWEST_ESTIMATED_CREDITS" : input.request.mode === "contract_only" && members.some((item) => item.contractReady) ? "CONTRACT_ONLY_NO_LIVE" : "NO_ELIGIBLE_BINDING",
            normalizedContext: selected?.normalizedContext || null,
            minimumDuration: selected?.normalizedContext?.durationSeconds || null,
            minimumResolution: selected?.normalizedContext?.resolution || null,
            audioEnabled: selected?.normalizedContext?.generateAudio ?? null,
            estimatedProviderCost: selected?.estimatedProviderCost || null,
            estimatedCredits: selected?.estimatedCredits || null,
            pricingSnapshot: binding
                ? {
                      rateCardRevision: binding.costRateCard?.revision || "",
                      pricingPolicyVersion: input.pricingPolicyVersion,
                      providerPricingStatus: binding.providerPricingProfile?.status,
                      ...(binding.providerPricingProfile?.conversion ? { conversion: { ...binding.providerPricingProfile.conversion } } : {}),
                  }
                : null,
            bindingId: selected?.bindingId || null,
            providerId: channel?.advancedConfig?.protocol || null,
            liveSubmitEligible: Boolean(selected && !overBudget),
            blockedReason,
        };
    });
    return {
        revision: `video-validation-preview:${hash(previewBase)}`,
        registryRevision,
        pricingPolicyVersion: input.pricingPolicyVersion,
        selectedModels: selectedModels.length,
        runnableModels: items.filter((item) => item.liveSelected).length,
        skippedModels: items.filter((item) => (input.request.mode === "contract_only" ? Boolean(item.skipReason) : !item.liveSelected)).length,
        estimatedProviderCostHotxCredits: input.request.mode === "contract_only" ? "0" : estimated,
        estimatedCredits: input.request.mode === "contract_only" ? "0" : estimated,
        estimatedProviderCosts: [...providerCostGroups.values()].map((cost) => ({ amount: cost.amount.toString(), currency: cost.currency, unit: cost.unit })),
        providerCostCoveredCases: items.filter((item) => item.liveSelected && item.estimatedProviderCost).length,
        bindings: new Set(items.map((item) => item.bindingId)).size,
        validationCases: items.length,
        plannedFreeChecks: items.length,
        plannedLiveCanaries: items.filter((item) => item.liveSelected).length,
        skippedCases: items.filter((item) => (input.request.mode === "contract_only" ? Boolean(item.skipReason) : !item.liveSelected)).length,
        fingerprintCount: new Set(items.map((item) => item.contractFingerprintHash)).size,
        totalModels: selectedModels.length,
        contractReadyModels,
        partialModels,
        blockedModels: modelCases.size - contractReadyModels - partialModels,
        skippedFingerprints: new Set(canaryGroups.filter((group) => !group.selectedCanaryModel).map((group) => group.contractFingerprint.hash)).size,
        canaryGroups,
        maxBudgetHotxCredits: input.request.maxBudgetHotxCredits,
        items,
    };
}

export async function startVideoValidationRunWithDependencies(
    request: StartVideoValidationRunRequest,
    dependencies: {
        actorId: string;
        loadSnapshot: () => Promise<Snapshot>;
        createRun: (run: VideoValidationRun, items: VideoValidationItem[]) => Promise<unknown>;
        loadLatestVerifications?: (items: VideoValidationPreviewItem[]) => Promise<Map<string, { fingerprintVersion: number; fingerprintHash: string; status: string }>>;
    },
) {
    const snapshot = await dependencies.loadSnapshot();
    const { previewRevision, ...previewRequest } = request;
    const basePreview = await buildVideoValidationPreview({ request: previewRequest, ...snapshot });
    const latestVerifications = await dependencies.loadLatestVerifications?.(basePreview.items);
    const preview = latestVerifications ? await buildVideoValidationPreview({ request: previewRequest, ...snapshot, latestVerifications }) : basePreview;
    if (preview.revision !== previewRevision) throw new VideoValidationServiceError("REVISION_CHANGED", "验收预览已经变化，请重新预览确认", 409);
    if (decimal(preview.estimatedProviderCostHotxCredits).greaterThan(decimal(request.maxBudgetHotxCredits))) throw new VideoValidationServiceError("BUDGET_EXCEEDED", "预计上游成本超过最大预算", 409);
    const now = new Date().toISOString();
    const runId = `video-validation-${randomUUID()}`;
    let run: VideoValidationRun = {
        id: runId,
        mode: request.mode,
        status: request.mode === "contract_only" ? "completed" : "pending",
        previewRevision: preview.revision,
        registryRevision: preview.registryRevision,
        pricingPolicyVersion: preview.pricingPolicyVersion,
        maxBudgetHotxCredits: request.maxBudgetHotxCredits,
        estimatedCostHotxCredits: "0",
        actualCostHotxCredits: "0",
        concurrency: request.concurrency,
        selectedCount: preview.selectedModels,
        runnableCount: preview.runnableModels,
        skippedCount: preview.skippedModels,
        createdBy: dependencies.actorId,
        createdAt: now,
        ...(request.mode === "contract_only" ? { completedAt: now } : {}),
    };
    const items: VideoValidationItem[] = await Promise.all(
        preview.items.map(async (item) => {
            const id = `video-validation-item-${randomUUID()}`;
            const idempotencyKey = `video-validation:${runId}:${id}`;
            const requestPayloadDigest = item.requestPayloadDigest || "";
            const executionSnapshotHash =
                item.fingerprintSnapshot && item.fingerprintHash
                    ? buildValidationExecutionSnapshot({
                          fingerprint: { fingerprintVersion: 1, fingerprintHashAlgorithm: "sha256", fingerprintHash: item.fingerprintHash, fingerprintSnapshot: item.fingerprintSnapshot as ValidationFingerprintV1 },
                          bindingId: item.bindingId,
                          channelId: item.channelId,
                          normalizedContext: item.normalizedContext,
                          pricingRevision: item.pricingRevision,
                          conversionRevision: preview.pricingPolicyVersion,
                          requestPayloadDigest,
                          idempotencyKey,
                      }).hash
                    : undefined;
            return {
                id,
                runId,
                logicalModelId: item.logicalModelId,
                bindingId: item.bindingId,
                channelId: item.channelId,
                upstreamModelId: item.upstreamModelId,
                contractFamily: item.contractFamily,
                caseId: item.caseId,
                testLevel: request.mode === "contract_only" ? "PROBE" : request.mode === "family_sample" ? "FAMILY_CANARY" : "MODEL_SMOKE",
                status: item.liveSelected ? "queued" : request.mode === "contract_only" && !item.skipReason && item.probe.status === "CONTRACT_READY" ? "passed" : "skipped",
                probeStatus: item.probe.status,
                reasonCode: item.skipReason,
                normalizedContext: item.normalizedContext,
                capabilityRevision: item.capabilityRevision,
                pricingRevision: item.pricingRevision,
                fingerprintVersion: item.fingerprintVersion,
                fingerprintHash: item.fingerprintHash,
                fingerprintSnapshot: item.fingerprintSnapshot,
                executionSnapshotHash,
                requestPayloadDigest,
                attemptNumber: 1,
                estimatedProviderCost: item.estimatedProviderCost,
                estimatedCredits: item.liveSelected ? item.estimatedCredits : "0",
                boundEvidence: item.boundEvidence,
                actualCostCapability: item.actualCostCapability,
                actualCostCapabilityEvidence: item.actualCostCapabilityEvidence,
                reservationState: "NONE",
                estimatedCostHotxCredits: item.liveSelected ? item.estimatedCostHotxCredits : "0",
                idempotencyKey,
                ...(request.mode === "contract_only" ? { testedAt: now } : {}),
                createdAt: now,
                updatedAt: now,
            } satisfies VideoValidationItem;
        }),
    );
    if (request.mode !== "contract_only" && !items.some((item) => item.status === "queued")) run = { ...run, status: "completed", completedAt: now };
    await dependencies.createRun(run, items);
    return { run, items: items.map(({ fingerprintSnapshot: _fingerprintSnapshot, ...item }) => item), preview: { ...preview, items: preview.items.map(({ fingerprintSnapshot: _fingerprintSnapshot, ...item }) => item) } };
}

export async function previewVideoValidation(request: VideoValidationPreviewRequest) {
    const snapshot = await currentSnapshot();
    const basePreview = await buildVideoValidationPreview({ request, ...snapshot });
    const latestVerifications = await validationRepository().latestVerificationByBindingCase(basePreview.items.map((item) => ({ bindingId: item.bindingId, caseId: item.caseId })));
    const full = await buildVideoValidationPreview({ request, ...snapshot, latestVerifications });
    return { ...full, items: full.items.map(({ fingerprintSnapshot: _fingerprintSnapshot, ...item }) => item) };
}

export async function startVideoValidationRun(request: StartVideoValidationRunRequest, actorId: string) {
    validationRepository();
    return startVideoValidationRunWithDependencies(request, {
        actorId,
        loadSnapshot: currentSnapshot,
        loadLatestVerifications: (items) => validationRepository().latestVerificationByBindingCase(items.map((item) => ({ bindingId: item.bindingId, caseId: item.caseId }))),
        createRun: (run, items) =>
            withPostgresTransaction(async (executor) => {
                const repositories = createPostgresRepositories(executor);
                await repositories.videoValidation.createRun(run, items);
                await repositories.auditLogs.create({
                    id: randomUUID(),
                    action: "video_validation.run.create",
                    status: "success",
                    actorUserId: actorId,
                    actorRole: "admin",
                    targetType: "video_validation_run",
                    targetId: run.id,
                    targetLabel: run.mode,
                    metadata: { previewRevision: run.previewRevision, maxBudgetHotxCredits: run.maxBudgetHotxCredits, runnableCount: run.runnableCount },
                    createdAt: run.createdAt,
                });
            }),
    });
}

export async function listVideoValidationRuns(query: { page: number; pageSize: number }) {
    if (getDatabaseProvider() !== "postgres") return { items: [], total: 0, unavailableReason: "POSTGRES_REQUIRED" as const };
    return validationRepository().listRuns(query);
}
export async function getVideoValidationRun(runId: string) {
    const detail = await validationRepository().getRunWithItems(runId);
    return detail && { ...detail, items: detail.items.map(({ fingerprintSnapshot: _fingerprintSnapshot, ...item }) => item) };
}
export async function cancelVideoValidationRun(runId: string, actorId: string) {
    validationRepository();
    const now = new Date().toISOString();
    await withPostgresTransaction(async (executor) => {
        const repositories = createPostgresRepositories(executor);
        await repositories.videoValidation.requestCancellation(runId, now);
        await repositories.auditLogs.create({ id: randomUUID(), action: "video_validation.run.cancel", status: "success", actorUserId: actorId, actorRole: "admin", targetType: "video_validation_run", targetId: runId, metadata: {}, createdAt: now });
    });
    return getVideoValidationRun(runId);
}

export async function authorizeVideoValidationProxyRequest(input: { itemId: string; channelId: string; upstreamModelId: string; operation: "create" | "query" | "cancel"; providerTaskId?: string }) {
    if (getDatabaseProvider() !== "postgres") return false;
    return createPostgresRepositories().videoValidation.authorizesProxyRequest(input);
}

async function currentSnapshot(): Promise<Snapshot> {
    const settings = await getFreshAuthSettings();
    return { logicalModels: settings.logicalModels, channels: settings.systemChannels, pricingPolicyVersion: settings.pricingPolicy.version, publicRegistryModelIds: await dflopPublicRegistryIds(settings.systemChannels) };
}

async function dflopPublicRegistryIds(channels: SystemModelChannel[]): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
    const checked = await Promise.all(
        channels
            .filter((item) => item.enabled && item.advancedConfig?.protocol === "dflop")
            .map(async (channel) => {
                try {
                    const url = new URL("/api/v1/models/public", channel.baseUrl);
                    const response = await fetchSafeOutbound(url.toString(), { headers: { accept: "application/json", "user-agent": "HOTX-AI-DFLOP-Discovery" }, cache: "no-store" });
                    if (!response.ok) return null;
                    const payload = await response.json();
                    if (!payload || !Array.isArray(payload.models)) return null;
                    return [channel.id, new Set<string>(payload.models.flatMap((item: unknown) => (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string" ? [normalizeModelId((item as { id: string }).id)] : [])))] as const;
                } catch {
                    return null;
                }
            }),
    );
    return new Map(checked.filter((entry): entry is NonNullable<typeof entry> => entry !== null));
}

function validationRepository() {
    if (getDatabaseProvider() !== "postgres") throw new VideoValidationServiceError("POSTGRES_REQUIRED", "低成本视频验收需要 PostgreSQL 持久化", 503);
    return createPostgresRepositories().videoValidation;
}

function validateRequest(request: VideoValidationPreviewRequest) {
    if (!request.maxBudgetHotxCredits || decimal(request.maxBudgetHotxCredits).isNegative()) throw new VideoValidationServiceError("INVALID_BUDGET", "最大预算必须是非负数");
    if (!Number.isInteger(request.concurrency) || request.concurrency <= 0) throw new VideoValidationServiceError("INVALID_CONCURRENCY", "并发数必须是正整数");
}

function videoOperation(channel: SystemModelChannel, modelId: string): Partial<SystemChannelModelConfig> {
    const advanced = channel.advancedConfig;
    return (
        advanced?.modelConfigs?.[modelId] ||
        advanced?.operationConfigs?.video ||
        (advanced
            ? {
                  capability: "video",
                  createPath: advanced.createPath,
                  imageToVideoPath: advanced.imageToVideoPath,
                  queryPath: advanced.queryPath,
                  cancelPath: advanced.cancelPath,
                  requestTemplate: advanced.requestTemplate,
                  resultField: advanced.resultField,
                  statusField: advanced.statusField,
                  supportsReferenceImage: advanced.supportsReferenceImage,
                  supportsReferenceVideo: advanced.supportsReferenceVideo,
                  supportsReferenceAudio: advanced.supportsReferenceAudio,
              }
            : protocolModelConfig("auto", "video")) ||
        {}
    );
}

function pricingBases(rateCard: LogicalModel["bindings"][number]["costRateCard"]) {
    return [...new Set((rateCard?.components || []).map((component) => component.basis || component.dimension))];
}
function runtimeOptions(operation: Partial<SystemChannelModelConfig>) {
    const template = operation.requestTemplate || "";
    return { ...(template.match(/generate_audio|generateAudio/) ? { generateAudio: false } : {}), ...(template.includes("watermark") ? { watermark: false } : {}) };
}
function redactChannel(channel: SystemModelChannel) {
    return { ...channel, apiKey: undefined, hasApiKey: channel.hasApiKey || Boolean(channel.apiKey), webhookSecret: undefined };
}
function hash(value: unknown) {
    return createHash("sha256").update(canonical(value)).digest("hex");
}
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object")
        return `{${Object.entries(value as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
            .join(",")}}`;
    return JSON.stringify(value);
}
