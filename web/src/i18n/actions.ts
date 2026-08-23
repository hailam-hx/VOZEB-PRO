"use server";

import { cookies } from "next/headers";

import { isAppLocale, localeCookieName, type AppLocale } from "@/i18n/config";

const localeCookieMaxAge = 365 * 24 * 60 * 60;

export async function setLocalePreference(locale: AppLocale) {
    if (!isAppLocale(locale)) throw new Error("Unsupported locale");

    const cookieStore = await cookies();
    cookieStore.set(localeCookieName, locale, {
        path: "/",
        sameSite: "lax",
        maxAge: localeCookieMaxAge,
        secure: process.env.NODE_ENV === "production",
    });
}
