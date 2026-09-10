import type { LocalizedSeoSettings } from "@/lib/auth/store-types";

export const EMPTY_LOCALIZED_SEO: LocalizedSeoSettings = {
    vi: { title: "", description: "", keywords: "" },
    en: { title: "", description: "", keywords: "" },
    "zh-CN": { title: "", description: "", keywords: "" },
};

export const builtInSiteCopy = {
    emailLabel: "邮箱联系",
    qqGroupLabel: "VOZEB 开源交流 QQ 群",
} as const;

export function localizeBuiltInSiteCopy(value: string, builtInValue: string, localizedValue: string) {
    const normalized = value.trim();
    return normalized === builtInValue ? localizedValue : normalized;
}
