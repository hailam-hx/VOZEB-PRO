import { AudioLines, BookMarked, Clapperboard, Compass, FileText, GalleryVerticalEnd, Images, Maximize2, Sparkles, UserRound } from "lucide-react";

export const navigationGroups = [
    { id: "create", label: "创作", labelKey: "groupCreate" },
    { id: "projects", label: "项目", labelKey: "groupProjects" },
    { id: "assets", label: "资产", labelKey: "groupAssets" },
    { id: "community", label: "社区", labelKey: "groupCommunity" },
] as const;

export const landingNavigationTools = [
    { slug: "create", label: "Agent" },
    { slug: "drama", label: "短剧" },
    { slug: "gallery", label: "广场" },
] as const;

export const navigationTools = [
    {
        slug: "create",
        label: "Agent",
        labelKey: "agent",
        description: "统一创作入口",
        descriptionKey: "agentDescription",
        group: "create",
        icon: Sparkles,
        primary: true,
    },
    {
        slug: "canvas",
        label: "画布",
        labelKey: "canvas",
        description: "节点式多媒体创作",
        descriptionKey: "canvasDescription",
        group: "projects",
        icon: Maximize2,
    },
    {
        slug: "drama",
        label: "短剧",
        labelKey: "drama",
        description: "剧本、分镜与成片",
        descriptionKey: "dramaDescription",
        group: "projects",
        icon: Clapperboard,
    },
    {
        slug: "works",
        label: "作品",
        labelKey: "works",
        description: "发布、审核与分享",
        descriptionKey: "worksDescription",
        group: "assets",
        icon: GalleryVerticalEnd,
    },
    {
        slug: "assets",
        label: "素材",
        labelKey: "assets",
        description: "图片、视频与音频",
        descriptionKey: "assetsDescription",
        group: "assets",
        icon: Images,
    },
    {
        slug: "voices",
        label: "声音",
        labelKey: "voices",
        description: "克隆与管理我的声音",
        descriptionKey: "voicesDescription",
        group: "assets",
        icon: AudioLines,
    },
    {
        slug: "my-prompts",
        label: "提示词",
        labelKey: "myPrompts",
        description: "个人提示词",
        descriptionKey: "myPromptsDescription",
        group: "assets",
        icon: BookMarked,
    },
    {
        slug: "prompts",
        label: "词库",
        labelKey: "promptLibrary",
        description: "公共提示词",
        descriptionKey: "promptLibraryDescription",
        group: "assets",
        icon: FileText,
    },
    {
        slug: "community",
        label: "广场",
        labelKey: "community",
        description: "发现公开作品",
        descriptionKey: "communityDescription",
        group: "community",
        icon: Compass,
    },
    {
        slug: "me",
        label: "主页",
        labelKey: "myPage",
        description: "已发布与我的喜欢",
        descriptionKey: "myPageDescription",
        group: "community",
        icon: UserRound,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
export type NavigationGroupId = (typeof navigationGroups)[number]["id"];

export function navigationToolForPathname(pathname: string) {
    const slug = pathname.split("/").filter(Boolean)[0];
    return navigationTools.find((tool) => tool.slug === slug);
}
