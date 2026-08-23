"use client";

import { App, Button, Drawer, Dropdown, Input, Modal, Popover, Segmented, Select, Tooltip } from "antd";
import { ArrowUp, ChevronDown, History, ImagePlus, Link2, ListChecks, LoaderCircle, MessageSquarePlus, Pause, Play, RotateCcw, Square, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SiteLogo } from "@/components/layout/site-logo";

import type { AgentMediaDownload } from "@/components/agent/agent-media-download";
import { CreativeAgentControls, CreativeAgentSkillCard, type CreativeAgentModelOption } from "@/components/agent/creative-agent-controls";
import { AgentMessageActions } from "@/components/agent/agent-message-actions";
import { AgentMarkdown } from "@/components/agent/agent-markdown";
import { useAgentMessageFormatter } from "@/components/agent/agent-message-format";
import { AgentMediaPreview } from "@/components/agent/agent-media-preview";
import { clipboardImageFiles } from "@/lib/clipboard-image-files";
import type { CreativeAsset, CreativeConversation, CreativeMessage } from "@/lib/creative-runtime-contract";
import { CREATIVE_UPLOAD_MAX_BYTES, isCreativeUploadMimeType } from "@/lib/creative-upload";
import type { DramaAssetReference, DramaEpisode, DramaNamedAsset, DramaProject } from "@/lib/drama-project-contract";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { useCreativeAgentOptions } from "@/hooks/use-creative-agent-options";
import {
    controlCreativeAgentRun,
    createCreativeAgentRun,
    createCreativeConversation,
    getCreativeAgentRun,
    listCreativeAgentRuns,
    listCreativeAssets,
    listCreativeConversationPage,
    listCreativeMessages,
    retryCreativeAgentTasks,
    updateCreativeConversation,
    uploadCreativeAsset,
    watchCreativeAgentRun,
    type CreativeAgentRun,
} from "@/services/api/creative";
import { deleteDramaAgentConversation } from "@/services/api/drama-projects";
import { usePublicSessionStore } from "@/stores/use-public-session-store";
import { useDramaStore } from "../stores/use-drama-store";
import type { DramaProjectStage } from "./drama-project-sections";
import { DramaAgentMentionPicker } from "./drama-agent-mention-picker";
import { DramaAgentHistory } from "./drama-agent-history";
import { collectDramaAgentMentionItems, dramaAgentMentionAtCursor, dramaAgentMentionCandidates, referencedDramaAgentItems, replaceDramaAgentMention, type DramaAgentMentionItem } from "./drama-agent-mention";

type PendingDramaSubmission = {
    clientRequestId: string;
    conversationId?: string;
    viewRevision: number;
    content: string;
    assetIds: string[];
    skillIds: string[];
    modelIds: string[];
    temporaryUserId: string;
    temporaryAssistantId: string;
    snapshot: ReturnType<typeof dramaSnapshot>;
};

export function DramaAgentPanel({
    project,
    episode,
    stage,
    open,
    onOpenChange,
    onConversationChange,
    selectedShotId,
}: {
    project: DramaProject;
    episode: DramaEpisode;
    stage: DramaProjectStage;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConversationChange: (conversationId: string) => void;
    selectedShotId?: string;
}) {
    const t = useTranslations("drama.agent");
    const [activated, setActivated] = useState(open);
    const [desktop, setDesktop] = useState(false);
    const [width, setWidth] = useState(404);
    const [resizing, setResizing] = useState(false);

    useEffect(() => {
        if (open) setActivated(true);
    }, [open]);

    useEffect(() => {
        const media = window.matchMedia("(min-width: 1180px)");
        const update = () => setDesktop(media.matches);
        update();
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, []);

    if (!activated) return null;

    const startResize = () => {
        const move = (event: MouseEvent) => setWidth(Math.min(640, Math.max(348, window.innerWidth - event.clientX)));
        const stop = () => {
            setResizing(false);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", stop);
        };
        setResizing(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", stop, { once: true });
    };

    const content = <DramaAgentContent project={project} episode={episode} stage={stage} selectedShotId={selectedShotId} onClose={() => onOpenChange(false)} onConversationChange={onConversationChange} />;

    if (!desktop)
        return (
            <Drawer
                placement="right"
                size={360}
                open={open}
                mask={false}
                closable={false}
                destroyOnHidden={false}
                onClose={() => onOpenChange(false)}
                rootClassName="drama-agent-drawer"
                styles={{ wrapper: { maxWidth: "calc(100vw - 8px)" }, body: { padding: 0 } }}
                aria-label={t("panel")}
            >
                {content}
            </Drawer>
        );

    return (
        <div
            className={`flex h-full min-h-0 shrink-0 overflow-hidden bg-card ${resizing ? "" : "transition-opacity duration-300 ease-out"} ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
            style={{ width: open ? width : 0 }}
            data-drama-agent-panel-frame
            aria-hidden={!open}
        >
            <aside className={`relative h-full min-w-0 shrink-0 border-l border-border ${resizing ? "" : "transition-transform duration-300 ease-out"} ${open ? "translate-x-0" : "translate-x-8"}`} style={{ width: "100%" }} aria-label={t("panelAria")}>
                <button type="button" className="absolute inset-y-0 left-0 z-40 w-4 -translate-x-1/2 cursor-col-resize" onMouseDown={startResize} aria-label={t("resizeAria")} />
                {content}
            </aside>
        </div>
    );
}

function DramaAgentContent({
    project,
    episode,
    stage,
    selectedShotId,
    onClose,
    onConversationChange,
    embedded = false,
}: {
    project: DramaProject;
    episode: DramaEpisode;
    stage: DramaProjectStage;
    selectedShotId?: string;
    onClose: () => void;
    onConversationChange: (conversationId: string) => void;
    embedded?: boolean;
}) {
    const { formatMessage } = useAgentMessageFormatter();
    const t = useTranslations("drama.agent");
    const { message, modal } = App.useApp();
    const replaceProject = useDramaStore((state) => state.replaceProject);
    const site = usePublicSessionStore((state) => state.payload?.settings?.site) || { logoUrl: "/logo.svg" };
    const { skills, skillsLoading, models } = useCreativeAgentOptions("drama");
    const [messages, setMessages] = useState<CreativeMessage[]>([]);
    const [assets, setAssets] = useState<CreativeAsset[]>([]);
    const [prompt, setPrompt] = useState("");
    const [selectedSkillId, setSelectedSkillId] = useState<string>();
    const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
    const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
    const [smartPlanning, setSmartPlanning] = useState(true);
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [conversations, setConversations] = useState<CreativeConversation[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
    const [historyHasMore, setHistoryHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [runId, setRunId] = useState<string>();
    const [runStatus, setRunStatus] = useState<CreativeAgentRun["status"]>();
    const streamRef = useRef<(() => void) | null>(null);
    const assetRefreshRef = useRef<Promise<void> | null>(null);
    const queuedAssetConversationRef = useRef<string | undefined>(undefined);
    const submittingRef = useRef(false);
    const failedSubmissionsRef = useRef(new Map<string, PendingDramaSubmission>());
    const endRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const caretRef = useRef(0);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const activeConversationIdRef = useRef(project.creativeConversationId);
    const onConversationChangeRef = useRef(onConversationChange);
    const conversationLoadRef = useRef(0);
    const selectedSkill = skills.find((skill) => skill.id === selectedSkillId);
    const selectedModels = models.filter((model) => selectedModelIds.includes(model.id));
    const selectedAssets = assets.filter((asset) => selectedAssetIds.includes(asset.id));
    const mentionItems = useMemo(() => collectDramaAgentMentionItems(project, episode), [episode, project]);
    const mentionCandidates = useMemo(() => dramaAgentMentionCandidates(mentionItems, mentionQuery || ""), [mentionItems, mentionQuery]);
    const referencedProjectItems = useMemo(() => referencedDramaAgentItems(prompt, mentionItems), [mentionItems, prompt]);
    const stageGuide = useMemo(
        () => ({
            label: t(`guides.${stage}.label`),
            prompts: STAGE_GUIDE_ACTIONS.map((action) => ({ label: t(`guides.actions.${action}`), prompt: t(`guides.${stage}.${action}`) })),
        }),
        [stage, t],
    );

    useEffect(() => {
        if (project.creativeConversationId) activeConversationIdRef.current = project.creativeConversationId;
    }, [project.creativeConversationId]);

    useEffect(() => {
        onConversationChangeRef.current = onConversationChange;
    }, [onConversationChange]);

    const refresh = useCallback(async (conversationId = activeConversationIdRef.current) => {
        if (!conversationId) return { messages: [] as CreativeMessage[], assets: [] as CreativeAsset[] };
        const [nextMessages, nextAssets] = await Promise.all([listCreativeMessages(conversationId), listCreativeAssets(conversationId)]);
        if (activeConversationIdRef.current === conversationId) {
            setMessages(nextMessages);
            setAssets(nextAssets);
        }
        return { messages: nextMessages, assets: nextAssets };
    }, []);

    const refreshHistory = useCallback(
        async (offset = 0) => {
            const page = await listCreativeConversationPage({ surface: "drama", source: "drama", projectId: project.id, offset, limit: 20 });
            setConversations((current) => (offset ? Array.from(new Map([...current, ...page.conversations].map((item) => [item.id, item])).values()) : page.conversations));
            setHistoryHasMore(page.hasMore);
        },
        [project.id],
    );

    const refreshAssets = useCallback((conversationId: string) => {
        if (assetRefreshRef.current) {
            queuedAssetConversationRef.current = conversationId;
            return assetRefreshRef.current;
        }
        const load = async () => {
            let nextConversationId: string | undefined = conversationId;
            do {
                const currentConversationId = nextConversationId;
                queuedAssetConversationRef.current = undefined;
                const nextAssets = await listCreativeAssets(currentConversationId);
                if (activeConversationIdRef.current === currentConversationId) setAssets(nextAssets);
                nextConversationId = queuedAssetConversationRef.current;
            } while (nextConversationId);
        };
        const request = load().finally(() => {
            if (assetRefreshRef.current === request) assetRefreshRef.current = null;
        });
        assetRefreshRef.current = request;
        return request;
    }, []);

    const updateAssistant = useCallback((id: string, content?: string, status: CreativeMessage["status"] = "running") => {
        setMessages((current) => current.map((item) => (item.id === id ? { ...item, ...(content ? { content } : {}), status, updatedAt: Date.now() } : item)));
    }, []);

    useEffect(() => {
        endRef.current?.scrollIntoView({ block: "end" });
    }, [assets.length, messages.at(-1)?.id]);

    const assetsByRun = useMemo(() => {
        const map = new Map<string, CreativeAsset[]>();
        for (const asset of assets) {
            const key = asset.messageId || asset.sourceRunId;
            if (key) map.set(key, [...(map.get(key) || []), asset]);
        }
        return map;
    }, [assets]);
    const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);

    const ensureConversation = async () => {
        if (activeConversationIdRef.current) return activeConversationIdRef.current;
        const conversation = await createCreativeConversation({ surface: "drama", source: "drama", projectId: project.id, title: t("history.newConversation") });
        activeConversationIdRef.current = conversation.id;
        onConversationChange(conversation.id);
        return conversation.id;
    };

    const uploadImages = async (files: File[]) => {
        const unsupported = files.find((file) => !isCreativeUploadMimeType(file.type) || !file.type.startsWith("image/"));
        if (unsupported) return message.error(t("uploads.unsupported", { name: unsupported.name }));
        const oversized = files.find((file) => file.size > CREATIVE_UPLOAD_MAX_BYTES);
        if (oversized) return message.error(t("uploads.tooLarge", { name: oversized.name }));
        if (!files.length || uploading || loading) return;
        setUploading(true);
        try {
            const conversationId = await ensureConversation();
            const uploaded: CreativeAsset[] = [];
            for (const file of files) uploaded.push(await uploadCreativeAsset(conversationId, file));
            setAssets((current) => [...current, ...uploaded.filter((asset) => !current.some((item) => item.id === asset.id))]);
            setSelectedAssetIds((current) => Array.from(new Set([...current, ...uploaded.map((asset) => asset.id)])));
            message.success(t("uploads.success", { count: uploaded.length }));
        } catch {
            message.error(t("uploads.failed"));
        } finally {
            setUploading(false);
        }
    };

    const watchRun = useCallback(
        (run: CreativeAgentRun, assistantMessageId: string) => {
            const viewRevision = conversationLoadRef.current;
            const isCurrentRun = () => viewRevision === conversationLoadRef.current && activeConversationIdRef.current === run.conversationId;
            activeConversationIdRef.current = run.conversationId;
            streamRef.current?.();
            setRunId(run.id);
            setRunStatus(run.status);
            setSending(true);
            submittingRef.current = true;
            streamRef.current = watchCreativeAgentRun(run.id, {
                onProgress: (text) => {
                    if (!isCurrentRun()) return;
                    updateAssistant(assistantMessageId, text);
                },
                onTaskCompleted: () => void refreshAssets(run.conversationId).catch(() => undefined),
                onStatus: (status) => {
                    if (isCurrentRun()) setRunStatus(status);
                },
                onProjectHandoff: () => undefined,
                onConnectionError: () => {
                    if (!isCurrentRun()) return;
                    updateAssistant(assistantMessageId, t("errors.connectionFailed"), "failed");
                    streamRef.current = null;
                },
                onTerminal: (status, text) => {
                    if (!isCurrentRun()) return;
                    updateAssistant(assistantMessageId, status === "completed" ? text : t("errors.requestFailed"), status === "completed" ? "completed" : status);
                    setSending(false);
                    submittingRef.current = false;
                    setRunId(undefined);
                    setRunStatus(status);
                    streamRef.current = null;
                    void refresh(run.conversationId);
                },
            });
            return assistantMessageId;
        },
        [refresh, refreshAssets, t, updateAssistant],
    );

    const openConversation = useCallback(
        async (conversationId: string, updateProject = true) => {
            const requestId = ++conversationLoadRef.current;
            streamRef.current?.();
            streamRef.current = null;
            submittingRef.current = false;
            setSending(false);
            setRunId(undefined);
            setRunStatus(undefined);
            setLoading(true);
            setMessages([]);
            setAssets([]);
            setSelectedAssetIds([]);
            activeConversationIdRef.current = conversationId;
            if (updateProject) onConversationChangeRef.current(conversationId);
            try {
                const [loaded, runs] = await Promise.all([refresh(conversationId), listCreativeAgentRuns("drama", { activeOnly: true, projectId: project.id, conversationId })]);
                if (requestId !== conversationLoadRef.current || activeConversationIdRef.current !== conversationId) return;
                const activeRun = runs.find((run) => run.conversationId === conversationId && ["planning", "running", "paused"].includes(run.status));
                if (activeRun) {
                    const assistant = loaded.messages.find((item) => item.id === activeRun.assistantMessageId) || [...loaded.messages].reverse().find((item) => item.role === "assistant" && item.status === "running");
                    watchRun(activeRun, assistant?.id || activeRun.assistantMessageId);
                }
                setHistoryOpen(false);
                window.requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end" }));
            } finally {
                if (requestId === conversationLoadRef.current) setLoading(false);
            }
        },
        [project.id, refresh, watchRun],
    );

    const newConversation = useCallback(async () => {
        const requestId = ++conversationLoadRef.current;
        const previousConversationId = activeConversationIdRef.current;
        activeConversationIdRef.current = undefined;
        streamRef.current?.();
        streamRef.current = null;
        submittingRef.current = false;
        setHistoryOpen(false);
        setLoading(true);
        setMessages([]);
        setAssets([]);
        setSending(false);
        setRunId(undefined);
        setRunStatus(undefined);
        let conversation: CreativeConversation;
        try {
            conversation = await createCreativeConversation({ surface: "drama", source: "drama", projectId: project.id, title: t("history.newConversation") });
        } catch {
            if (requestId !== conversationLoadRef.current) return;
            message.error(t("errors.createConversationFailed"));
            if (previousConversationId) await openConversation(previousConversationId, false);
            else setLoading(false);
            return;
        }
        if (requestId !== conversationLoadRef.current) return;
        setPrompt("");
        setMentionQuery(null);
        setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
        await openConversation(conversation.id);
        window.requestAnimationFrame(() => inputRef.current?.focus());
    }, [message, openConversation, project.id, t]);

    const renameConversation = useCallback(
        async (conversationId: string, title: string) => {
            try {
                const updated = await updateCreativeConversation(conversationId, { title });
                setConversations((current) => current.map((item) => (item.id === conversationId ? updated : item)));
                message.success(t("history.renameSuccess"));
            } catch {
                message.error(t("errors.renameConversationFailed"));
            }
        },
        [message, t],
    );

    const confirmDeleteConversation = useCallback(
        (conversation: CreativeConversation) => {
            modal.confirm({
                title: t("history.deleteTitle"),
                content: t("history.deleteDescription", { title: conversation.title || t("history.newConversation") }),
                okText: t("history.delete"),
                okButtonProps: { danger: true },
                cancelText: t("history.cancel"),
                centered: true,
                onOk: async () => {
                    try {
                        const result = await deleteDramaAgentConversation(project.id, conversation.id);
                        setConversations((current) => current.filter((item) => item.id !== conversation.id));
                        if (activeConversationIdRef.current === conversation.id) {
                            replaceProject(result.project);
                            await openConversation(result.activeConversationId, false);
                        }
                        message.success(t("history.deleteSuccess"));
                    } catch (error) {
                        message.error(t("errors.deleteConversationFailed"));
                        throw error;
                    }
                },
            });
        },
        [message, modal, openConversation, project.id, replaceProject, t],
    );

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        const conversationId = activeConversationIdRef.current;
        const load = async () => {
            if (!conversationId) {
                setMessages([]);
                setAssets([]);
                setLoading(false);
                return;
            }
            await openConversation(conversationId, false);
            if (cancelled) return;
        };
        void load().catch(() => {
            if (cancelled) return;
            setLoading(false);
            message.error(t("errors.restoreTaskFailed"));
        });
        return () => {
            cancelled = true;
            streamRef.current?.();
            streamRef.current = null;
        };
    }, [message, openConversation, project.id, t]);

    const setHistoryVisibility = (nextOpen: boolean) => {
        setHistoryOpen(nextOpen);
        if (!nextOpen) return;
        setHistoryLoading(true);
        void refreshHistory()
            .catch(() => message.error(t("errors.loadHistoryFailed")))
            .finally(() => setHistoryLoading(false));
    };

    const loadMoreHistory = () => {
        if (historyLoadingMore || !historyHasMore) return;
        setHistoryLoadingMore(true);
        void refreshHistory(conversations.length)
            .catch(() => message.error(t("errors.loadHistoryFailed")))
            .finally(() => setHistoryLoadingMore(false));
    };

    const executeSubmission = async (submission: PendingDramaSubmission) => {
        const isCurrentView = () => submission.viewRevision === conversationLoadRef.current && activeConversationIdRef.current === submission.conversationId;
        let result: Awaited<ReturnType<typeof createCreativeAgentRun>>;
        try {
            result = await createCreativeAgentRun({
                clientRequestId: submission.clientRequestId,
                surface: "drama",
                conversationId: submission.conversationId,
                projectId: project.id,
                prompt: submission.content,
                assetIds: submission.assetIds,
                skillIds: submission.skillIds,
                modelIds: submission.modelIds,
                snapshot: submission.snapshot,
            });
        } catch {
            if (!isCurrentView()) return false;
            failedSubmissionsRef.current.set(submission.temporaryAssistantId, submission);
            const content = t("errors.requestFailed");
            setMessages((current) => current.map((item) => (item.id === submission.temporaryAssistantId ? { ...item, content, status: "failed", updatedAt: Date.now() } : item)));
            setSending(false);
            submittingRef.current = false;
            setRunId(undefined);
            setRunStatus(undefined);
            return false;
        }
        failedSubmissionsRef.current.delete(submission.temporaryAssistantId);
        if (!isCurrentView()) return true;
        activeConversationIdRef.current = result.run.conversationId;
        if (result.run.conversationId !== project.creativeConversationId) onConversationChangeRef.current(result.run.conversationId);
        setRunId(result.run.id);
        setRunStatus(result.run.status);
        setMessages((current) =>
            current.map((item) => {
                if (item.id === submission.temporaryUserId) return { ...item, id: result.run.inputMessageId, conversationId: result.run.conversationId, runId: result.run.id };
                if (item.id === submission.temporaryAssistantId) return { ...item, id: result.run.assistantMessageId, conversationId: result.run.conversationId, runId: result.run.id };
                return item;
            }),
        );
        watchRun(result.run, result.run.assistantMessageId);
        return true;
    };

    const submit = async () => {
        const content = prompt.trim();
        if (!content || sending || submittingRef.current || uploading || loading) return;
        submittingRef.current = true;
        setPrompt("");
        setSending(true);
        const now = Date.now();
        const sequence = messages.reduce((highest, item) => Math.max(highest, item.sequence), 0) + 1;
        const temporaryUserId = `message-${nanoid()}`;
        const temporaryAssistantId = `message-${nanoid()}`;
        const assetIds = [...selectedAssetIds];
        const submission: PendingDramaSubmission = {
            clientRequestId: `drama-agent-${nanoid()}`,
            conversationId: activeConversationIdRef.current,
            viewRevision: conversationLoadRef.current,
            content,
            assetIds,
            skillIds: selectedSkillId ? [selectedSkillId] : [],
            modelIds: smartPlanning ? [] : selectedModelIds,
            temporaryUserId,
            temporaryAssistantId,
            snapshot: dramaSnapshot(project, episode, stage, selectedShotId, referencedProjectItems),
        };
        setMessages((current) => [
            ...current,
            { id: temporaryUserId, conversationId: submission.conversationId || "pending", sequence, role: "user", status: "completed", content, metadata: { assetIds }, createdAt: now, updatedAt: now },
            {
                id: temporaryAssistantId,
                conversationId: submission.conversationId || "pending",
                sequence: sequence + 1,
                role: "assistant",
                status: "running",
                content: t(assetIds.length > 0 ? "acknowledgementWithAssets" : "acknowledgement"),
                metadata: {},
                createdAt: now,
                updatedAt: now,
            },
        ]);
        setSelectedSkillId(undefined);
        setSelectedAssetIds((current) => current.filter((id) => !assetIds.includes(id)));
        return executeSubmission(submission);
    };

    const retrySubmission = async (assistantMessageId: string) => {
        const submission = failedSubmissionsRef.current.get(assistantMessageId);
        const failedMessage = messages.find((item) => item.id === assistantMessageId);
        if ((!submission && !failedMessage?.runId) || sending || submittingRef.current) return false;
        submittingRef.current = true;
        setSending(true);
        setMessages((current) => current.map((item) => (item.id === assistantMessageId ? { ...item, content: t("retrying"), status: "running", updatedAt: Date.now() } : item)));
        if (failedMessage?.runId) {
            try {
                const run = await getCreativeAgentRun(failedMessage.runId);
                const failedTaskIds = run.tasks.filter((task) => task.status === "failed").map((task) => task.id);
                const result = failedTaskIds.length
                    ? { run: await retryCreativeAgentTasks(failedMessage.runId, failedTaskIds, failedMessage.conversationId || activeConversationIdRef.current) }
                    : await controlCreativeAgentRun(failedMessage.runId, "retry", failedMessage.conversationId || activeConversationIdRef.current);
                await refresh(result.run.conversationId);
                watchRun(result.run, result.run.assistantMessageId || assistantMessageId);
                return true;
            } catch {
                setMessages((current) => current.map((item) => (item.id === assistantMessageId ? { ...item, content: t("errors.retryFailed"), status: "failed", updatedAt: Date.now() } : item)));
                setSending(false);
                submittingRef.current = false;
                setRunStatus("failed");
                return false;
            }
        }
        return executeSubmission(submission!);
    };

    const controlRun = async (action: "pause" | "resume" | "cancel") => {
        if (!runId) return;
        try {
            const result = await controlCreativeAgentRun(runId, action, activeConversationIdRef.current);
            setRunStatus(result.run.status);
            if (action === "cancel") {
                setSending(false);
                submittingRef.current = false;
                setRunId(undefined);
            }
        } catch {
            message.error(t("errors.controlFailed"));
        }
    };

    const toggleModel = (model: CreativeAgentModelOption) => {
        setSelectedModelIds((current) => {
            const next = current.includes(model.id) ? current.filter((id) => id !== model.id) : [...current, model.id];
            setSmartPlanning(next.length === 0);
            return next;
        });
    };

    const enableSmartPlanning = () => {
        setSelectedModelIds([]);
        setSmartPlanning(true);
    };

    const fillStagePrompt = (prompt: string) => {
        setPrompt(prompt);
        setMentionQuery(null);
        window.requestAnimationFrame(() => inputRef.current?.focus());
    };

    const selectMention = (item: DramaAgentMentionItem) => {
        const result = replaceDramaAgentMention(prompt, caretRef.current, item.alias);
        setPrompt(result.value);
        setMentionQuery(null);
        window.requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.setSelectionRange(result.cursor, result.cursor);
        });
    };

    return (
        <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
            <div className="flex h-12 shrink-0 items-center border-b border-border px-3.5">
                <div className="flex w-full min-w-0 items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2 font-medium">
                        <SiteLogo logoUrl={site.logoUrl} className="size-5" />
                        <span className="truncate">{stageGuide.label}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                        <Tooltip title={t("history.newConversation")}>
                            <Button
                                type="text"
                                shape="circle"
                                className="!size-8 !min-w-8"
                                icon={<MessageSquarePlus className="size-4" />}
                                disabled={loading}
                                onClick={() => void newConversation().catch(() => message.error(t("errors.createConversationFailed")))}
                                aria-label={t("newConversationAria")}
                            />
                        </Tooltip>
                        <Popover
                            trigger="click"
                            placement="bottomRight"
                            arrow={false}
                            open={historyOpen}
                            onOpenChange={setHistoryVisibility}
                            styles={{ container: { padding: 4, borderRadius: 10 } }}
                            content={
                                <DramaAgentHistory
                                    items={conversations}
                                    activeId={activeConversationIdRef.current}
                                    loading={historyLoading}
                                    hasMore={historyHasMore}
                                    loadingMore={historyLoadingMore}
                                    onOpen={(conversationId) => void openConversation(conversationId).catch(() => message.error(t("errors.restoreConversationFailed")))}
                                    onRename={(conversationId, title) => void renameConversation(conversationId, title)}
                                    onDelete={confirmDeleteConversation}
                                    onLoadMore={loadMoreHistory}
                                />
                            }
                        >
                            <Tooltip title={t("history.title")}>
                                <Button type="text" shape="circle" className={`!size-8 !min-w-8 ${historyOpen ? "!bg-primary/10 !text-primary" : ""}`} icon={<History className="size-4" />} aria-label={t("openHistoryAria")} aria-expanded={historyOpen} />
                            </Tooltip>
                        </Popover>
                        {!embedded ? (
                            <Tooltip title={t("collapse")}>
                                <Button type="text" shape="circle" className="!size-8 !min-w-8" icon={<X className="size-4" />} onClick={onClose} aria-label={t("collapse")} />
                            </Tooltip>
                        ) : null}
                    </div>
                </div>
            </div>
            <div className="hide-scrollbar min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto px-3.5 py-3" data-drama-agent-message-scroll>
                {loading ? (
                    <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground" data-drama-agent-loading>
                        <div className="flex items-center gap-2 text-sm font-medium">
                            <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                            {t("restoringConversation")}
                        </div>
                    </div>
                ) : null}
                {!loading && !messages.length ? (
                    <div data-drama-agent-empty data-drama-agent-quick-actions>
                        <Dropdown
                            trigger={["click"]}
                            placement="bottomLeft"
                            menu={{
                                items: stageGuide.prompts.map((item, index) => ({ key: String(index), label: item.label })),
                                onClick: ({ key }) => {
                                    const item = stageGuide.prompts[Number(key)];
                                    if (item) fillStagePrompt(item.prompt);
                                },
                            }}
                        >
                            <Button
                                block
                                className="!flex !h-8 !items-center !justify-start !gap-1.5 !px-2.5 !text-xs !text-muted-foreground hover:!border-foreground/20 hover:!text-foreground"
                                icon={<ListChecks className="size-3.5" aria-hidden />}
                                disabled={sending}
                                aria-label={t("openSuggestionsAria")}
                            >
                                <span className="min-w-0 flex-1 truncate text-left">{t("suggestions")}</span>
                                <span className="text-[11px] tabular-nums opacity-65">{t("suggestionCount", { count: stageGuide.prompts.length })}</span>
                                <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden />
                            </Button>
                        </Dropdown>
                    </div>
                ) : null}
                {messages.map((message) => {
                    const referencedAssets = message.role === "user" ? messageAssetIds(message).flatMap((id) => assetById.get(id) || []) : [];
                    const messageAssets = [...(assetsByRun.get(message.id) || []), ...(message.runId ? assetsByRun.get(message.runId) || [] : [])].filter((asset, index, list) => list.findIndex((item) => item.id === asset.id) === index);
                    const displayContent = message.status === "failed" ? t("errors.requestFailed") : formatMessage(message.content);
                    return (
                        <div key={message.id} className={`group/message min-w-0 ${message.role === "user" ? "pl-8 text-right" : "pr-2"}`}>
                            {referencedAssets.length ? <DramaMessageReferences assets={referencedAssets} /> : null}
                            <div className={`min-w-0 break-words text-sm leading-6 [overflow-wrap:anywhere] ${message.status === "failed" ? "text-red-500" : "text-foreground"}`}>
                                {message.status === "running" ? <LoaderCircle className="mr-1 inline size-3.5 animate-spin" /> : null}
                                {message.role === "assistant" && message.status === "completed" ? <AgentMarkdown>{displayContent}</AgentMarkdown> : <span className="whitespace-pre-wrap">{displayContent}</span>}
                            </div>
                            {messageAssets.length ? <DramaAgentAssets assets={messageAssets} project={project} episode={episode} /> : null}
                            {message.role === "assistant" && message.status === "failed" ? (
                                <Button
                                    type="text"
                                    size="small"
                                    className="!mt-1 !h-7 !px-1.5 !text-xs !text-red-600 hover:!bg-red-50 hover:!text-red-700 dark:!text-red-300 dark:hover:!bg-red-950/30 dark:hover:!text-red-200"
                                    icon={<RotateCcw className="size-3.5" />}
                                    onClick={() => void retrySubmission(message.id)}
                                    aria-label={t("retryAria")}
                                >
                                    {t("retry")}
                                </Button>
                            ) : null}
                            {message.status !== "running" ? (
                                <AgentMessageActions
                                    text={displayContent}
                                    downloads={agentAssetDownloads(messageAssets, { image: t("generatedImage"), video: t("generatedVideo") })}
                                    onEdit={
                                        message.role === "user" && !sending
                                            ? (text) => {
                                                  setPrompt(text);
                                                  setSelectedAssetIds(messageAssetIds(message).filter((id) => assets.some((asset) => asset.id === id)));
                                                  window.requestAnimationFrame(() => inputRef.current?.focus());
                                              }
                                            : undefined
                                    }
                                    align={message.role === "user" ? "end" : "start"}
                                />
                            ) : null}
                        </div>
                    );
                })}
                <div ref={endRef} />
            </div>
            <div className="mx-3 mb-3 mt-2 min-w-0 shrink-0 rounded-2xl border border-border bg-background px-3.5 pb-3.5 pt-3.5 shadow-sm" data-drama-agent-composer onWheelCapture={(event) => event.stopPropagation()}>
                {selectedSkill ? <CreativeAgentSkillCard skill={selectedSkill} onRemove={() => setSelectedSkillId(undefined)} className="pb-1" /> : null}
                <div className="flex min-w-0 items-start gap-2" data-drama-agent-input-row>
                    {selectedAssets.length || !sending ? (
                        <div className="hide-scrollbar flex max-w-[44%] shrink-0 items-start gap-1 overflow-x-auto overflow-y-hidden px-0.5 py-1" aria-label={t("turnReferences")} aria-live="polite">
                            {selectedAssets.map((asset) => {
                                const url = asset.serverUrl || asset.remoteUrl || "";
                                return (
                                    <div key={asset.id} className="group relative size-10 shrink-0 overflow-visible rounded-md border border-border bg-muted">
                                        <div className="size-full overflow-hidden rounded-[5px]">
                                            {url ? <AgentMediaPreview type="image" url={url} title={asset.title || t("referenceImage")} className="size-full" /> : <ImagePlus className="m-auto size-4 text-muted-foreground" />}
                                        </div>
                                        <button
                                            type="button"
                                            className="absolute right-0 top-0 z-10 flex size-7 items-start justify-end rounded-full bg-transparent p-0.5 text-muted-foreground transition hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
                                            onClick={() => setSelectedAssetIds((current) => current.filter((id) => id !== asset.id))}
                                            aria-label={t("removeReferenceAria", { title: asset.title || t("referenceImage") })}
                                        >
                                            <span className="grid size-4 place-items-center rounded-full border border-border bg-background/95 shadow-sm">
                                                <X className="size-2" />
                                            </span>
                                        </button>
                                    </div>
                                );
                            })}
                            <Button
                                type="text"
                                className="!size-10 !min-w-10 !shrink-0 !rounded-lg !border !border-border !p-0"
                                icon={uploading ? <LoaderCircle className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                                disabled={sending || loading}
                                loading={uploading}
                                onClick={() => fileInputRef.current?.click()}
                                aria-label={selectedAssets.length ? t("addMoreReferences") : t("addReference")}
                            />
                        </div>
                    ) : null}
                    <Popover
                        trigger={[]}
                        placement="topLeft"
                        autoAdjustOverflow={{ adjustX: 1, adjustY: 1 }}
                        arrow={false}
                        open={mentionQuery !== null}
                        onOpenChange={(nextOpen) => {
                            if (!nextOpen) setMentionQuery(null);
                        }}
                        styles={{ container: { padding: 0, borderRadius: 10, overflow: "hidden" } }}
                        content={<DramaAgentMentionPicker items={mentionCandidates} selectedIds={new Set(referencedProjectItems.map((item) => item.id))} onSelect={selectMention} />}
                    >
                        <textarea
                            ref={inputRef}
                            value={prompt}
                            rows={3}
                            placeholder={t("composerPlaceholder")}
                            disabled={sending || loading}
                            className="hide-scrollbar min-h-20 min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-1 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-0 focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60"
                            onChange={(event) => {
                                caretRef.current = event.target.selectionStart;
                                setPrompt(event.target.value);
                                setMentionQuery(dramaAgentMentionAtCursor(event.target.value, event.target.selectionStart)?.query ?? null);
                            }}
                            onClick={(event) => {
                                caretRef.current = event.currentTarget.selectionStart;
                                setMentionQuery(dramaAgentMentionAtCursor(event.currentTarget.value, event.currentTarget.selectionStart)?.query ?? null);
                            }}
                            onPaste={(event) => {
                                const files = clipboardImageFiles(event.clipboardData);
                                if (!files.length) return;
                                event.preventDefault();
                                void uploadImages(files);
                            }}
                            onKeyDown={(event) => {
                                if (event.key === "Escape" && mentionQuery !== null) {
                                    event.preventDefault();
                                    setMentionQuery(null);
                                    return;
                                }
                                if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey) return;
                                event.preventDefault();
                                if (mentionQuery !== null && mentionCandidates.length) return selectMention(mentionCandidates[0]);
                                void submit();
                            }}
                        />
                    </Popover>
                </div>
                <div className="mt-2 flex min-w-0 items-center gap-2.5 border-t border-border pt-2" data-drama-agent-toolbar>
                    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden py-0.5">
                        <input
                            ref={fileInputRef}
                            hidden
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            multiple
                            onChange={(event) => {
                                void uploadImages(Array.from(event.target.files || []));
                                event.target.value = "";
                            }}
                        />
                        <CreativeAgentControls
                            compact
                            skills={skills}
                            skillsLoading={skillsLoading}
                            selectedSkill={selectedSkill}
                            models={models}
                            selectedModels={selectedModels}
                            smartPlanning={smartPlanning}
                            onSelectSkill={(skill) => setSelectedSkillId(skill.id)}
                            onToggleModel={toggleModel}
                            onClearModels={enableSmartPlanning}
                            onSmartPlanningChange={(enabled) => (enabled ? enableSmartPlanning() : setSmartPlanning(false))}
                        />
                    </div>
                    {sending && runId ? (
                        <div className="flex items-center gap-1">
                            {runStatus === "paused" ? (
                                <Button type="text" shape="circle" icon={<Play className="size-3.5" />} onClick={() => void controlRun("resume")} aria-label={t("resume")} />
                            ) : (
                                <Button type="text" shape="circle" icon={<Pause className="size-3.5" />} onClick={() => void controlRun("pause")} aria-label={t("pause")} />
                            )}
                            <Button danger shape="circle" icon={<Square className="size-3.5" />} onClick={() => void controlRun("cancel")} aria-label={t("stop")} />
                        </div>
                    ) : (
                        <Button type="primary" shape="circle" className="!size-10 !min-w-10 !shrink-0" icon={<ArrowUp className="size-4" />} disabled={!prompt.trim() || uploading || loading} onClick={() => void submit()} aria-label={t("send")} />
                    )}
                </div>
            </div>
        </div>
    );
}

function DramaMessageReferences({ assets }: { assets: CreativeAsset[] }) {
    const t = useTranslations("drama.agent");
    let imageIndex = 0;
    return (
        <div className="mb-1.5 flex max-w-full flex-wrap justify-end gap-1.5" aria-label={t("turnReferences")}>
            {assets.flatMap((asset) => {
                const url = asset.serverUrl || asset.remoteUrl || "";
                if (asset.type !== "image" || !url) return [];
                return (
                    <div key={asset.id} className="relative size-16 shrink-0 overflow-hidden rounded-lg border border-border bg-muted" title={asset.title || t("referenceImage")}>
                        <AgentMediaPreview type="image" url={url} title={asset.title || t("referenceImage")} className="size-full" />
                        <span className="absolute left-1 top-1 rounded bg-black/65 px-1 py-0.5 text-[9px] font-medium leading-none text-white">{imageReferenceLabel(imageIndex++)}</span>
                    </div>
                );
            })}
        </div>
    );
}

function messageAssetIds(message: CreativeMessage) {
    const value = message.metadata.assetIds;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

function DramaAgentAssets({ assets, project, episode }: { assets: CreativeAsset[]; project: DramaProject; episode: DramaEpisode }) {
    const t = useTranslations("drama.agent");
    const { message } = App.useApp();
    const updateShot = useDramaStore((state) => state.updateShot);
    const updateAsset = useDramaStore((state) => state.updateAsset);
    const addCharacter = useDramaStore((state) => state.addCharacter);
    const addScene = useDramaStore((state) => state.addScene);
    const addProp = useDramaStore((state) => state.addProp);
    const addClue = useDramaStore((state) => state.addClue);
    const [referenceAsset, setReferenceAsset] = useState<CreativeAsset>();
    const [visualAsset, setVisualAsset] = useState<CreativeAsset>();
    const [shotId, setShotId] = useState(episode.shots[0]?.id || "");
    const [frameKind, setFrameKind] = useState<"start" | "end">("start");
    const [visualKind, setVisualKind] = useState<VisualAssetKind>("characters");
    const [visualAssetId, setVisualAssetId] = useState("");
    const [newVisualAssetName, setNewVisualAssetName] = useState("");
    const applyReference = () => {
        const shot = episode.shots.find((item) => item.id === shotId);
        const url = referenceAsset?.serverUrl || referenceAsset?.remoteUrl || "";
        if (!shot || !url) return;
        updateShot(project.id, episode.id, shot.id, {
            ...(frameKind === "start"
                ? { storyboardStatus: "success" as const, storyboardTaskId: undefined, storyboardError: undefined, storyboardImageUrl: url, storyboardImageWidth: referenceAsset?.width, storyboardImageHeight: referenceAsset?.height }
                : {
                      storyboardFrameMode: "first_last" as const,
                      storyboardEndStatus: "success" as const,
                      storyboardEndTaskId: undefined,
                      storyboardEndError: undefined,
                      storyboardEndImageUrl: url,
                      storyboardEndImageWidth: referenceAsset?.width,
                      storyboardEndImageHeight: referenceAsset?.height,
                  }),
            generationStatus: "idle",
            generationTaskId: undefined,
            generationError: undefined,
            videoUrl: undefined,
            audioStatus: "idle",
            audioTaskId: undefined,
            audioError: undefined,
            audioUrl: undefined,
        });
        setReferenceAsset(undefined);
        message.success(t("assets.referenceApplied", { title: shot.title, frame: t(`assets.frames.${frameKind}`) }));
    };

    const applyVisualAsset = () => {
        const sourceAsset = visualAsset;
        const url = sourceAsset?.serverUrl || sourceAsset?.remoteUrl || "";
        if (!sourceAsset || !url) return;
        const reference: DramaAssetReference = {
            id: `reference-${nanoid()}`,
            url,
            storageKey: sourceAsset.storageKey,
            source: "generated",
            label: sourceAsset.title || t("generatedImage"),
            width: sourceAsset.width,
            height: sourceAsset.height,
            createdAt: new Date().toISOString(),
        };
        const selected = project[visualKind].find((item) => item.id === visualAssetId);
        const kindLabel = t(`assets.kinds.${visualKind}.label`);
        const name = newVisualAssetName.trim() || sourceAsset.title.trim() || t("assets.defaultReferenceName", { kind: kindLabel });
        if (selected) {
            const references = [...(selected.references || []), reference];
            updateAsset(project.id, visualKind, selected.id, { references, primaryReferenceId: reference.id, referenceImageUrl: reference.url, referenceStorageKey: reference.storageKey });
            message.success(t("assets.addedToExisting", { name: selected.name }));
        } else if (visualKind === "characters") {
            addCharacter(project.id, {
                name,
                description: t("assets.generatedDescription"),
                profile: emptyAssetProfile(),
                references: [reference],
                primaryReferenceId: reference.id,
                referenceImageUrl: reference.url,
                referenceStorageKey: reference.storageKey,
            });
            message.success(t("assets.created", { kind: kindLabel, name }));
        } else if (visualKind === "scenes") {
            addScene(project.id, {
                name,
                description: t("assets.generatedDescription"),
                profile: emptyAssetProfile(),
                references: [reference],
                primaryReferenceId: reference.id,
                referenceImageUrl: reference.url,
                referenceStorageKey: reference.storageKey,
            });
            message.success(t("assets.created", { kind: kindLabel, name }));
        } else if (visualKind === "props") {
            addProp(project.id, { name, description: t("assets.generatedDescription"), profile: emptyAssetProfile(), references: [reference], primaryReferenceId: reference.id, referenceImageUrl: reference.url, referenceStorageKey: reference.storageKey });
            message.success(t("assets.created", { kind: kindLabel, name }));
        } else {
            addClue(project.id, {
                name,
                description: t("assets.generatedDescription"),
                payoff: "",
                profile: emptyAssetProfile(),
                references: [reference],
                primaryReferenceId: reference.id,
                referenceImageUrl: reference.url,
                referenceStorageKey: reference.storageKey,
            });
            message.success(t("assets.created", { kind: kindLabel, name }));
        }
        setVisualAsset(undefined);
        setVisualAssetId("");
        setNewVisualAssetName("");
    };

    return (
        <>
            <div className="mt-3 grid gap-2">
                {assets
                    .filter((asset) => asset.type !== "text")
                    .map((asset) => {
                        const url = asset.serverUrl || asset.remoteUrl || "";
                        if (!url) return null;
                        return (
                            <div key={asset.id} className="min-w-0">
                                <AgentMediaPreview type={asset.type} url={url} title={asset.title || t("generatedMedia")} className={asset.type === "image" ? "max-h-64 rounded-md" : asset.type === "video" ? "aspect-video rounded-md" : undefined} />
                                {asset.type === "image" ? (
                                    <div className="mt-2 flex min-w-0 items-center rounded-lg border border-border/70 bg-muted/30 p-1">
                                        <Button
                                            type="text"
                                            className="!h-7 !min-w-0 !flex-1 !justify-center !px-2 !text-xs !text-foreground hover:!bg-background/80"
                                            size="small"
                                            icon={<Link2 className="size-3.5" />}
                                            disabled={!episode.shots.length}
                                            onClick={() => setReferenceAsset(asset)}
                                        >
                                            {t("assets.referenceToShot")}
                                        </Button>
                                        <span className="h-4 w-px shrink-0 bg-border" />
                                        <Button
                                            type="text"
                                            className="!h-7 !min-w-0 !flex-1 !justify-center !px-2 !text-xs !text-foreground hover:!bg-background/80"
                                            size="small"
                                            icon={<ImagePlus className="size-3.5" />}
                                            onClick={() => setVisualAsset(asset)}
                                        >
                                            {t("assets.addVisualAsset")}
                                        </Button>
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
            </div>
            <Modal
                title={t("assets.referenceModalTitle")}
                open={Boolean(referenceAsset)}
                width={420}
                centered
                destroyOnHidden
                okText={t("assets.confirmReference")}
                cancelText={t("history.cancel")}
                okButtonProps={{ disabled: !shotId }}
                onCancel={() => setReferenceAsset(undefined)}
                onOk={applyReference}
            >
                <div className="grid gap-4 pt-2">
                    <label className="grid gap-1.5 text-sm">
                        <span className="font-medium">{t("assets.targetShot")}</span>
                        <Select
                            value={shotId || undefined}
                            placeholder={t("assets.selectShot")}
                            optionFilterProp="label"
                            options={episode.shots.map((shot) => ({ value: shot.id, label: `${String(shot.order).padStart(2, "0")} · ${shot.title}` }))}
                            onChange={setShotId}
                        />
                    </label>
                    <label className="grid gap-1.5 text-sm">
                        <span className="font-medium">{t("assets.referencePosition")}</span>
                        <Segmented
                            block
                            value={frameKind}
                            options={[
                                { label: t("assets.frames.start"), value: "start" },
                                { label: t("assets.frames.end"), value: "end" },
                            ]}
                            onChange={(value) => setFrameKind(value as "start" | "end")}
                        />
                    </label>
                    <p className="text-xs leading-5 text-muted-foreground">{t("assets.referenceNotice")}</p>
                </div>
            </Modal>
            <Modal
                title={t("assets.addVisualAsset")}
                open={Boolean(visualAsset)}
                width={460}
                centered
                destroyOnHidden
                okText={t("assets.saveVisualAsset")}
                cancelText={t("history.cancel")}
                okButtonProps={{ disabled: !visualAsset || (!visualAssetId && !newVisualAssetName.trim()) }}
                onCancel={() => {
                    setVisualAsset(undefined);
                    setVisualAssetId("");
                    setNewVisualAssetName("");
                }}
                onOk={applyVisualAsset}
            >
                <div className="grid gap-4 pt-2">
                    <p className="text-sm leading-6 text-muted-foreground">{t("assets.visualAssetNotice")}</p>
                    <label className="grid gap-1.5 text-sm">
                        <span className="font-medium">{t("assets.assetType")}</span>
                        <Segmented
                            block
                            value={visualKind}
                            options={VISUAL_ASSET_KINDS.map((kind) => ({ label: t(`assets.kinds.${kind}.label`), value: kind }))}
                            onChange={(value) => {
                                setVisualKind(value as VisualAssetKind);
                                setVisualAssetId("");
                            }}
                        />
                    </label>
                    <label className="grid gap-1.5 text-sm">
                        <span className="font-medium">{t("assets.addToExisting")}</span>
                        <Select
                            allowClear
                            value={visualAssetId || undefined}
                            placeholder={t("assets.selectExisting")}
                            options={project[visualKind].map((item) => ({ value: item.id, label: item.name }))}
                            onChange={(value) => {
                                setVisualAssetId(value || "");
                                if (value) setNewVisualAssetName("");
                            }}
                        />
                    </label>
                    <label className="grid gap-1.5 text-sm">
                        <span className="font-medium">{t("assets.newAssetName")}</span>
                        <Input
                            value={newVisualAssetName}
                            onChange={(event) => {
                                setNewVisualAssetName(event.target.value);
                                if (event.target.value.trim()) setVisualAssetId("");
                            }}
                            placeholder={t("assets.example", { name: t(`assets.kinds.${visualKind}.placeholder`) })}
                        />
                    </label>
                </div>
            </Modal>
        </>
    );
}

type VisualAssetKind = "characters" | "scenes" | "props" | "clues";

const STAGE_GUIDE_ACTIONS = ["completion", "assets", "consistency", "next"] as const;
const VISUAL_ASSET_KINDS: VisualAssetKind[] = ["characters", "scenes", "props", "clues"];

function emptyAssetProfile() {
    return { visualIdentity: "", styling: "", colorPalette: "", consistencyRules: "" };
}

function agentAssetSnapshot(asset: DramaNamedAsset) {
    return {
        id: asset.id,
        name: asset.name,
        description: asset.description,
        profile: asset.profile,
        primaryReferenceId: asset.primaryReferenceId,
        referenceImageUrl: asset.referenceImageUrl,
    };
}

function dramaSnapshot(project: DramaProject, episode: DramaEpisode, stage: DramaProjectStage, selectedShotId?: string, projectReferences: DramaAgentMentionItem[] = []) {
    return {
        currentStage: stage,
        project: {
            id: project.id,
            title: project.title,
            summary: project.summary,
            style: project.style,
            ratio: project.ratio,
            defaultVideoMode: project.defaultVideoMode,
        },
        episode: {
            id: episode.id,
            title: episode.title,
            script: episode.script,
            outline: episode.outline,
            hook: episode.hook,
            nextPreview: episode.nextPreview,
            sourceRange: episode.sourceRange,
            reviewStatus: episode.reviewStatus,
        },
        selectedShotId,
        currentTurnReferences: projectReferences.map(({ id, kind, title, alias }) => ({ id, kind, title, alias: `@${alias}` })),
        sourceAssets: project.sourceAssets?.map((asset) => ({
            id: asset.id,
            type: asset.type,
            title: asset.title,
            textContent: asset.textContent,
            serverUrl: asset.serverUrl,
            remoteUrl: asset.remoteUrl,
        })),
        characters: project.characters.map((asset) => ({ ...agentAssetSnapshot(asset), voiceProfile: asset.voiceProfile })),
        scenes: project.scenes.map(agentAssetSnapshot),
        props: project.props.map(agentAssetSnapshot),
        clues: project.clues.map((asset) => ({ ...agentAssetSnapshot(asset), payoff: asset.payoff })),
        shots: episode.shots.map((shot) => ({
            id: shot.id,
            order: shot.order,
            title: shot.title,
            description: shot.description,
            sourceText: shot.sourceText,
            shotBoundary: shot.shotBoundary,
            dialogue: shot.dialogue,
            narration: shot.narration,
            utterances: shot.utterances,
            imagePrompt: shot.imagePrompt,
            videoPrompt: shot.videoPrompt,
            cameraMotion: shot.cameraMotion,
            startFramePrompt: shot.startFramePrompt,
            endFramePrompt: shot.endFramePrompt,
            negativePrompt: shot.negativePrompt,
            continuity: shot.continuity,
            duration: shot.duration,
            characterIds: shot.characterIds,
            sceneId: shot.sceneId,
            propIds: shot.propIds,
            clueIds: shot.clueIds,
            videoMode: shot.videoMode,
            storyboardFrameMode: shot.storyboardFrameMode,
            storyboardStatus: shot.storyboardStatus,
            storyboardError: shot.storyboardError,
            storyboardImageUrl: shot.storyboardImageUrl,
            storyboardEndStatus: shot.storyboardEndStatus,
            storyboardEndError: shot.storyboardEndError,
            storyboardEndImageUrl: shot.storyboardEndImageUrl,
            generationStatus: shot.generationStatus,
            generationError: shot.generationError,
            videoUrl: shot.videoUrl,
            subtitle: shot.subtitle,
            audioMode: shot.audioMode,
            audioStatus: shot.audioStatus,
            audioError: shot.audioError,
            audioUrl: shot.audioUrl,
        })),
    };
}

function agentAssetDownloads(assets: CreativeAsset[], labels: { image: string; video: string }): AgentMediaDownload[] {
    return assets.flatMap((asset) => {
        const url = asset.serverUrl || asset.remoteUrl || "";
        return url && (asset.type === "image" || asset.type === "video") ? [{ type: asset.type, url, title: asset.title || labels[asset.type], mimeType: asset.mimeType }] : [];
    });
}
