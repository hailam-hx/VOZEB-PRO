"use client";

import { createContext, useContext, useLayoutEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import type { AppLocale } from "./config";

type LocaleMessages = { locale: AppLocale; messages: AbstractIntlMessages };
type ProviderProps = LocaleMessages & { children: ReactNode };
const LocaleSyncContext = createContext<Dispatch<SetStateAction<LocaleMessages>> | null>(null);

export function LocaleProvider({ locale, messages, timeZone, children }: ProviderProps & { timeZone: string }) {
    const [server, setServer] = useState({ locale, messages });
    const [selected, setSelected] = useState(server);
    // A private-route refresh supplies new server messages without remounting its children.
    if (server.locale !== locale || server.messages !== messages) {
        const next = { locale, messages };
        setServer(next);
        setSelected(next);
    }
    return (
        <LocaleSyncContext.Provider value={setSelected}>
            <NextIntlClientProvider locale={selected.locale} messages={selected.messages} timeZone={timeZone}>
                {children}
            </NextIntlClientProvider>
        </LocaleSyncContext.Provider>
    );
}

export function SeoLocaleProvider({ locale, messages, children }: ProviderProps) {
    const sync = useContext(LocaleSyncContext);
    // Persist URL-selected messages above the route boundary before links can leave it.
    useLayoutEffect(() => {
        sync?.({ locale, messages });
    }, [sync, locale, messages]);
    return (
        <NextIntlClientProvider locale={locale} messages={messages}>
            {children}
        </NextIntlClientProvider>
    );
}
