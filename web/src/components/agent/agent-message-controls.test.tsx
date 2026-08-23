import { renderToStaticMarkup } from "react-dom/server";
import { App } from "antd";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "@/test/render-with-i18n";
import zhCN from "@/i18n/messages/zh-CN.json";

import { agentMediaDownloadName } from "./agent-media-download";
import { formatAgentArtifactText, formatAgentMessageText, type AgentMessageTranslator } from "./agent-message-format";
import { agentMediaPreviewPopupStyles, AgentMediaPreview } from "./agent-media-preview";
import { AgentMessageActions } from "./agent-message-actions";

const zhAgentMessage = (key: Parameters<AgentMessageTranslator>[0]) => zhCN.common.agentErrors[key];
const formatMessage = (text: string) => formatAgentMessageText(text, zhAgentMessage);

describe("agent message controls", () => {
    it("shows copy for every message and edit only for user messages", () => {
        const userActions = renderWithI18n(
            <App>
                <AgentMessageActions text="生成一张海报" onEdit={vi.fn()} />
            </App>,
        );
        const assistantActions = renderWithI18n(
            <App>
                <AgentMessageActions text="海报已经生成" downloads={[{ type: "image", url: "/generated/image.png", title: "生成图片" }]} />
            </App>,
        );

        expect(userActions).toContain('aria-label="复制消息"');
        expect(userActions).toContain('aria-label="编辑消息"');
        expect(assistantActions).toContain('aria-label="复制消息"');
        expect(assistantActions).toContain('aria-label="下载图片"');
        expect(assistantActions).not.toContain('aria-label="编辑消息"');
    });

    it("renders clickable image and video preview entries", () => {
        const onDimensions = vi.fn();
        const image = renderWithI18n(
            <App>
                <AgentMediaPreview type="image" url="/generated/image.png" title="生成图片" fit="contain" onDimensions={onDimensions} />
            </App>,
            "en",
        );
        const video = renderWithI18n(
            <App>
                <AgentMediaPreview type="video" url="/generated/video.mp4" title="生成视频" fit="contain" />
            </App>,
            "en",
        );

        expect(image).toContain("View full-size image");
        expect(image).toContain('src="/generated/image.png"');
        expect(image).toContain("object-contain");
        expect(image).toContain("!size-full object-contain");
        expect(image).not.toContain("object-cover");
        expect(agentMediaPreviewPopupStyles.popup.root).toMatchObject({ position: "fixed", inset: 0, width: "100vw", height: "100dvh" });
        expect(agentMediaPreviewPopupStyles.popup.mask).toMatchObject({ position: "fixed", inset: 0 });
        expect(agentMediaPreviewPopupStyles.popup.body).toMatchObject({ position: "fixed", inset: 0, alignItems: "center", justifyContent: "center" });
        expect(image).not.toContain("rootClassName");
        expect(video).toContain('aria-label="Open video: 生成视频"');
        expect(video).toContain('src="/generated/video.mp4"');
        expect(video).toContain("object-contain");
        expect(video).not.toContain("object-cover");
    });

    it("builds safe download names and hides upstream JSON errors", () => {
        const imageName = agentMediaDownloadName("image", "小狗/竖版", "/generated/image.webp?token=1");
        const videoName = agentMediaDownloadName("video", "短片.mp4", "/generated/video.mp4");
        expect(imageName).toMatch(/^\d{8}-\d{6}-[a-f0-9]{8}\.png$/);
        expect(videoName).toMatch(/^\d{8}-\d{6}-[a-f0-9]{8}\.mp4$/);
        expect(agentMediaDownloadName("video", "短片", "/api/reference-assets/video.mp4", "video/quicktime")).toMatch(/^\d{8}-\d{6}-[a-f0-9]{8}\.mov$/);
        expect(agentMediaDownloadName("image", "海报.webp", "/api/reference-assets/image.webp", "image/png")).toMatch(/^\d{8}-\d{6}-[a-f0-9]{8}\.png$/);
        expect(imageName).not.toBe(videoName);
        expect(formatMessage('{"error":{"message":"/backend-anon/conversation failed: status=403"}}')).toBe("当前渠道鉴权失败，请管理员检查 API Key 和模型权限。");
        expect(formatMessage('{"error":{"message":"/backend-api/conversation failed: status=422, body="}}')).toBe("当前请求参数不被模型支持，请检查模型与生成参数。");
        expect(formatMessage('{"error":"当前渠道无法读取站内参考素材，请联系管理员检查站点部署地址"}')).toBe("当前渠道无法使用这些参考素材，请切换模型或联系管理员。");
        expect(formatMessage('{"code":400,"data":null,"msg":"积分不足，无法生成"}')).toBe("积分不足");
        expect(formatMessage('{"error":"request timeout"}')).toBe("模型响应超时，请稍后重试。");
        expect(formatMessage('{"error":"fetch failed: ECONNRESET"}')).toBe("模型服务连接失败，请稍后重试。");
        expect(formatMessage('{"error":"status=429"}')).toBe("请求过于频繁，请稍后重试。");
        expect(formatMessage('{"error":"seedance-reference-duration-out-of-range:1"}')).toBe("当前请求参数不被模型支持，请检查模型与生成参数。");
    });

    it("keeps generated text while removing upstream display directives", () => {
        expect(formatMessage("是的，我在呢！上一轮生成渠道暂时无法连接，现在可以重新生成。")).toBe("是的，我在呢！上一轮生成渠道暂时无法连接，现在可以重新生成。");
        expect(formatMessage('已完成 1 个创作任务。\n\n「狗提示词」已完成：\n:::writing{variant="document" id="58391"}\n一只温暖友善的狗，真实毛发，柔和自然光。\n:::\n可继续调整。')).toBe(
            "已完成 1 个创作任务。\n\n「狗提示词」已完成：\n\n一只温暖友善的狗，真实毛发，柔和自然光。\n\n可继续调整。",
        );
        expect(formatAgentArtifactText(':::writing{variant="document" id="58391" title="《潮汐写给远方的信》"}\n# 潮汐写给远方的信\n\n等你回来。:::')).toBe("# 潮汐写给远方的信\n\n等你回来。");
    });
});
