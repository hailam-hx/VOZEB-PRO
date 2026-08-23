import type { AppLocale } from "@/i18n/config";

export function formatCreativeMessageTime(value: number, locale: AppLocale = "zh-CN") {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    const now = new Date();
    if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) {
        const today = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(0, "day");
        const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
        return `${today} ${time}`;
    }
    return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
