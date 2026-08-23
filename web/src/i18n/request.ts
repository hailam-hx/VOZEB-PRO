import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { localeCookieName, resolveLocale } from "@/i18n/config";
import { loadMessages } from "@/i18n/messages";

export default getRequestConfig(async () => {
    const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
    const locale = resolveLocale({
        cookieLocale: cookieStore.get(localeCookieName)?.value,
        acceptLanguage: requestHeaders.get("accept-language"),
    });

    return { locale, messages: loadMessages(locale), timeZone: "UTC" };
});
