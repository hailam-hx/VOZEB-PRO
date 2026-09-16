// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCreateAgent } from "./use-create-agent";
import { useCreateDraftAttachmentsStore } from "./use-create-draft-attachments-store";

vi.mock("next-intl", () => ({ useLocale: () => "zh-CN", useTranslations: () => (key: string) => key }));
vi.mock("@/services/api/creative", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/api/creative")>()),
    listCreativeAgentRuns: vi.fn().mockResolvedValue([]),
    listCreativeConversationPage: vi.fn().mockResolvedValue({ conversations: [], hasMore: false }),
}));

beforeEach(() => {
    useCreateDraftAttachmentsStore.setState({ attachments: [] });
    vi.spyOn(URL, "createObjectURL").mockImplementation((file) => `blob:${(file as File).name}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

afterEach(() => {
    useCreateDraftAttachmentsStore.getState().clear();
    vi.restoreAllMocks();
});

describe("useCreateAgent submission retry", () => {
    it("clears the permanent Stop state when a completed snapshot follows the final conversation text", async () => {
        class Source extends EventTarget {
            static current: Source;
            constructor() {
                super();
                Source.current = this;
            }
            close() {}
        }
        vi.stubGlobal("EventSource", Source);
        const run = { id: "run", conversationId: "conversation", inputMessageId: "input", assistantMessageId: "assistant", status: "running", assetIds: [], tasks: [] };
        vi.stubGlobal(
            "fetch",
            vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
                const url = String(input);
                if (url === "/api/agent/runs" && init?.method === "POST") return Response.json({ code: 0, data: { run, created: true } });
                if (url.includes("/messages?"))
                    return Response.json({
                        code: 0,
                        data: {
                            messages: [
                                { id: "input", conversationId: "conversation", runId: "run", sequence: 1, role: "user", status: "completed", content: "你是什么模型？", metadata: {}, createdAt: 1, updatedAt: 1 },
                                {
                                    id: "assistant",
                                    conversationId: "conversation",
                                    runId: "run",
                                    sequence: 2,
                                    role: "assistant",
                                    status: "completed",
                                    content: "本次会话使用的是 GPT-5.6 Sol 文本模型。",
                                    metadata: {},
                                    createdAt: 2,
                                    updatedAt: 2,
                                },
                            ],
                        },
                    });
                if (url === "/api/agent/runs/run") return Response.json({ code: 0, data: { run: { ...run, status: "completed", responseKind: "conversation", conversationReply: "本次会话使用的是 GPT-5.6 Sol 文本模型。" } } });
                if (url.endsWith("/assets")) return Response.json({ code: 0, data: { assets: [] } });
                return Response.json({ code: 0, data: {} });
            }),
        );
        const { result, unmount } = renderHook(() => useCreateAgent());
        try {
            await act(async () => {
                await result.current.submit("你是什么模型？");
            });
            act(() => {
                Source.current.dispatchEvent(new MessageEvent("run.conversation.updated", { data: JSON.stringify({ data: { content: "本次会话使用的是 GPT-5.6 Sol 文本模型。" } }) }));
            });
            expect(result.current.sending).toBe(true);
            expect(result.current.activeRunId).toBe("run");

            await act(async () => {
                Source.current.dispatchEvent(new MessageEvent("run.snapshot", { data: JSON.stringify({ status: "completed", responseKind: "conversation", conversationReply: "本次会话使用的是 GPT-5.6 Sol 文本模型。", tasks: [] }) }));
            });

            expect(result.current.sending).toBe(false);
            expect(result.current.activeRunId).toBeUndefined();
            expect(result.current.activeRunStatus).toBeUndefined();
            expect(result.current.messages.find((message) => message.role === "assistant")).toMatchObject({ status: "completed", content: "本次会话使用的是 GPT-5.6 Sol 文本模型。" });
        } finally {
            unmount();
            vi.unstubAllGlobals();
        }
    });

    it("updates the current Run with live task text without creating visible internal messages", async () => {
        class Source extends EventTarget {
            static current: Source;
            constructor() {
                super();
                Source.current = this;
            }
            close() {}
        }
        vi.stubGlobal("EventSource", Source);
        const run = { id: "run", conversationId: "conversation", inputMessageId: "input", assistantMessageId: "assistant", status: "running", assetIds: [], tasks: [{ id: "parent", type: "text", title: "文章", status: "running" }] };
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: 0, data: { run, created: true } })));
        const { result, unmount } = renderHook(() => useCreateAgent());
        try {
            await act(async () => {
                await result.current.submit("写一篇文章");
            });
            act(() => {
                Source.current.dispatchEvent(
                    new MessageEvent("task.text.updated", { data: JSON.stringify({ data: { runId: "run", parentTaskId: "parent", taskId: "child", attemptId: "attempt", revision: 1, content: "公开文章的第一段", status: "streaming" } }) }),
                );
            });
            expect(result.current.runDetails.run.tasks[0]).toMatchObject({ activeAttemptId: "attempt", visibleTextSnapshot: { content: "公开文章的第一段" } });
            expect(result.current.messages.filter((message) => message.role === "user").map((message) => message.content)).toEqual(["写一篇文章"]);
        } finally {
            unmount();
            vi.unstubAllGlobals();
        }
    });

    it("keeps draft and saved asset selections in the order the user chose them", async () => {
        const { result, unmount } = renderHook(() => useCreateAgent());
        let draftId = "";

        await act(async () => {
            const [draft] = await result.current.uploadAttachments([new File(["image"], "draft.webp", { type: "image/webp" })]);
            draftId = draft.id;
        });
        act(() => result.current.selectAsset("saved-image"));

        expect(result.current.selectedAssetIds).toEqual([draftId, "saved-image"]);
        unmount();
    });

    it("keeps newly selected files as local drafts until the user submits", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/create/use-create-agent.ts"), "utf8");
        const draftStoreSource = await readFile(resolve(process.cwd(), "src/app/(user)/create/use-create-draft-attachments-store.ts"), "utf8");
        const uploadStart = source.indexOf("const uploadAttachments");
        const materializeStart = source.indexOf("const materializeDraftAttachments", uploadStart);
        const watchStart = source.indexOf("const watchRun", materializeStart);
        const submitStart = source.indexOf("const submit =", watchStart);
        const uploadSource = source.slice(uploadStart, materializeStart);
        const materializeSource = source.slice(materializeStart, watchStart);
        const submitSource = source.slice(submitStart, source.indexOf("const retrySubmission", submitStart));

        expect(uploadSource).toContain("addDraftAttachments(files");
        expect(uploadSource).not.toContain("ensureConversation");
        expect(uploadSource).not.toContain("uploadCreativeAsset");
        expect(draftStoreSource).toContain("URL.createObjectURL(file)");
        expect(draftStoreSource).not.toContain("localStorage");
        expect(materializeSource).toContain("await ensureConversation(generation)");
        expect(materializeSource).toContain("await uploadCreativeAsset(materializedConversationId, draft.file)");
        expect(submitSource.indexOf("await materializeDraftAttachments(selectedIds)")).toBeLessThan(submitSource.indexOf("executeSubmission(snapshot)"));
    });

    it("reuses the original request and keeps attachments on the original user message", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/create/use-create-agent.ts"), "utf8");
        const executeStart = source.indexOf("const executeSubmission");
        const submitStart = source.indexOf("const submit =", executeStart);
        const retryStart = source.indexOf("const retrySubmission", submitStart);
        const executeSource = source.slice(executeStart, submitStart);
        const submitSource = source.slice(submitStart, retryStart);
        const retrySource = source.slice(retryStart, source.indexOf("const cancel", retryStart));

        expect(executeSource).toContain("clientRequestId: snapshot.clientRequestId");
        expect(executeSource).toContain("preferences: snapshot.preferences");
        expect(submitSource).toContain("metadata: { assetIds }");
        expect(submitSource).toContain("options?.assetIds || selectedAssetIds");
        expect(submitSource).toContain("setSelectedAssetIds((current) => current.filter");
        expect(retrySource).toContain("failedSubmissionsRef.current.get(assistantMessageId)");
        expect(retrySource).toContain("executeSubmission(snapshot)");
        expect(retrySource).not.toContain("setMessages((current) => [");
    });

    it("retries a failed planning run through the existing server run", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/create/use-create-agent.ts"), "utf8");
        const retryStart = source.indexOf("const retryRun");
        const retrySource = source.slice(retryStart, source.indexOf("const renameConversation", retryStart));

        expect(retrySource).toContain('controlCreativeAgentRun(runId, "retry", expectedConversationId)');
        expect(retrySource).toContain("setRunDetails");
        expect(retrySource).toContain("watchRun(result.run, assistantMessage.id");
        expect(retrySource).not.toContain("createCreativeAgentRun");
    });

    it("directly retries failed persisted tasks without rebuilding the composer or conversation", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/create/page.tsx"), "utf8");
        const retryStart = source.indexOf("const retryRound");
        const retrySource = source.slice(retryStart, source.indexOf("const uploadAttachments", retryStart));

        expect(retrySource).toContain("agent.retrySubmission(assistantMessage.id)");
        expect(retrySource).toContain("agent.retryTasks(");
        expect(retrySource).toContain("failedTasks.map((task) => task.id)");
        expect(retrySource).toContain("agent.retryRun(run.id)");
        expect(retrySource).not.toContain("updatePrompt");
        expect(retrySource).not.toContain("createCreativeAgentRun");
        expect(retrySource).not.toContain("createCreativeConversation");
    });

    it("keeps delayed run callbacks and controls scoped to the active conversation", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/create/use-create-agent.ts"), "utf8");
        const watchStart = source.indexOf("const watchRun");
        const reconnectStart = source.indexOf("useEffect(() =>", watchStart);
        const executeStart = source.indexOf("const executeSubmission", reconnectStart);
        const cancelStart = source.indexOf("const cancel", executeStart);
        const controlStart = source.indexOf("const control", cancelStart);

        expect(source.slice(watchStart, reconnectStart)).toContain("if (!isCurrentConversation(run.conversationId, generation)) return false");
        expect(source.slice(reconnectStart, executeStart)).toContain("run.conversationId !== expectedConversationId");
        expect(source.slice(executeStart, cancelStart)).toContain("if (!canClaimCurrentView) return true");
        expect(source.slice(cancelStart, controlStart)).toContain('controlCreativeAgentRun(activeRunId, "cancel", expectedConversationId)');
    });

    it("does not mark a running message as failed when only the event connection stops", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/create/use-create-agent.ts"), "utf8");
        const watchStart = source.indexOf("const watchRun");
        const connectionErrorStart = source.indexOf("onConnectionError:", watchStart);
        const connectionErrorSource = source.slice(connectionErrorStart, source.indexOf("onProjectHandoff:", connectionErrorStart));

        expect(connectionErrorSource).toContain('updateAssistant(assistantMessageId, text, "running")');
        expect(connectionErrorSource).not.toContain('"failed"');
        expect(connectionErrorSource).not.toContain("setActiveRunId(undefined)");
        expect(connectionErrorSource).not.toContain("setActiveRunStatus(undefined)");
    });
});
