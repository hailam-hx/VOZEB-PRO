import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";

import { loadMessages } from "@/i18n/messages";

export default function AdminLayout({ children }: { children: ReactNode }) {
    return (
        <NextIntlClientProvider locale="zh-CN" messages={loadMessages("zh-CN")} timeZone="UTC">
            {children}
        </NextIntlClientProvider>
    );
}
