"use client";

import { App, Button, Drawer, Grid } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { ChevronsDown, Clapperboard, FolderOpen, History, Play, Plus, ScanFace, ShoppingBag, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { CREATIVE_UPLOAD_MAX_BYTES, CREATIVE_UPLOAD_MIME_TYPES, isCreativeUploadMimeType } from "@/lib/creative-upload";
import type { CreateOverviewAsset } from "@/lib/create-workbench-overview";
import type { CreativeAsset, CreativeGenerationMode, CreativeGenerationPreferences, CreativeMessage } from "@/lib/creative-runtime-contract";
import { creativeReferenceAdditionAvailability, creativeReferenceCapabilityViolation, creativeReferenceInputFromMimeType, resolveCreativeGenerationCapability } from "@/lib/creative-generation-capabilities";
import type { CreativeGenerationPreferencePatch } from "@/components/creative-generation-preferences";
import { cn } from "@/lib/utils";
import type { VideoReferenceRole } from "@/lib/video-reference-contract";
import { useCreativeAgentModels } from "@/hooks/use-creative-agent-options";
import { listAgentSkills, type AgentSkillSummary } from "@/services/api/agent-skills";
import type { CreativeAgentRun } from "@/services/api/creative";
import { optimizePrompt } from "@/services/api/prompt-optimization";
import { usePublicSessionStore } from "@/stores/use-public-session-store";
import type { PublicGalleryItem } from "@/services/api/work-governance";
import { createAgentDraftFromHash } from "@/lib/create-agent-prompt";
import { resolveSiteTitle } from "@/lib/site-brand";

import { CreativeComposer } from "./components/creative-composer";
import { CreativeAssetsPanel } from "./components/creative-assets-panel";
import { applyAgentGenerationCapability, shouldShowVideoFrameControls } from "./components/creative-composer-video-mode";
import { CreativeConversationList } from "./components/creative-conversation-list";
import { CreateInspirationGallery } from "./components/create-inspiration-gallery";
import { CreativeMessages } from "./components/creative-messages";
import { CreateWorkbenchOverview } from "./components/create-workbench-overview";
import { publicCreativeAssetPrompt, remapCreativeAssetReferences } from "./components/creative-asset-mention";
import { createConversationHref, createConversationIdFromSearch } from "./create-conversation-navigation";
import { useCreateAgent } from "./use-create-agent";

const SKILL_VISUALS = [
    { icon: ShoppingBag, iconClass: "text-sky-600 dark:text-sky-300", surfaceClass: "bg-sky-50 dark:bg-sky-400/10" },
    { icon: ScanFace, iconClass: "text-violet-600 dark:text-violet-300", surfaceClass: "bg-violet-50 dark:bg-violet-400/10" },
    { icon: Play, iconClass: "text-emerald-600 dark:text-emerald-300", surfaceClass: "bg-emerald-50 dark:bg-emerald-400/10" },
    { icon: Clapperboard, iconClass: "text-red-500 dark:text-red-300", surfaceClass: "bg-red-50 dark:bg-red-400/10" },
] as const;

export default function CreatePage() {
    const t = useTranslations("create");
    const { message } = App.useApp();
    const router = useRouter();
    const screens = Grid.useBreakpoint();
    const inputRef = useRef<TextAreaRef>(null);
    const attachmentInputRef = useRef<HTMLInputElement>(null);
    const frameInputRef = useRef<HTMLInputElement>(null);
    const frameUploadRoleRef = useRef<FrameRole | undefined>(undefined);
    const initialConversationRestoredRef = useRef(false);
    const initialPromptRestoredRef = useRef(false);
    const conversationScrollRef = useRef<HTMLElement>(null);
    const conversationWasLoadingRef = useRef(false);
    const previousScrollTopRef = useRef(0);
    const awayFromLatestRef = useRef(false);
    const promptValueRef = useRef("");
    const promptRevisionRef = useRef(0);
    const optimizingRef = useRef(false);
    const [prompt, setPrompt] = useState("");
    const [optimizingPrompt, setOptimizingPrompt] = useState(false);
    const [skills, setSkills] = useState<AgentSkillSummary[]>([]);
    const [skillsLoading, setSkillsLoading] = useState(true);
    const [selectedSkillId, setSelectedSkillId] = useState<string>();
    const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
    const [smartPlanning, setSmartPlanning] = useState(true);
    const [creationMode, setCreationMode] = useState<"agent" | CreativeGenerationMode>("agent");
    const [generationPreferences, setGenerationPreferences] = useState<CreativeGenerationPreferences>({});
    const [historyOpen, setHistoryOpen] = useState(false);
    const [assetsOpen, setAssetsOpen] = useState(false);
    const [awayFromLatest, setAwayFromLatest] = useState(false);
    const [composerExpanded, setComposerExpanded] = useState(true);
    const publicSettings = usePublicSessionStore((state) => state.payload?.settings);
    const siteTitle = resolveSiteTitle(publicSettings?.site?.title);
    const agent = useCreateAgent();
    const openAgentConversation = agent.openConversation;
    const newAgentConversation = agent.newConversation;
    const hasConversation = agent.messages.length > 0;
    const showConversation = hasConversation || agent.conversationLoading;
    const selectedSkill = skills.find((skill) => skill.id === selectedSkillId);
    const modelOptions = useCreativeAgentModels();
    const selectedModels = modelOptions.filter((model) => selectedModelIds.includes(model.id));
    const activeGenerationCapability = creationMode === "agent" ? generationPreferences.mode || selectedModels.at(-1)?.capability || "image" : creationMode;
    const referenceCapabilityState = resolveCreativeGenerationCapability({ models: modelOptions, selectedModels, capability: activeGenerationCapability, smartPlanning });
    const referenceUploadAccept = CREATIVE_UPLOAD_MIME_TYPES.filter((mimeType) => {
        const type = creativeReferenceInputFromMimeType(mimeType);
        return type ? creativeReferenceAdditionAvailability(referenceCapabilityState, agent.selectedAssets, type).supported : false;
    }).join(",");
    const referenceCapabilityMessage = (reason: typeof referenceCapabilityState.reason, maxReferenceImages?: number) =>
        maxReferenceImages ? t(reason === "intersection" ? "generationReferenceImageIntersectionLimit" : "generationReferenceImageLimit", { count: maxReferenceImages }) : t(capabilityReasonMessageKeys[reason]);
    const updatePrompt = useCallback((value: string) => {
        promptValueRef.current = value;
        promptRevisionRef.current += 1;
        setPrompt(value);
    }, []);

    useEffect(() => {
        let active = true;
        void listAgentSkills("all")
            .then((items) => {
                if (active) setSkills(items);
            })
            .catch(() => {
                if (active) setSkills([]);
            })
            .finally(() => {
                if (active) setSkillsLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (initialConversationRestoredRef.current) return;
        initialConversationRestoredRef.current = true;
        const conversationId = createConversationIdFromSearch(window.location.search);
        if (!conversationId) return;
        void openAgentConversation(conversationId).catch(() => {
            message.error(t("restoreConversationFailed"));
            router.replace("/create");
        });
    }, [message, openAgentConversation, router, t]);

    useEffect(() => {
        if (initialPromptRestoredRef.current) return;
        initialPromptRestoredRef.current = true;
        const incomingDraft = createAgentDraftFromHash(window.location.hash);
        if (!incomingDraft || (!incomingDraft.prompt && !incomingDraft.mode)) return;
        if (incomingDraft.prompt) updatePrompt(incomingDraft.prompt);
        if (incomingDraft.mode) {
            setCreationMode(incomingDraft.mode);
            setGenerationPreferences(incomingDraft.mode === "agent" ? {} : { mode: incomingDraft.mode });
        }
        router.replace("/create");
        window.requestAnimationFrame(() => inputRef.current?.focus());
        message.success(incomingDraft.prompt ? t("draftPromptFilled") : t("creationModeSelected"));
    }, [message, router, t, updatePrompt]);

    useEffect(() => {
        if (!agent.conversationId || createConversationIdFromSearch(window.location.search) === agent.conversationId) return;
        router.replace(createConversationHref(agent.conversationId), { scroll: false });
    }, [agent.conversationId, router]);

    useEffect(() => {
        previousScrollTopRef.current = 0;
        awayFromLatestRef.current = false;
        setAwayFromLatest(false);
        setComposerExpanded(true);
    }, [agent.conversationId]);

    useEffect(() => {
        const wasLoading = conversationWasLoadingRef.current;
        conversationWasLoadingRef.current = agent.conversationLoading;
        const element = conversationScrollRef.current;
        if (!element || agent.conversationLoading || !agent.messages.length) return;
        if (wasLoading) {
            awayFromLatestRef.current = false;
            setAwayFromLatest(false);
            setComposerExpanded(true);
        }
        const content = element.querySelector<HTMLElement>('[data-testid="creative-message-list"]');
        if (!content) return;
        const settle = () => {
            if (awayFromLatestRef.current) return;
            element.scrollTop = element.scrollHeight;
            previousScrollTopRef.current = element.scrollTop;
        };
        const resizeObserver = new ResizeObserver(settle);
        resizeObserver.observe(content);
        const frame = window.requestAnimationFrame(settle);
        return () => {
            window.cancelAnimationFrame(frame);
            resizeObserver.disconnect();
        };
    }, [agent.conversationId, agent.conversationLoading, agent.messages.length]);

    const openConversation = (id: string) => {
        router.push(createConversationHref(id));
        void openAgentConversation(id).catch(() => {
            message.error(t("openConversationFailed"));
            router.replace("/create");
        });
    };

    const newConversation = () => {
        newAgentConversation();
        router.replace("/create");
    };

    const submit = async () => {
        if (!prompt.trim()) {
            message.warning(t("describeRequirement"));
            inputRef.current?.focus();
            return;
        }
        if (!smartPlanning && !selectedModelIds.length) {
            message.warning(t("selectModelOrSmart"));
            return;
        }
        const referenceViolation = creativeReferenceCapabilityViolation(referenceCapabilityState, agent.selectedAssets);
        if (referenceViolation) {
            message.warning(referenceCapabilityMessage(referenceViolation.reason, referenceViolation.maxReferenceImages));
            return;
        }
        const videoPreference = generationPreferences.video;
        const videoFrameModeActive = shouldShowVideoFrameControls(creationMode, generationPreferences);
        if (videoFrameModeActive && videoPreference?.referenceMode === "first_frame" && !videoPreference.firstFrameAssetId) {
            message.warning(t("selectFirstFrame"));
            return;
        }
        if (videoFrameModeActive && videoPreference?.referenceMode === "first_last" && (!videoPreference.firstFrameAssetId || !videoPreference.lastFrameAssetId)) {
            message.warning(t("selectFirstLastFrame"));
            return;
        }
        promptRevisionRef.current += 1;
        try {
            const preferences = { ...generationPreferences, ...(creationMode !== "agent" ? { mode: creationMode } : {}) };
            if (
                await agent.submit(prompt, {
                    publicPrompt: publicCreativeAssetPrompt(prompt),
                    skillIds: selectedSkillId ? [selectedSkillId] : [],
                    ...(!smartPlanning && selectedModelIds.length ? { modelIds: selectedModelIds } : {}),
                    ...(Object.keys(preferences).length ? { preferences } : {}),
                })
            ) {
                updatePrompt("");
                setSelectedSkillId(undefined);
                setGenerationPreferences((current) => (current.video ? { ...current, video: { ...current.video, firstFrameAssetId: undefined, lastFrameAssetId: undefined } } : current));
            }
        } catch {
            message.error(t("uploadFailed"));
        }
    };

    const retryRound = async (assistantMessage: CreativeMessage, run?: CreativeAgentRun) => {
        try {
            if (!run) return await agent.retrySubmission(assistantMessage.id);
            const failedTasks = run.tasks.filter((task) => task.status === "failed");
            if (failedTasks.length) {
                await agent.retryTasks(
                    run.id,
                    failedTasks.map((task) => task.id),
                );
                return true;
            }
            await agent.retryRun(run.id);
            return true;
        } catch {
            message.error(t("retryFailed"));
            return false;
        }
    };

    const uploadAttachments = async (files: File[], successMessage?: string) => {
        const unsupported = files.find((file) => !isCreativeUploadMimeType(file.type));
        if (unsupported) {
            message.error(t("unsupportedFile", { name: unsupported.name }));
            return [] as CreativeAsset[];
        }
        const oversized = files.find((file) => file.size > CREATIVE_UPLOAD_MAX_BYTES);
        if (oversized) {
            message.error(t("fileTooLarge", { name: oversized.name }));
            return [] as CreativeAsset[];
        }
        const projectedAssets = [...agent.selectedAssets];
        for (const [index, file] of files.entries()) {
            const type = creativeReferenceInputFromMimeType(file.type);
            if (!type) continue;
            const availability = creativeReferenceAdditionAvailability(referenceCapabilityState, projectedAssets, type);
            if (!availability.supported) {
                message.warning(referenceCapabilityMessage(availability.reason, "maxReferenceImages" in availability ? availability.maxReferenceImages : undefined));
                return [] as CreativeAsset[];
            }
            projectedAssets.push({ id: `pending-${index}`, type } as CreativeAsset);
        }
        try {
            const items = await agent.uploadAttachments(files);
            if (items.length) message.success(successMessage || t("assetsAdded", { count: items.length }));
            return items;
        } catch {
            message.error(t("uploadFailed"));
            return [] as CreativeAsset[];
        }
    };

    const usePublicPrompt = (value: string) => {
        updatePrompt(value);
        window.requestAnimationFrame(() => inputRef.current?.focus());
        message.success(t("publicPromptFilled"));
    };

    const optimizeCurrentPrompt = async () => {
        const source = promptValueRef.current.trim();
        if (!source || optimizingRef.current) return;
        const revision = promptRevisionRef.current;
        optimizingRef.current = true;
        setOptimizingPrompt(true);
        try {
            const optimized = await optimizePrompt({ requestId: `prompt-${crypto.randomUUID()}`, prompt: source, mode: creationMode });
            if (promptRevisionRef.current !== revision) {
                message.info(t("inputChanged"));
                return;
            }
            updatePrompt(optimized);
            window.requestAnimationFrame(() => inputRef.current?.focus());
            message.success(t("promptOptimized"));
        } catch {
            message.error(t("promptOptimizationFailed"));
        } finally {
            optimizingRef.current = false;
            setOptimizingPrompt(false);
        }
    };

    const importReferenceMedia = async (input: { url: string; mimeType?: string; fileStem: string }) => {
        try {
            const response = await fetch(input.url);
            if (!response.ok) throw new Error(t("readReferenceFailed"));
            const blob = await response.blob();
            const mimeType = blob.type || input.mimeType || "";
            if (!isCreativeUploadMimeType(mimeType)) throw new Error(t("unsupportedReference"));
            const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
            const referenced = await uploadAttachments([new File([blob], `${input.fileStem}.${extension}`, { type: mimeType })], t("referencedToInput"));
            if (referenced.length) window.requestAnimationFrame(() => inputRef.current?.focus());
        } catch {
            message.error(t("referenceFailed"));
        }
    };

    const usePublicImage = async (item: PublicGalleryItem) => {
        const preview = item.preview;
        if (!preview || preview.mediaType !== "image") return;
        await importReferenceMedia({ url: preview.url, mimeType: preview.mimeType, fileStem: item.slug });
    };

    const useRecentAsset = async (asset: CreateOverviewAsset) => {
        await importReferenceMedia({ url: asset.url, fileStem: asset.id });
    };

    const selectSkill = (skill: AgentSkillSummary) => {
        setSelectedSkillId(skill.id);
        window.requestAnimationFrame(() => inputRef.current?.focus());
    };

    const toggleModel = (model: (typeof modelOptions)[number]) => {
        setSelectedModelIds((current) => {
            const next = current.includes(model.id) ? current.filter((id) => id !== model.id) : [...current, model.id];
            setSmartPlanning(next.length === 0);
            return next;
        });
        window.requestAnimationFrame(() => inputRef.current?.focus());
    };

    const changeCreationMode = (mode: "agent" | CreativeGenerationMode) => {
        setCreationMode(mode);
        setGenerationPreferences((current) => {
            const automaticPreferences = { ...current };
            delete automaticPreferences.mode;
            const next: CreativeGenerationPreferences = mode === "agent" ? automaticPreferences : { ...current, mode };
            if (mode === "video") return applyAgentGenerationCapability("video", "video", next);
            if (!next.video) return next;
            return { ...next, video: { ...next.video, referenceMode: "reference", firstFrameAssetId: undefined, lastFrameAssetId: undefined } };
        });
        if (mode === "agent") {
            setSelectedModelIds([]);
            setSmartPlanning(true);
            return;
        }
        setSelectedModelIds([]);
        setSmartPlanning(true);
    };

    const changeGenerationCapability = (capability: CreativeGenerationMode) => {
        setGenerationPreferences((current) => {
            const next = applyAgentGenerationCapability("agent", capability, current);
            if (capability === "video" || !current.video) return next;
            return { ...next, video: { ...current.video, referenceMode: "reference", firstFrameAssetId: undefined, lastFrameAssetId: undefined } };
        });
    };

    const changeGenerationPreference = (capability: "image" | "video" | "audio", patch: CreativeGenerationPreferencePatch) => {
        setGenerationPreferences((current) => {
            const activePreferences = applyAgentGenerationCapability(creationMode, capability, current);
            const nextCapability = { ...activePreferences[capability], ...patch } as Record<string, unknown>;
            for (const [key, value] of Object.entries(patch)) if (value === undefined || value === "auto") delete nextCapability[key];
            if (capability !== "video") {
                const next = { ...activePreferences };
                if (Object.keys(nextCapability).length) next[capability] = nextCapability;
                else delete next[capability];
                return next as CreativeGenerationPreferences;
            }
            const nextVideo = nextCapability as NonNullable<CreativeGenerationPreferences["video"]>;
            if ("referenceMode" in patch && patch.referenceMode === undefined) return { ...activePreferences, video: { ...nextVideo, firstFrameAssetId: undefined, lastFrameAssetId: undefined } };
            if (patch.referenceMode === "reference") return { ...activePreferences, video: { ...nextVideo, firstFrameAssetId: undefined, lastFrameAssetId: undefined } };
            if (patch.referenceMode === "first_frame") return { ...activePreferences, video: { ...nextVideo, lastFrameAssetId: undefined } };
            return { ...activePreferences, video: nextVideo };
        });
    };

    const replaceGenerationPreferences = useCallback((preferences: CreativeGenerationPreferences) => setGenerationPreferences(preferences), []);

    const selectVideoFrame = (role: FrameRole, assetId: string) => {
        const referenceViolation = creativeReferenceCapabilityViolation(referenceCapabilityState, agent.selectedAssets);
        if (referenceViolation) {
            message.warning(referenceCapabilityMessage(referenceViolation.reason, referenceViolation.maxReferenceImages));
            return;
        }
        const otherId = role === "first_frame" ? generationPreferences.video?.lastFrameAssetId : generationPreferences.video?.firstFrameAssetId;
        if (otherId === assetId) {
            message.warning(t("sameVideoFrames"));
            return;
        }
        setGenerationPreferences((current) => {
            const video = current.video || {};
            return {
                ...current,
                video: {
                    ...video,
                    referenceMode: role === "last_frame" ? "first_last" : video.referenceMode === "first_last" ? "first_last" : "first_frame",
                    ...(role === "first_frame" ? { firstFrameAssetId: assetId } : { lastFrameAssetId: assetId }),
                },
            };
        });
    };

    const removeVideoFrame = (role: FrameRole) => {
        setGenerationPreferences((current) =>
            current.video
                ? {
                      ...current,
                      video: {
                          ...current.video,
                          ...(role === "first_frame" ? { firstFrameAssetId: undefined } : { lastFrameAssetId: undefined }),
                      },
                  }
                : current,
        );
    };

    const removeAttachment = (id: string) => {
        const currentAssetIds = agent.selectedAssetIds;
        const nextAssetIds = currentAssetIds.filter((assetId) => assetId !== id);
        const nextPrompt = remapCreativeAssetReferences(promptValueRef.current, [...agent.assets, ...agent.selectedAssets], currentAssetIds, nextAssetIds);
        agent.removeAttachment(id);
        if (nextPrompt !== promptValueRef.current) updatePrompt(nextPrompt);
        setGenerationPreferences((current) =>
            current.video
                ? {
                      ...current,
                      video: {
                          ...current.video,
                          ...(current.video.firstFrameAssetId === id ? { firstFrameAssetId: undefined } : {}),
                          ...(current.video.lastFrameAssetId === id ? { lastFrameAssetId: undefined } : {}),
                      },
                  }
                : current,
        );
    };

    const toggleReferencedAsset = (id: string) => {
        const currentAssetIds = agent.selectedAssetIds;
        if (!currentAssetIds.includes(id)) {
            const asset = agent.assets.find((item) => item.id === id);
            if (asset && asset.type !== "text") {
                const availability = creativeReferenceAdditionAvailability(referenceCapabilityState, agent.selectedAssets, asset.type);
                if (!availability.supported) {
                    message.warning(referenceCapabilityMessage(availability.reason, "maxReferenceImages" in availability ? availability.maxReferenceImages : undefined));
                    return;
                }
            }
        }
        const nextAssetIds = currentAssetIds.includes(id) ? currentAssetIds.filter((assetId) => assetId !== id) : [...currentAssetIds, id];
        const nextPrompt = remapCreativeAssetReferences(promptValueRef.current, [...agent.assets, ...agent.selectedAssets], currentAssetIds, nextAssetIds);
        agent.toggleAsset(id);
        if (nextPrompt !== promptValueRef.current) updatePrompt(nextPrompt);
    };

    const setAwayFromLatestState = (away: boolean) => {
        if (away === awayFromLatestRef.current) return;
        awayFromLatestRef.current = away;
        setAwayFromLatest(away);
    };

    const updateConversationScrollState = (element: HTMLElement) => {
        const scrollTop = element.scrollTop;
        const distanceFromLatest = Math.max(0, element.scrollHeight - element.clientHeight - scrollTop);
        const scrollingUp = scrollTop < previousScrollTopRef.current - 3;
        const away = scrollingUp ? true : distanceFromLatest > 48 ? awayFromLatestRef.current : false;
        previousScrollTopRef.current = scrollTop;
        setAwayFromLatestState(away);
        if (!away) setComposerExpanded(true);
        else if (scrollingUp) setComposerExpanded(false);
    };

    const scrollToLatest = () => {
        awayFromLatestRef.current = false;
        setAwayFromLatest(false);
        setComposerExpanded(true);
        const element = conversationScrollRef.current;
        if (!element) return;
        previousScrollTopRef.current = element.scrollTop;
        const settle = (behavior: ScrollBehavior = "smooth") => element.scrollTo({ top: element.scrollHeight, behavior });
        const resizeObserver = new ResizeObserver(() => settle("auto"));
        resizeObserver.observe(element);
        window.requestAnimationFrame(() => {
            settle();
            window.requestAnimationFrame(() => settle());
            window.setTimeout(() => {
                settle("auto");
                resizeObserver.disconnect();
            }, 500);
        });
    };

    const composerCompact = showConversation && awayFromLatest && !composerExpanded;
    const composer = (
        <CreativeComposer
            inputRef={inputRef}
            value={prompt}
            busy={agent.sending}
            optimizing={optimizingPrompt}
            centered={!showConversation}
            onChange={updatePrompt}
            onOptimize={() => void optimizeCurrentPrompt()}
            onSubmit={() => void submit()}
            onCancel={() => void agent.cancel().catch(() => message.error(t("stopFailed")))}
            attachments={agent.selectedAssets}
            skills={skills}
            skillsLoading={skillsLoading}
            selectedSkill={selectedSkill}
            models={modelOptions}
            selectedModels={selectedModels}
            smartPlanning={smartPlanning}
            creationMode={creationMode}
            generationPreferences={generationPreferences}
            referenceCapabilityState={referenceCapabilityState}
            uploading={agent.uploading}
            compact={composerCompact}
            onExpand={() => {
                setComposerExpanded(true);
                window.requestAnimationFrame(() => inputRef.current?.focus());
            }}
            onRemoveAttachment={removeAttachment}
            onSelectSkill={selectSkill}
            onRemoveSkill={() => setSelectedSkillId(undefined)}
            onToggleModel={toggleModel}
            onClearModels={() => {
                setSelectedModelIds([]);
                setSmartPlanning(true);
            }}
            onToggleSmartPlanning={() => {
                setSmartPlanning((enabled) => {
                    if (!enabled) setSelectedModelIds([]);
                    return !enabled;
                });
            }}
            onChangeCreationMode={changeCreationMode}
            onChangeGenerationCapability={changeGenerationCapability}
            onChangeGenerationPreference={changeGenerationPreference}
            onReplaceGenerationPreferences={replaceGenerationPreferences}
            onSelectVideoFrame={selectVideoFrame}
            onUploadVideoFrame={(role) => {
                frameUploadRoleRef.current = role;
                frameInputRef.current?.click();
            }}
            onRemoveVideoFrame={removeVideoFrame}
            onAttachment={() => attachmentInputRef.current?.click()}
            onPasteImages={(files) => void uploadAttachments(files)}
            referenceAssets={agent.assets}
            selectedAssetIds={agent.selectedAssetIds}
            onReferenceAsset={(id) => {
                if (agent.selectedAssetIds.includes(id)) return;
                const asset = agent.assets.find((item) => item.id === id);
                if (asset && asset.type !== "text") {
                    const availability = creativeReferenceAdditionAvailability(referenceCapabilityState, agent.selectedAssets, asset.type);
                    if (!availability.supported) {
                        message.warning(referenceCapabilityMessage(availability.reason, "maxReferenceImages" in availability ? availability.maxReferenceImages : undefined));
                        return;
                    }
                }
                agent.selectAsset(id);
            }}
        />
    );

    const historyPanel = (
        <div className="flex h-full min-h-0 flex-col bg-white dark:bg-[#181b20]">
            <div className="hidden h-14 shrink-0 items-center gap-2 border-b border-[#eceef1] px-4 lg:flex dark:border-[#2b3036]">
                <History className="size-4 text-[#5b61cf] dark:text-[#b4b7ff]" />
                <h2 className="min-w-0 flex-1 text-sm font-semibold text-[#20242a] dark:text-[#f3f5f7]">{t("history")}</h2>
                <Button type="text" shape="circle" icon={<X className="size-4" />} onClick={() => setHistoryOpen(false)} aria-label={t("closeHistory")} title={t("closeHistory")} />
            </div>
            <div className="min-h-0 flex-1">
                <CreativeConversationList
                    items={agent.conversations}
                    activeId={agent.conversationId}
                    loading={agent.historyLoading}
                    hasMore={agent.historyHasMore}
                    loadingMore={agent.historyLoadingMore}
                    onLoadMore={() => void agent.loadMoreConversations()}
                    onNew={() => {
                        newConversation();
                        if (screens.lg !== true) setHistoryOpen(false);
                    }}
                    onOpen={(id) => {
                        openConversation(id);
                        if (screens.lg !== true) setHistoryOpen(false);
                    }}
                    onRename={async (id, title) => {
                        try {
                            await agent.renameConversation(id, title);
                            message.success(t("titleUpdated"));
                        } catch (error) {
                            message.error(t("updateTitleFailed"));
                            throw error;
                        }
                    }}
                    onDelete={async (ids) => {
                        try {
                            await agent.deleteConversations(ids);
                            message.success(ids.length > 1 ? t("conversationsDeleted", { count: ids.length }) : t("conversationDeleted"));
                        } catch (error) {
                            message.error(t("deleteConversationFailed"));
                            throw error;
                        }
                    }}
                />
            </div>
        </div>
    );

    return (
        <main className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[linear-gradient(180deg,#ffffff_0%,#fcfdff_100%)] text-[#20242a] dark:bg-[linear-gradient(180deg,#111316_0%,#12151a_100%)] dark:text-[#f3f5f7]">
            <div className="flex min-h-0 flex-1">
                {historyOpen && screens.lg ? <aside className="h-full min-h-0 w-[min(280px,24vw)] shrink-0 border-r border-[#eceef1] dark:border-[#2b3036]">{historyPanel}</aside> : null}
                <div className="relative flex min-w-0 flex-1 flex-col">
                    <div className="pointer-events-none absolute right-3 top-3 z-30 flex items-center gap-0.5 sm:right-5" data-testid="creative-page-tools">
                        {hasConversation ? (
                            <Button
                                type="text"
                                shape="circle"
                                className="pointer-events-auto !size-9 !min-w-9 !text-[#68727e] hover:!bg-[#f1f3f5] hover:!text-[#20242a] dark:!text-[#aab2bc] dark:hover:!bg-[#262b31] dark:hover:!text-white"
                                icon={<Plus className="size-4" />}
                                onClick={newConversation}
                                aria-label={t("newConversation")}
                                title={t("newConversation")}
                            />
                        ) : null}
                        <Button
                            type="text"
                            shape="circle"
                            className={
                                historyOpen
                                    ? "pointer-events-auto !size-9 !min-w-9 !bg-[#eeeeff] !text-[#565ccb] dark:!bg-[#2c2e4b] dark:!text-[#b8bbff]"
                                    : "pointer-events-auto !size-9 !min-w-9 !text-[#68727e] hover:!bg-[#f1f3f5] hover:!text-[#20242a] dark:!text-[#aab2bc] dark:hover:!bg-[#262b31] dark:hover:!text-white"
                            }
                            icon={<History className="size-4" />}
                            onClick={() => {
                                setHistoryOpen((current) => !current);
                                setAssetsOpen(false);
                            }}
                            aria-label={historyOpen ? t("closeHistory") : t("openHistory")}
                            aria-expanded={historyOpen}
                            title={t("history")}
                        />
                        <Button
                            type="text"
                            shape="circle"
                            icon={<FolderOpen className="size-4" />}
                            className={
                                assetsOpen
                                    ? "pointer-events-auto !size-9 !min-w-9 !bg-[#eeeeff] !text-[#565ccb] dark:!bg-[#2c2e4b] dark:!text-[#b8bbff]"
                                    : "pointer-events-auto !size-9 !min-w-9 !text-[#68727e] hover:!bg-[#f1f3f5] hover:!text-[#20242a] dark:!text-[#aab2bc] dark:hover:!bg-[#262b31] dark:hover:!text-white"
                            }
                            onClick={() => {
                                setAssetsOpen((current) => !current);
                                setHistoryOpen(false);
                            }}
                            aria-label={assetsOpen ? t("closeAssets") : t("openAssets")}
                            aria-expanded={assetsOpen}
                            title={t("assets")}
                        />
                    </div>

                    <section
                        ref={conversationScrollRef}
                        data-testid="creative-conversation-scroll"
                        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
                        onScroll={(event) => updateConversationScrollState(event.currentTarget)}
                        onWheelCapture={(event) => {
                            if (event.deltaY < 0) {
                                setAwayFromLatestState(true);
                                setComposerExpanded(false);
                            }
                        }}
                    >
                        {showConversation ? (
                            <CreativeMessages
                                messages={agent.messages}
                                assets={agent.assets}
                                loading={agent.conversationLoading}
                                projectLinks={agent.projectLinks}
                                projectErrors={agent.projectErrors}
                                runDetails={agent.runDetails}
                                materializingProjectId={agent.materializingProjectId}
                                onMaterializeProject={agent.materializeProject}
                                onRetryMessage={retryRound}
                                selectedAssetIds={agent.selectedAssetIds}
                                onToggleAsset={toggleReferencedAsset}
                                hasOlder={agent.hasOlderMessages}
                                olderLoading={agent.olderMessagesLoading}
                                onLoadOlder={() => void agent.loadOlderMessages()}
                                followLatest={!awayFromLatest}
                            />
                        ) : (
                            <div className="mx-auto flex min-h-full w-full min-w-0 max-w-[1240px] flex-col items-center px-2.5 pb-3 pt-5 sm:px-8 sm:pb-8 sm:pt-14 lg:pt-[10vh]">
                                <div className="text-center">
                                    <h1 className="text-[23px] font-semibold leading-tight sm:text-[31px]">{t("siteAgentTitle", { site: siteTitle })}</h1>
                                    <p className="mt-2 text-sm text-[#8b949f] dark:text-[#7f8996]">{t("startFromIdea")}</p>
                                </div>
                                <div className="mt-5 w-full sm:mt-8">{composer}</div>
                                <div className="mt-2 flex w-full min-w-0 flex-wrap justify-center gap-1.5 sm:mt-3 sm:gap-2">
                                    {skillsLoading ? <span className="px-2 py-2 text-xs text-[#9aa2ad]">{t("loadingSkills")}</span> : null}
                                    {skills.map((skill, index) => {
                                        const visual = skillVisual(skill, index);
                                        const Icon = visual.icon;
                                        return (
                                            <button
                                                key={skill.id}
                                                type="button"
                                                aria-label={t("useSkill", { name: skill.name })}
                                                title={skill.description}
                                                className="inline-flex h-9 items-center gap-2 rounded-full border border-[#e3e7eb] bg-white px-3 text-sm font-medium text-[#343b44] transition hover:border-[#cfd6dd] hover:bg-[#f7f8fa] dark:border-[#343a42] dark:bg-[#181b20] dark:text-[#dce1e7] dark:hover:border-[#4a525d] dark:hover:bg-[#20242a]"
                                                onClick={() => selectSkill(skill)}
                                            >
                                                <Icon className={`size-4 ${visual.iconClass}`} />
                                                <span>{skill.name}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                                <CreateWorkbenchOverview onUseAsset={useRecentAsset} />
                                <CreateInspirationGallery onUsePrompt={usePublicPrompt} onUseImage={usePublicImage} />
                            </div>
                        )}
                    </section>

                    {showConversation ? (
                        <div data-testid="creative-composer-dock" data-compact={composerCompact ? "true" : "false"} className={cn("relative shrink-0", composerCompact && "pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-transparent")}>
                            {awayFromLatest ? (
                                <Button
                                    type="text"
                                    icon={<ChevronsDown className="size-4" />}
                                    className="!pointer-events-auto !absolute !-top-11 !left-1/2 !z-20 !h-9 !-translate-x-1/2 !rounded-lg !border !border-[#e1e5e9] !bg-white !px-3 !text-sm !font-medium !text-[#596572] !shadow-[0_6px_20px_rgba(32,36,42,0.08)] hover:!bg-[#f4f6f8] hover:!text-[#20242a] dark:!border-[#343a42] dark:!bg-[#1c2025] dark:!text-[#b7c0ca] dark:!shadow-black/25 dark:hover:!bg-[#272c33] dark:hover:!text-white"
                                    onClick={scrollToLatest}
                                >
                                    {t("backToBottom")}
                                </Button>
                            ) : null}
                            {composer}
                        </div>
                    ) : null}
                </div>
                <CreativeAssetsPanel
                    open={assetsOpen}
                    conversationId={agent.conversationId}
                    assets={agent.assets}
                    selectedAssetIds={agent.selectedAssetIds}
                    referenceCapabilityState={referenceCapabilityState}
                    selectedReferenceAssets={agent.selectedAssets}
                    onToggleAsset={toggleReferencedAsset}
                    onUsePrompt={(value) => {
                        updatePrompt(value);
                        window.requestAnimationFrame(() => inputRef.current?.focus());
                        message.success(t("promptFilled"));
                    }}
                    onClose={() => setAssetsOpen(false)}
                />
            </div>
            <input
                ref={attachmentInputRef}
                type="file"
                multiple
                accept={referenceUploadAccept}
                className="hidden"
                onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    event.target.value = "";
                    void uploadAttachments(files);
                }}
            />
            <input
                ref={frameInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                    const role = frameUploadRoleRef.current;
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!role || !file) return;
                    void uploadAttachments([file]).then((items) => {
                        const image = items.find((item) => item.type === "image");
                        if (image) selectVideoFrame(role, image.id);
                    });
                }}
            />

            <Drawer title={t("history")} placement="right" size="min(92vw, 380px)" open={historyOpen && screens.lg !== true} onClose={() => setHistoryOpen(false)} styles={{ body: { padding: 0, overflow: "hidden" } }}>
                {screens.lg !== true ? historyPanel : null}
            </Drawer>
        </main>
    );
}

function skillVisual(skill: AgentSkillSummary, index: number) {
    if (skill.id === "ecommerce-image") return SKILL_VISUALS[0];
    if (skill.id === "character-design") return SKILL_VISUALS[1];
    if (skill.id === "image-motion") return SKILL_VISUALS[2];
    if (skill.id === "drama-planning") return SKILL_VISUALS[3];
    return { ...SKILL_VISUALS[index % SKILL_VISUALS.length], icon: Sparkles };
}

type FrameRole = Extract<VideoReferenceRole, "first_frame" | "last_frame">;

const capabilityReasonMessageKeys = {
    unconfigured: "generationCapabilityUnconfigured",
    unsupported: "generationCapabilityUnsupported",
    intersection: "generationCapabilityIntersection",
} as const;
