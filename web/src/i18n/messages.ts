import type { AbstractIntlMessages } from "next-intl";

import type { AppLocale } from "@/i18n/config";
import en from "@/i18n/messages/en.json";
import vi from "@/i18n/messages/vi.json";
import zhCN from "@/i18n/messages/zh-CN.json";

const catalogs = { vi, en, "zh-CN": zhCN } as const;

function mergeMessages(fallback: AbstractIntlMessages, messages: AbstractIntlMessages): AbstractIntlMessages {
    return Object.fromEntries(
        Object.entries(fallback).map(([key, fallbackValue]) => {
            const value = messages[key];
            if (typeof fallbackValue === "object" && fallbackValue && typeof value === "object" && value) {
                return [key, mergeMessages(fallbackValue, value)];
            }
            return [key, value ?? fallbackValue];
        }),
    );
}

export function loadMessages(locale: AppLocale): AbstractIntlMessages {
    const messages = catalogs[locale];
    for (const namespace of ["home", "public"] as const) assertCompleteCatalog(vi[namespace], messages[namespace], namespace);
    return locale === "vi" ? vi : mergeMessages(vi, messages);
}

function assertCompleteCatalog(reference: AbstractIntlMessages, messages: AbstractIntlMessages, path: string) {
    for (const [key, value] of Object.entries(reference)) {
        const translated = messages?.[key];
        const keyPath = `${path}.${key}`;
        if (typeof value === "object") {
            if (!translated || typeof translated !== "object") throw new Error(`Missing published translation: ${keyPath}`);
            assertCompleteCatalog(value, translated, keyPath);
        } else if (typeof translated !== "string" || !translated.trim()) throw new Error(`Missing published translation: ${keyPath}`);
    }
}
