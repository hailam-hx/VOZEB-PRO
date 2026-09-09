import { notFound } from "next/navigation";
import { isAppLocale } from "./config";
import { isSeoPagePublished, type SeoPageId } from "./routing";

export type LocalizedPageProps = { params: Promise<{ locale: string }> };

export function requireSeoPageLocale(pageId: SeoPageId, locale: string) {
    if (!isAppLocale(locale) || !isSeoPagePublished(pageId, locale)) notFound();
    return locale;
}
