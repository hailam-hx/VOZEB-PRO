import type { AppLocale } from "@/i18n/config";
import { isSeoPagePublished } from "@/i18n/routing";
import vi from "./content/vi";
import en from "./content/en";
import zhCN from "./content/zh-CN";
import type { CreateAgentMode } from "@/lib/create-agent-prompt";

export const SEO_LANDING_SLUGS = ["ai-image-generator", "ai-video-generator", "ai-voice-generator", "voice-cloning", "ai-short-drama", "ai-agent"] as const;

export type SeoLandingSlug = (typeof SEO_LANDING_SLUGS)[number];

export type SeoLandingCta = { kind: "create"; mode: CreateAgentMode; label: string } | { kind: "workspace"; href: "/voices" | "/drama"; label: string };

type SeoLandingCard = {
    title: string;
    description: string;
};

type SeoLandingFaq = {
    question: string;
    answer: string;
};

type SeoLandingVisual = {
    src: string;
    alt: string;
    width: number;
    height: number;
};

type SeoLandingPrompt = {
    label: string;
    placeholder: string;
    examples: string[];
};

export type SeoLandingDefinition = {
    slug: SeoLandingSlug;
    eyebrow: string;
    primaryKeyword: string;
    secondaryKeywords: string[];
    title: string;
    h1: string;
    description: string;
    heroNote: string;
    showcaseTitle: string;
    showcaseDescription: string;
    useCasesTitle: string;
    useCasesDescription: string;
    useCases: SeoLandingCard[];
    stepsTitle: string;
    stepsDescription: string;
    steps: SeoLandingCard[];
    capabilitiesTitle: string;
    capabilitiesDescription: string;
    capabilities: SeoLandingCard[];
    faqs: SeoLandingFaq[];
    visual: SeoLandingVisual;
    prompt?: SeoLandingPrompt;
    cta: SeoLandingCta;
    finalCtaTitle: string;
    finalCtaDescription: string;
    related: SeoLandingSlug[];
};

export type SeoLandingContentDefinition = Omit<SeoLandingDefinition, "slug" | "visual" | "cta" | "related"> & { visualAlt: string; ctaLabel: string };
export const SEO_LANDING_MANIFEST = {
    "ai-image-generator": {
        slug: "ai-image-generator",
        visual: {
            src: "/seo/hotx-create-workspace.webp",
            width: 1440,
            height: 900,
        },
        cta: {
            kind: "create",
            mode: "image",
        },
        related: ["ai-video-generator", "ai-agent", "ai-voice-generator"],
    },
    "ai-video-generator": {
        slug: "ai-video-generator",
        visual: {
            src: "/seo/hotx-create-workspace.webp",
            width: 1440,
            height: 900,
        },
        cta: {
            kind: "create",
            mode: "video",
        },
        related: ["ai-image-generator", "ai-short-drama", "ai-agent"],
    },
    "ai-voice-generator": {
        slug: "ai-voice-generator",
        visual: {
            src: "/seo/hotx-create-workspace.webp",
            width: 1440,
            height: 900,
        },
        cta: {
            kind: "create",
            mode: "audio",
        },
        related: ["voice-cloning", "ai-video-generator", "ai-agent"],
    },
    "voice-cloning": {
        slug: "voice-cloning",
        visual: {
            src: "/seo/hotx-voice-workspace.webp",
            width: 1280,
            height: 720,
        },
        cta: {
            kind: "workspace",
            href: "/voices",
        },
        related: ["ai-voice-generator", "ai-agent", "ai-video-generator"],
    },
    "ai-short-drama": {
        slug: "ai-short-drama",
        visual: {
            src: "/seo/hotx-drama-workspace.webp",
            width: 1440,
            height: 900,
        },
        cta: {
            kind: "workspace",
            href: "/drama",
        },
        related: ["ai-video-generator", "ai-image-generator", "ai-agent"],
    },
    "ai-agent": {
        slug: "ai-agent",
        visual: {
            src: "/seo/hotx-create-workspace.webp",
            width: 1440,
            height: 900,
        },
        cta: {
            kind: "create",
            mode: "agent",
        },
        related: ["ai-image-generator", "ai-video-generator", "ai-voice-generator"],
    },
} as const;
const content = { vi, en, "zh-CN": zhCN } satisfies Record<AppLocale, Record<SeoLandingSlug, SeoLandingContentDefinition>>;
export function isSeoLandingSlug(value: string): value is SeoLandingSlug {
    return (SEO_LANDING_SLUGS as readonly string[]).includes(value);
}
export function getSeoLandingDefinition(value: string, locale: AppLocale = "vi"): SeoLandingDefinition | undefined {
    if (!isSeoLandingSlug(value) || !isSeoPagePublished(value, locale)) return undefined;
    const manifest = SEO_LANDING_MANIFEST[value];
    const { visualAlt, ctaLabel, ...copy } = content[locale][value];
    return { ...manifest, ...copy, visual: { ...manifest.visual, alt: visualAlt }, cta: { ...manifest.cta, label: ctaLabel }, related: [...manifest.related] };
}
export const SEO_LANDING_DEFINITIONS = Object.fromEntries(SEO_LANDING_SLUGS.map((slug) => [slug, getSeoLandingDefinition(slug)!])) as Record<SeoLandingSlug, SeoLandingDefinition>;
