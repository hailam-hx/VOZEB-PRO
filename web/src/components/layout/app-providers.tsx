"use client";

import type { ReactNode } from "react";
import { useEffect, useLayoutEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import dayjs from "dayjs";
import { useLocale } from "next-intl";
import { usePathname } from "next/navigation";
import "dayjs/locale/en";
import "dayjs/locale/vi";
import "dayjs/locale/zh-cn";

import { ClientRootInit } from "@/components/layout/client-root-init";
import { defaultLocale, isAppLocale } from "@/i18n/config";
import { antLocales, effectiveLocale, localeMetadata } from "@/i18n/runtime";
import { getAntThemeConfig } from "@/lib/app-theme";
import { useThemeStore } from "@/stores/use-theme-store";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 5 * 60_000,
            gcTime: 15 * 60_000,
            retry: false,
            refetchOnWindowFocus: false,
        },
    },
});

export function AppProviders({ children }: { children: ReactNode }) {
    const requestedLocale = useLocale();
    const pathname = usePathname();
    const theme = useThemeStore((state) => state.theme);
    const dark = theme === "dark";
    const locale = effectiveLocale(isAppLocale(requestedLocale) ? requestedLocale : defaultLocale, pathname);

    useEffect(() => {
        const reloadOnceForChunkError = (reason: unknown) => {
            const text = reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason);
            if (!/ChunkLoadError|Loading chunk|dynamically imported module|failed to fetch/i.test(text)) return;
            const key = "vozeb-pro:chunk-reload-attempted";
            const lastAttempt = Number(sessionStorage.getItem(key) || "0");
            if (Date.now() - lastAttempt < 30_000) return;
            sessionStorage.setItem(key, String(Date.now()));
            window.location.reload();
        };

        const handleError = (event: ErrorEvent) => reloadOnceForChunkError(event.error || event.message);
        const handleRejection = (event: PromiseRejectionEvent) => reloadOnceForChunkError(event.reason);
        window.addEventListener("error", handleError);
        window.addEventListener("unhandledrejection", handleRejection);
        return () => {
            window.removeEventListener("error", handleError);
            window.removeEventListener("unhandledrejection", handleRejection);
        };
    }, []);

    useLayoutEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.style.colorScheme = theme;
    }, [dark, theme]);

    useLayoutEffect(() => {
        document.documentElement.lang = localeMetadata[locale].htmlLang;
        dayjs.locale(localeMetadata[locale].dayjsLocale);
    }, [locale]);

    return (
        <ConfigProvider locale={antLocales[locale]} theme={getAntThemeConfig(dark)}>
            <App message={{ top: 84, duration: 2.4, maxCount: 3 }}>
                <QueryClientProvider client={queryClient}>
                    <ClientRootInit>{children}</ClientRootInit>
                </QueryClientProvider>
            </App>
        </ConfigProvider>
    );
}
