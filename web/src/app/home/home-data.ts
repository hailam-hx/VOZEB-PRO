import type { SiteFriendLink, SiteSocialSettings } from "@/lib/auth/store-types";
import type { CreateAgentMode } from "@/lib/create-agent-prompt";
import { WORK_CATEGORIES } from "@/lib/work-publication-options";
import { workCategoryMessageKeys } from "@/i18n/display-keys";
import type { PublicGalleryItem } from "@/services/api/work-governance";

export type HomeSiteSettings = {
    title: string;
    logoUrl: string;
    seoDescription: string;
    footerCopyright: string;
    termsUrl: string;
    privacyUrl: string;
    friendLinks: SiteFriendLink[];
    socials: SiteSocialSettings;
};

export type HomeNavigationItem = {
    translationKey: "createAgent" | "shortDrama" | "gallery" | "pricing" | "announcementCenter";
    href: string;
    action: "link" | "protected" | "billing";
};

export const HOME_NAVIGATION = [
    { translationKey: "createAgent", href: "/create", action: "protected" },
    { translationKey: "shortDrama", href: "/drama", action: "protected" },
    { translationKey: "gallery", href: "/gallery", action: "link" },
    { translationKey: "pricing", href: "/billing", action: "billing" },
] as const satisfies readonly HomeNavigationItem[];

export const HOME_CREATION_MODES = [
    {
        id: "agent",
        labelKey: "modeAgent",
        icon: "agent",
        exampleKeys: ["exampleAgent1", "exampleAgent2", "exampleAgent3", "exampleAgent4"],
    },
    {
        id: "image",
        labelKey: "modeImage",
        icon: "image",
        exampleKeys: ["exampleImage1", "exampleImage2", "exampleImage3", "exampleImage4"],
    },
    {
        id: "video",
        labelKey: "modeVideo",
        icon: "video",
        exampleKeys: ["exampleVideo1", "exampleVideo2", "exampleVideo3", "exampleVideo4"],
    },
    {
        id: "audio",
        labelKey: "modeAudio",
        icon: "audio",
        exampleKeys: ["exampleAudio1", "exampleAudio2", "exampleAudio3", "exampleAudio4"],
    },
] as const;

export type HomeCreationMode = CreateAgentMode;

export const HOME_STEPS = [
    { number: "01", titleKey: "stepChooseTitle", descriptionKey: "stepChooseDescription", icon: "grid" },
    { number: "02", titleKey: "stepInputTitle", descriptionKey: "stepInputDescription", icon: "edit" },
    { number: "03", titleKey: "stepGenerateTitle", descriptionKey: "stepGenerateDescription", icon: "rocket" },
    { number: "04", titleKey: "stepPublishTitle", descriptionKey: "stepPublishDescription", icon: "share" },
] as const;

export const HOME_ADVANTAGES = [
    { titleKey: "advantageTemplatesTitle", descriptionKey: "advantageTemplatesDescription", icon: "layers" },
    { titleKey: "advantageModelsTitle", descriptionKey: "advantageModelsDescription", icon: "network" },
    { titleKey: "advantageTasksTitle", descriptionKey: "advantageTasksDescription", icon: "history" },
    { titleKey: "advantageStorageTitle", descriptionKey: "advantageStorageDescription", icon: "cloud" },
] as const;

export const HOME_GALLERY_TABS = [{ id: "all", labelKey: "categoryAll" }, ...WORK_CATEGORIES.map((category) => ({ id: category, labelKey: workCategoryMessageKeys[category] }))] as const;

export type HomeGalleryTab = "all" | (typeof WORK_CATEGORIES)[number];

export function homeGalleryMatches(item: PublicGalleryItem, tab: HomeGalleryTab) {
    const mediaType = item.preview?.mediaType;
    if (mediaType !== "image" && mediaType !== "video") return false;
    return tab === "all" || item.category === tab;
}
