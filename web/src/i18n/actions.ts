"use server";

import { cookies } from "next/headers";

import { isAppLocale, localeCookieConfig, type AppLocale } from "@/i18n/config";

export async function setLocalePreference(locale: AppLocale) {
    if (!isAppLocale(locale)) throw new Error("Unsupported locale");

    const cookieStore = await cookies();
    const { name, ...options } = localeCookieConfig;
    cookieStore.set(name, locale, options);
}
