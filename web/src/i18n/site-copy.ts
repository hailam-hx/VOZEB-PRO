import type { LocalizedSeoSettings } from "@/lib/auth/store-types";

export const DEFAULT_LOCALIZED_SEO: LocalizedSeoSettings = {
    vi: {
        title: "VOZEB PRO - Nền tảng tạo ảnh, video và giọng nói bằng AI",
        description: "VOZEB PRO là nền tảng sáng tạo AI giúp bạn tạo ảnh, video, giọng nói, nhân bản giọng nói và sử dụng AI Agent trong một quy trình thống nhất.",
        keywords: "VOZEB PRO,AI Agent,hình ảnh AI,video AI,Canvas,phim ngắn,thư viện prompt,quản lý tài nguyên",
    },
    en: {
        title: "VOZEB PRO - AI image, video and voice creation",
        description: "VOZEB PRO is a unified AI creation platform for images, video, voice, voice cloning, and AI Agent workflows.",
        keywords: "VOZEB PRO,AI Agent,AI image,AI video,Canvas,short drama,prompt library,asset management",
    },
    "zh-CN": {
        title: "VOZEB PRO - AI 图片、视频与语音创作",
        description: "VOZEB PRO 是统一的 AI 创作平台，支持图片、视频、语音、声音克隆与 AI Agent 工作流。",
        keywords: "VOZEB PRO,AI Agent,AI 绘图,AI 视频,画布,短剧,提示词库,素材管理",
    },
};

export const builtInSiteCopy = {
    emailLabel: "邮箱联系",
    qqGroupLabel: "VOZEB 开源交流 QQ 群",
} as const;

export function localizeBuiltInSiteCopy(value: string, builtInValue: string, localizedValue: string) {
    const normalized = value.trim();
    return normalized === builtInValue ? localizedValue : normalized;
}
