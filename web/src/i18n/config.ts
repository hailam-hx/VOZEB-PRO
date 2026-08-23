import { match } from "@formatjs/intl-localematcher";
import Negotiator from "negotiator";

export const appLocales = ["vi", "en", "zh-CN"] as const;

export type AppLocale = (typeof appLocales)[number];

export const defaultLocale: AppLocale = "vi";
export const localeCookieName = "vozeb-pro-locale";

export const localeMetadata = {
    vi: { htmlLang: "vi", openGraphLocale: "vi_VN", antLocale: "vi_VN", dayjsLocale: "vi", label: "Tiếng Việt" },
    en: { htmlLang: "en", openGraphLocale: "en_US", antLocale: "en_US", dayjsLocale: "en", label: "English" },
    "zh-CN": { htmlLang: "zh-CN", openGraphLocale: "zh_CN", antLocale: "zh_CN", dayjsLocale: "zh-cn", label: "简体中文" },
} as const satisfies Record<
    AppLocale,
    {
        htmlLang: string;
        openGraphLocale: string;
        antLocale: string;
        dayjsLocale: string;
        label: string;
    }
>;

export function isAppLocale(value: unknown): value is AppLocale {
    return appLocales.includes(value as AppLocale);
}

export function isChineseOnlyPath(pathname: string): boolean {
    return ["/admin", "/install"].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function normalizeBrowserLocale(locale: string): string {
    const language = locale.toLowerCase().split("-")[0];
    if (language === "zh") return "zh-CN";
    if (language === "en") return "en";
    if (language === "vi") return "vi";
    return locale;
}

function isWellFormedLocale(locale: string) {
    if (locale === "*") return false;
    try {
        return Intl.getCanonicalLocales(locale).length > 0;
    } catch {
        return false;
    }
}

export function resolveLocale({
    cookieLocale,
    acceptLanguage,
}: {
    cookieLocale?: string | null;
    acceptLanguage?: string | null;
} = {}): AppLocale {
    if (isAppLocale(cookieLocale)) return cookieLocale;

    const requested = new Negotiator({ headers: { "accept-language": acceptLanguage || "" } }).languages().map(normalizeBrowserLocale).filter(isWellFormedLocale);
    try {
        return match(requested, appLocales, defaultLocale) as AppLocale;
    } catch {
        return defaultLocale;
    }
}
