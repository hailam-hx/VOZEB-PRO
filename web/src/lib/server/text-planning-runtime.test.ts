import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SystemChannelAdvancedConfig, SystemModelChannel } from "@/lib/auth/store";
import { fetchInternalApi } from "@/lib/server/internal-origin";
import { getTextPlanningRuntime, rankTextPlanningCandidates, requestRoutedText, requestStructuredText, resetTextPlanningRuntime, type TextPlanningCandidate } from "./text-planning-runtime";

vi.mock("@/lib/server/internal-origin", () => ({ fetchInternalApi: vi.fn() }));
vi.mock("@/lib/server/channel-runtime-health", () => ({ recordChannelRuntimeFailure: vi.fn(), recordChannelRuntimeSuccess: vi.fn() }));

const mockedFetch = vi.mocked(fetchInternalApi);
const tool = { name: "make_plan", description: "创建计划", parameters: { type: "object", properties: { result: { type: "string" } } } };

describe("text planning runtime protocol matrix", () => {
    beforeEach(() => {
        resetTextPlanningRuntime();
        mockedFetch.mockReset();
        vi.useRealTimers();
    });

    it.each(["openai", "sub2api", "newapi"] as const)("%s 严格预设直接使用基础 Chat", async (protocol) => {
        mockedFetch.mockResolvedValue(chatJsonResponse());

        const result = await requestStructuredText(requestInput(candidate(protocol, { createPath: "/responses" })));

        expect(result).toMatchObject({ protocol: "chat", arguments: "{}" });
        expect(mockedFetch).toHaveBeenCalledTimes(1);
        expect(String(mockedFetch.mock.calls[0]?.[0])).toContain("/chat/completions");
        expectBasicJsonMessages(requestBody());
    });

    it("compatible 模型明确配置 Responses 时直接使用 Responses", async () => {
        mockedFetch.mockResolvedValue(Response.json({ output_text: "{}" }));

        const result = await requestStructuredText(requestInput(candidate("compatible", { createPath: "/responses" })));

        expect(result).toMatchObject({ protocol: "responses", arguments: "{}" });
        expect(mockedFetch).toHaveBeenCalledTimes(1);
        expect(String(mockedFetch.mock.calls[0]?.[0])).toContain("/responses");
        expect(requestBody()).toMatchObject({ model: "model-one", input: expect.any(Array) });
        expect(requestBody()).not.toHaveProperty("tools");
        expect(requestBody()).not.toHaveProperty("reasoning");
    });

    it("模型级 Responses 预设覆盖 New API 渠道的默认 Chat", async () => {
        const configured = candidate("newapi", {
            modelConfigs: {
                "model-one": { capability: "text", protocol: "compatible", createPath: "/responses" },
            },
        });
        mockedFetch.mockResolvedValue(Response.json({ output_text: "{}" }));

        const result = await requestStructuredText(requestInput(configured));

        expect(result.protocol).toBe("responses");
        expect(String(mockedFetch.mock.calls[0]?.[0])).toContain("/responses");
    });

    it("模型级自定义协议不会因路径名为 responses 被误判", async () => {
        const configured = candidate("compatible", {
            modelConfigs: {
                "model-one": { capability: "text", protocol: "custom", createPath: "/responses", requestTemplate: '{"deployment":"{{model}}","prompt":"{{prompt}}"}', resultField: "payload.plan" },
            },
        });
        mockedFetch.mockResolvedValue(Response.json({ payload: { plan: "{}" } }));

        const result = await requestStructuredText(requestInput(configured));

        expect(result.protocol).toBe("custom");
        expect(requestBody()).toMatchObject({ deployment: "model-one", prompt: expect.stringContaining("user: test") });
    });

    it("GlobalAiOpc Responses 预设直接使用 Responses", async () => {
        mockedFetch.mockResolvedValue(Response.json({ output: [{ type: "function_call", name: "make_plan", arguments: "{}" }] }));

        const result = await requestStructuredText(requestInput(candidate("globalaiopc", { globalAiOpcPreset: "text-openai-responses" })));

        expect(result.protocol).toBe("responses");
        expect(String(mockedFetch.mock.calls[0]?.[0])).toContain("/responses");
    });

    it.each(["text-gemini-native", "text-claude-native"] as const)("GlobalAiOpc %s 通过系统代理的 Chat 适配调用", async (globalAiOpcPreset) => {
        mockedFetch.mockResolvedValue(chatJsonResponse());

        const result = await requestStructuredText(requestInput(candidate("globalaiopc", { globalAiOpcPreset })));

        expect(result.protocol).toBe("chat");
        expect(String(mockedFetch.mock.calls[0]?.[0])).toContain("/chat/completions");
        expectBasicJsonMessages(requestBody());
    });

    it.each(["text-gemini-native", "text-claude-native"] as const)("GlobalAiOpc %s 的路由对话明确使用 buffered Chat 适配", async (globalAiOpcPreset) => {
        const visible: string[] = [];
        mockedFetch.mockResolvedValue(Response.json({ choices: [{ message: { content: "<conversation>\nHello" } }] }));

        const result = await requestRoutedText({
            ...requestInput(candidate("globalaiopc", { globalAiOpcPreset })),
            onConversationContent: (content) => {
                visible.push(content);
            },
        });

        expect(result).toMatchObject({ kind: "conversation", content: "Hello", protocol: "chat" });
        expect(requestBody()).not.toHaveProperty("stream");
        expect(visible).toEqual([]);
    });

    it("Gemini 原生预设使用 generateContent 并解析候选文本", async () => {
        mockedFetch.mockResolvedValue(Response.json({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }));

        const result = await requestStructuredText(
            requestInput(
                candidate("compatible", {
                    apiFormat: "gemini",
                    createPath: "/models/:model:generateContent",
                }),
            ),
        );

        expect(result).toMatchObject({ protocol: "gemini", arguments: "{}" });
        expect(String(mockedFetch.mock.calls[0]?.[0])).toContain("/models/model-one:generateContent");
        expect(requestBody()).toMatchObject({ contents: [{ role: "user", parts: [{ text: "test" }] }], systemInstruction: { parts: [{ text: expect.stringContaining("严格 JSON") }] } });
    });

    it("自定义文本协议使用管理员模板、路径和结果字段", async () => {
        mockedFetch.mockResolvedValue(Response.json({ data: { plan: "{}" } }));

        const result = await requestStructuredText(
            requestInput(
                candidate("custom", {
                    createPath: "/planner/run",
                    requestTemplate: '{"deployment":"{{model}}","conversation":"{{messages}}"}',
                    resultField: "data.plan",
                }),
            ),
        );

        expect(result).toMatchObject({ protocol: "custom", arguments: "{}" });
        expect(String(mockedFetch.mock.calls[0]?.[0])).toContain("/planner/run");
        expect(requestBody()).toMatchObject({ deployment: "model-one", conversation: expect.arrayContaining([{ role: "user", content: "test" }]) });
    });

    it("在 Chat 上游结束前转发已完成判别的多语言对话内容", async () => {
        let closeStream!: () => void;
        const visible: string[] = [];
        mockedFetch.mockResolvedValue(
            sseResponse((controller) => {
                controller.enqueue(chatDelta("<conver"));
                controller.enqueue(chatDelta("sation>\n你好，xin chào"));
                closeStream = () => {
                    controller.enqueue("data: [DONE]\n\n");
                    controller.close();
                };
            }),
        );

        let settled = false;
        const pending = requestRoutedText({
            ...requestInput(candidate("newapi")),
            onConversationContent: (content) => {
                visible.push(content);
            },
        }).finally(() => {
            settled = true;
        });

        await vi.waitFor(() => expect(visible).toEqual(["你好，xin chào"]));
        expect(settled).toBe(false);
        expect(requestBody()).toMatchObject({ model: "model-one", stream: true, stream_options: { include_usage: true } });

        closeStream();
        await expect(pending).resolves.toMatchObject({ kind: "conversation", content: "你好，xin chào", protocol: "chat" });
    });

    it("缓存流式 generation JSON 且不把判别符或计划内容发给公开回调", async () => {
        const visible: string[] = [];
        mockedFetch.mockResolvedValue(
            sseResponse((controller) => {
                controller.enqueue(chatDelta('<generation>\n{"result":'));
                controller.enqueue(chatDelta('"ok"}'));
                controller.enqueue("data: [DONE]\n\n");
                controller.close();
            }),
        );

        const result = await requestRoutedText({
            ...requestInput(candidate("newapi")),
            onConversationContent: (content) => {
                visible.push(content);
            },
        });

        expect(visible).toEqual([]);
        expect(result).toMatchObject({ kind: "generation", arguments: '{"result":"ok"}', protocol: "chat" });
    });

    it("不会把 fenced generation JSON 当作对话内容公开", async () => {
        const visible: string[] = [];
        mockedFetch.mockResolvedValue(
            sseResponse((controller) => {
                controller.enqueue(chatDelta("```j"));
                controller.enqueue(chatDelta('son\n{"result":"ok"}\n```'));
                controller.close();
            }),
        );

        const result = await requestRoutedText({
            ...requestInput(candidate("newapi")),
            onConversationContent: (content) => {
                visible.push(content);
            },
        });

        expect(visible).toEqual([]);
        expect(result).toMatchObject({ kind: "generation", arguments: '{"result":"ok"}' });
    });

    it.each(["<Conversation>\nHello", 'Here is the plan: {"result":"ok"}'])("拒绝无效路由前缀且不公开任何内容: %s", async (output) => {
        const visible: string[] = [];
        mockedFetch.mockResolvedValue(
            sseResponse((controller) => {
                controller.enqueue(chatDelta(output));
                controller.enqueue("data: [DONE]\n\n");
                controller.close();
            }),
        );

        await expect(
            requestRoutedText({
                ...requestInput(candidate("newapi")),
                onConversationContent: (content) => {
                    visible.push(content);
                },
            }),
        ).rejects.toThrow("结果类型");

        expect(visible).toEqual([]);
    });

    it.each([
        ['<conversation>\n{"intent":"generation",', '"deliverables":[]}'],
        ["<conversation>\n<gen", 'eration>\n{"result":"ok"}'],
        ["<conversation>\n```j", 'son\n{"intent":"generation","deliverables":[]}\n```'],
    ])("buffers and rejects a mislabeled planner payload without exposing split frames", async (first, second) => {
        const visible: string[] = [];
        mockedFetch.mockResolvedValue(
            sseResponse((controller) => {
                controller.enqueue(chatDelta(first));
                controller.enqueue(chatDelta(second));
                controller.close();
            }),
        );

        await expect(
            requestRoutedText({
                ...requestInput(candidate("newapi")),
                onConversationContent: (content) => {
                    visible.push(content);
                },
            }),
        ).rejects.toThrow("结果类型");

        expect(visible).toEqual([]);
    });

    it("keeps already safe prose but never publishes JSON appended by a mislabeled planner", async () => {
        const visible: string[] = [];
        mockedFetch.mockResolvedValue(
            sseResponse((controller) => {
                controller.enqueue(chatDelta("<conversation>\nI can help."));
                controller.enqueue(chatDelta('\n{"intent":"generation","deliverables":[]}'));
                controller.close();
            }),
        );

        await expect(
            requestRoutedText({
                ...requestInput(candidate("newapi")),
                onConversationContent: (content) => {
                    visible.push(content);
                },
            }),
        ).rejects.toThrow("结果类型");

        expect(visible).toEqual(["I can help."]);
        expect(visible.join(" ")).not.toMatch(/intent|generation|deliverables|[{}]/);
    });

    it("releases a valid technical answer containing braces after proving it is not a plan", async () => {
        const visible: string[] = [];
        mockedFetch.mockResolvedValue(
            sseResponse((controller) => {
                controller.enqueue(chatDelta('<conversation>\nconst user = {"name":"A"};'));
                controller.close();
            }),
        );

        const result = await requestRoutedText({
            ...requestInput(candidate("newapi")),
            onConversationContent: (content) => {
                visible.push(content);
            },
        });

        expect(result).toMatchObject({ kind: "conversation", content: 'const user = {"name":"A"};' });
        expect(visible.at(-1)).toBe('const user = {"name":"A"};');
    });

    it("forces configured Gemini query parameters to use SSE", async () => {
        mockedFetch.mockResolvedValue(
            sseResponse((controller) => {
                controller.enqueue(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "<conversation>\nHello" }] } }] })}\n\n`);
                controller.close();
            }),
        );

        await requestRoutedText({ ...requestInput(candidate("compatible", { apiFormat: "gemini", createPath: "/models/:model:generateContent?alt=json&key=value" })) });

        const url = new URL(String(mockedFetch.mock.calls[0]?.[0]));
        expect(url.pathname).toContain(":streamGenerateContent");
        expect(url.searchParams.get("alt")).toBe("sse");
        expect(url.searchParams.get("key")).toBe("value");
    });

    it("reports response headers and rejects after preserving content emitted before a stream failure", async () => {
        const visible: string[] = [];
        const responseHeaders: string[] = [];
        const firstBytes: number[] = [];
        let failStream!: () => void;
        mockedFetch.mockResolvedValue(
            new Response(
                new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(chatDelta("<conversation>\nXin chào")));
                        failStream = () => controller.error(new Error("stream failed"));
                    },
                }),
                { headers: { "content-type": "text/event-stream", "x-vozeb-pro-usage-hold-id": "hold-stream" } },
            ),
        );
        const pending = requestRoutedText({
            ...requestInput(candidate("newapi")),
            onResponse: (headers) => {
                responseHeaders.push(headers.get("x-vozeb-pro-usage-hold-id") || "");
            },
            onFirstByte: (elapsedMs) => {
                firstBytes.push(elapsedMs);
            },
            onConversationContent: (content) => {
                visible.push(content);
            },
        });
        const rejected = expect(pending).rejects.toThrow("读取文本流失败");

        await vi.waitFor(() => expect(visible).toEqual(["Xin chào"]));
        failStream();
        await rejected;

        expect(responseHeaders).toEqual(["hold-stream"]);
        expect(firstBytes).toEqual([expect.any(Number)]);
    });

    it("aborts an active conversation stream without marking the provider unhealthy", async () => {
        const configured = candidate("newapi");
        const abort = new AbortController();
        const visible: string[] = [];
        mockedFetch.mockImplementation(async (_url, init) => {
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode(chatDelta("<conversation>\nHello")));
                    init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true });
                },
            });
            return new Response(stream, { headers: { "content-type": "text/event-stream" } });
        });
        const pending = requestRoutedText({
            ...requestInput(configured),
            signal: abort.signal,
            onConversationContent: (content) => {
                visible.push(content);
            },
        });
        const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });

        await vi.waitFor(() => expect(visible).toEqual(["Hello"]));
        abort.abort();
        await rejected;

        expect(getTextPlanningRuntime(configured)).toBeUndefined();
    });

    it("解析 Responses 文本事件并只公开标记后的正文", async () => {
        const visible: string[] = [];
        mockedFetch.mockResolvedValue(
            sseResponse((controller) => {
                controller.enqueue(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "<conversation>\nHello" })}\n\n`);
                controller.enqueue(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: " world" })}\n\n`);
                controller.close();
            }),
        );

        const result = await requestRoutedText({
            ...requestInput(candidate("compatible", { createPath: "/responses" })),
            onConversationContent: (content) => {
                visible.push(content);
            },
        });

        expect(visible).toEqual(["Hello", "Hello world"]);
        expect(result).toMatchObject({ kind: "conversation", content: "Hello world", protocol: "responses" });
        expect(requestBody()).toMatchObject({ model: "model-one", stream: true });
    });

    it("使用 Gemini streamGenerateContent 并解析逐帧文本", async () => {
        const visible: string[] = [];
        mockedFetch.mockResolvedValue(
            sseResponse((controller) => {
                controller.enqueue(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "<conversation>\nXin" }] } }] })}\n\n`);
                controller.enqueue(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: " chào" }] } }] })}\n\n`);
                controller.close();
            }),
        );

        const result = await requestRoutedText({
            ...requestInput(candidate("compatible", { apiFormat: "gemini", createPath: "/models/:model:generateContent" })),
            onConversationContent: (content) => {
                visible.push(content);
            },
        });

        expect(String(mockedFetch.mock.calls[0]?.[0])).toContain("/models/model-one:streamGenerateContent?alt=sse");
        expect(visible).toEqual(["Xin", "Xin chào"]);
        expect(result).toMatchObject({ kind: "conversation", content: "Xin chào", protocol: "gemini" });
    });

    it("giữ custom protocol ở chế độ buffered và vẫn phân loại hội thoại", async () => {
        const visible: string[] = [];
        const configured = candidate("custom", { createPath: "/planner/run", requestTemplate: '{"prompt":"{{prompt}}"}', resultField: "data.plan" });
        mockedFetch.mockResolvedValue(Response.json({ data: { plan: "<conversation>\nXin chào" } }));

        const result = await requestRoutedText({
            ...requestInput(configured),
            onConversationContent: (content) => {
                visible.push(content);
            },
        });

        expect(result).toMatchObject({ kind: "conversation", content: "Xin chào", protocol: "custom" });
        expect(visible).toEqual([]);
        expect(requestBody()).not.toHaveProperty("stream");
    });

    it("records buffered response arrival before body parsing completes", async () => {
        vi.useFakeTimers();
        const response = Response.json({ choices: [{ message: { content: "<conversation>\nHello" } }] });
        vi.spyOn(response, "json").mockImplementation(async () => {
            await new Promise((resolve) => setTimeout(resolve, 250));
            return { choices: [{ message: { content: "<conversation>\nHello" } }] };
        });
        mockedFetch.mockResolvedValue(response);

        const pending = requestRoutedText(requestInput(candidate("globalaiopc", { globalAiOpcPreset: "text-gemini-native" })));
        await vi.advanceTimersByTimeAsync(250);
        const result = await pending;

        expect(result.firstByteMs).toBe(0);
        expect(result.elapsedMs).toBe(250);
    });

    it("成功响应包含无效 JSON 时携带真实响应头调用终止钩子", async () => {
        const terminalHeaders: string[] = [];
        mockedFetch.mockResolvedValue(new Response("{", { status: 200, headers: { "content-type": "application/json", "x-vozeb-pro-usage-hold-id": "hold-invalid-json" } }));

        await expect(
            requestStructuredText({
                ...requestInput(candidate("newapi")),
                onInvalidResponse: async (headers) => {
                    terminalHeaders.push(headers.get("x-vozeb-pro-usage-hold-id") || "");
                },
            }),
        ).rejects.toThrow("无效 JSON");

        expect(terminalHeaders).toEqual(["hold-invalid-json"]);
    });

    it("HTTP 200 供应商业务错误携带真实响应头调用终止钩子", async () => {
        const terminalHeaders: string[] = [];
        const configured = candidate("custom", { createPath: "/planner/run", requestTemplate: '{"prompt":"{{prompt}}"}', resultField: "data.plan" });
        mockedFetch.mockResolvedValue(Response.json({ code: "204", msg: "登录验证失败" }, { headers: { "x-vozeb-pro-usage-hold-id": "hold-business-error" } }));

        await expect(
            requestStructuredText({
                ...requestInput(configured),
                onInvalidResponse: async (headers) => {
                    terminalHeaders.push(headers.get("x-vozeb-pro-usage-hold-id") || "");
                },
            }),
        ).rejects.toThrow("登录验证失败");

        expect(terminalHeaders).toEqual(["hold-business-error"]);
    });

    it("成功响应缺少结构化参数时携带真实响应头调用终止钩子", async () => {
        const terminalHeaders: string[] = [];
        mockedFetch.mockResolvedValue(Response.json({ choices: [{ message: { content: "不是 JSON" } }] }, { headers: { "x-vozeb-pro-usage-hold-id": "hold-missing-arguments" } }));

        await expect(
            requestStructuredText({
                ...requestInput(candidate("newapi")),
                onInvalidResponse: async (headers) => {
                    terminalHeaders.push(headers.get("x-vozeb-pro-usage-hold-id") || "");
                },
            }),
        ).rejects.toThrow("结构化结果");

        expect(terminalHeaders).toEqual(["hold-missing-arguments"]);
    });

    it("只为上游协议作用域追加后缀，不改写服务端计费身份", async () => {
        mockedFetch.mockResolvedValue(chatJsonResponse());

        await requestStructuredText({
            ...requestInput(candidate("newapi")),
            headers: { "x-vozeb-pro-points-idempotency-key": "planning-one", "idempotency-key": "planning-one" },
        });

        const headers = new Headers(mockedFetch.mock.calls[0]?.[1]?.headers);
        expect(headers.get("x-vozeb-pro-points-idempotency-key")).toBe("planning-one");
        expect(headers.get("idempotency-key")).toBe("planning-one:chat-json");
    });

    it("上游返回 422 时不会在同一候选内自动重复请求", async () => {
        mockedFetch.mockResolvedValueOnce(new Response("/backend-api/conversation failed: status=422, body=", { status: 422 }));

        await expect(requestStructuredText(requestInput(candidate("newapi")))).rejects.toMatchObject({ status: 422, requestAcceptance: "response" });
        expect(mockedFetch).toHaveBeenCalledTimes(1);
    });

    it("同一渠道不同模型的协议预设互不污染", async () => {
        const channel = candidate("compatible", {
            modelConfigs: {
                "model-one": { capability: "text", protocol: "compatible", createPath: "/responses" },
                "model-two": { capability: "text", protocol: "compatible", createPath: "/chat/completions" },
            },
        }).channel;
        mockedFetch.mockResolvedValueOnce(Response.json({ output_text: "{}" })).mockResolvedValueOnce(chatJsonResponse());

        const first = await requestStructuredText(requestInput({ channelId: channel.id, upstreamModel: "model-one", channel }));
        const second = await requestStructuredText(requestInput({ channelId: channel.id, upstreamModel: "model-two", channel }));

        expect([first.protocol, second.protocol]).toEqual(["responses", "chat"]);
        expect(mockedFetch.mock.calls.map(([url]) => String(url))).toEqual([expect.stringContaining("/responses"), expect.stringContaining("/chat/completions")]);
    });

    it("优先排列近期成功且延迟更低的候选", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
        const slow = candidate("newapi", { id: "slow" });
        const fast = candidate("newapi", { id: "fast" });
        mockedFetch.mockImplementationOnce(async () => {
            vi.advanceTimersByTime(900);
            return chatJsonResponse();
        });
        await requestStructuredText(requestInput(slow));
        mockedFetch.mockImplementationOnce(async () => {
            vi.advanceTimersByTime(80);
            return chatJsonResponse();
        });
        await requestStructuredText(requestInput(fast));

        expect(rankTextPlanningCandidates([slow, fast])).toEqual([fast, slow]);
    });

    it("失败候选进入短期冷却并排在健康候选之后", async () => {
        const failed = candidate("newapi", { id: "failed" });
        const healthy = candidate("newapi", { id: "healthy" });
        mockedFetch.mockRejectedValueOnce(new Error("connection refused"));
        await expect(requestStructuredText(requestInput(failed))).rejects.toThrow("暂时无法连接");
        mockedFetch.mockResolvedValueOnce(chatJsonResponse());
        await requestStructuredText(requestInput(healthy));

        expect(rankTextPlanningCandidates([failed, healthy])).toEqual([healthy, failed]);
        expect(getTextPlanningRuntime(failed)?.cooldownUntil).toBeGreaterThan(Date.now());
    });

    it("不会把 HTML 网关错误原文返回给用户", async () => {
        mockedFetch.mockResolvedValue(new Response("<!doctype html><title>Bad gateway</title><body>nginx secret trace</body>", { status: 502 }));

        await expect(requestStructuredText(requestInput(candidate("newapi")))).rejects.toThrow("文本模型渠道暂不可用（HTTP 502）");
    });

    it("把超时转换为可读且可切换渠道的错误", async () => {
        mockedFetch.mockRejectedValue(Object.assign(new Error("timed out"), { name: "TimeoutError" }));

        await expect(requestStructuredText(requestInput(candidate("newapi")))).rejects.toMatchObject({ message: "文本模型规划响应超时", requestAcceptance: "unknown" });
    });

    it("文本规划使用默认三分钟或绑定配置的整体超时", async () => {
        const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
        mockedFetch.mockResolvedValueOnce(chatJsonResponse()).mockResolvedValueOnce(chatJsonResponse());

        await requestStructuredText(requestInput(candidate("newapi")));
        await requestStructuredText(requestInput({ ...candidate("newapi", { id: "long-reasoning" }), capabilityProfile: { timeoutMs: 8 * 60_000 } }));

        expect(timeoutSpy).toHaveBeenNthCalledWith(1, 3 * 60_000);
        expect(timeoutSpy).toHaveBeenNthCalledWith(2, 8 * 60_000);
    });
});

function requestInput(configured: TextPlanningCandidate) {
    return {
        origin: "http://127.0.0.1:3000",
        cookie: "session=test",
        candidate: configured,
        messages: [{ role: "user", content: "test" }],
        tool,
    };
}

function candidate(protocol: NonNullable<SystemChannelAdvancedConfig>["protocol"], options: Partial<SystemChannelAdvancedConfig> & { id?: string; apiFormat?: "openai" | "gemini" } = {}): TextPlanningCandidate {
    const id = options.id || `${protocol}-channel`;
    const advancedConfig = {
        protocol,
        textModel: "model-one",
        imageModel: "",
        videoModel: "",
        createPath: "",
        queryPath: "",
        requestTemplate: "",
        resultField: "",
        statusField: "",
        durationRange: "",
        referenceRule: "",
        supportsReferenceImage: false,
        supportsReferenceVideo: false,
        supportsReferenceAudio: false,
        ...options,
    } satisfies SystemChannelAdvancedConfig;
    const channel = {
        id,
        name: id,
        baseUrl: "https://example.com/v1",
        apiKey: "secret",
        apiFormat: options.apiFormat || "openai",
        models: ["model-one", "model-two"],
        enabled: true,
        advancedConfig,
    } satisfies SystemModelChannel;
    return { channelId: id, upstreamModel: "model-one", channel };
}

function requestBody() {
    return JSON.parse(String(mockedFetch.mock.calls.at(-1)?.[1]?.body)) as Record<string, unknown>;
}

function expectBasicJsonMessages(body: Record<string, unknown>) {
    expect(body).toMatchObject({ model: "model-one", messages: expect.arrayContaining([{ role: "user", content: "test" }]) });
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).not.toHaveProperty("max_completion_tokens");
}

function chatJsonResponse() {
    return Response.json({ choices: [{ message: { content: "{}" } }] });
}

function sseResponse(start: (controller: ReadableStreamDefaultController<string>) => void) {
    const source = new ReadableStream<string>({
        start(controller) {
            start({
                enqueue: controller.enqueue.bind(controller),
                close: () => {
                    controller.enqueue("data: [DONE]\n\n");
                    controller.close();
                },
                error: controller.error.bind(controller),
                desiredSize: controller.desiredSize,
            } as ReadableStreamDefaultController<string>);
        },
    });
    return new Response(source.pipeThrough(new TextEncoderStream()), { headers: { "content-type": "text/event-stream" } });
}

function chatDelta(content: string) {
    return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}
