export const builtInSiteCopy = {
    seoDescription: "面向 Agent、图片、视频、画布与短剧生产的一体化 AI 创作工作台",
    seoKeywords: "VOZEB PRO,AI Agent,AI 绘图,AI 视频,画布,短剧,提示词库,素材管理",
    emailLabel: "邮箱联系",
    qqGroupLabel: "VOZEB 开源交流 QQ 群",
} as const;

const previousHomepageSeoDescriptions = ["HOTX AI là nền tảng sáng tạo nội dung bằng AI, hỗ trợ tạo ảnh, tạo video, giọng nói AI, nhân bản giọng nói, AI Agent, video ngắn và canvas sáng tạo trong một nền tảng duy nhất."] as const;

export function localizeBuiltInSiteCopy(value: string, builtInValue: string, localizedValue: string) {
    const normalized = value.trim();
    return normalized === builtInValue ? localizedValue : normalized;
}

export function localizeHomepageSeoDescription(value: string, localizedValue: string) {
    const normalized = value.trim();
    return normalized === builtInSiteCopy.seoDescription || previousHomepageSeoDescriptions.includes(normalized as (typeof previousHomepageSeoDescriptions)[number]) ? localizedValue : normalized;
}
