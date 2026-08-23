import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

import type { AppLocale } from "@/i18n/config";
import { loadMessages } from "@/i18n/messages";

export function renderWithI18n(element: ReactElement, locale: AppLocale = "zh-CN") {
    return renderToStaticMarkup(
        <NextIntlClientProvider locale={locale} messages={loadMessages(locale)} timeZone="UTC">
            {element}
        </NextIntlClientProvider>,
    );
}
