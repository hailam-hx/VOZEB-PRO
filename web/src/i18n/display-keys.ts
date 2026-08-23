import type { WORK_CATEGORIES } from "@/lib/work-publication-options";

export const workCategoryMessageKeys = {
    视觉设计: "categoryVisualDesign",
    插画: "categoryIllustration",
    摄影: "categoryPhotography",
    品牌内容: "categoryBrandContent",
    视频: "categoryVideo",
    短剧: "categoryDrama",
    其他: "categoryOther",
} as const satisfies Record<(typeof WORK_CATEGORIES)[number], string>;
