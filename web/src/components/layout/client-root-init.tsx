"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { App } from "antd";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { SiteAnnouncementPopup } from "@/components/layout/site-announcement-popup";
import { applyPublicSystemSettings, useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { loadPublicSession, PUBLIC_SETTINGS_CHANGED_EVENT } from "@/stores/use-public-session-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const t = useTranslations("common");
    const { message } = App.useApp();
    const pathname = usePathname();
    const installRoute = pathname === "/install";
    const setConfig = useConfigStore((state) => state.setConfig);
    const setUser = useUserStore((state) => state.setUser);

    useEffect(() => {
        if (installRoute) return;
        let cancelled = false;
        const hydrate = (force = false) => {
            void loadPublicSession({ force })
                .then((payload) => {
                    if (cancelled) return;
                    setUser(payload.user || null);
                    setConfig(applyPublicSystemSettings(useConfigStore.getState().config, payload.settings));
                })
                .catch(() => undefined);
        };
        const handleSettingsChanged = () => hydrate(true);
        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") hydrate(true);
        };
        hydrate();
        window.addEventListener(PUBLIC_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => {
            cancelled = true;
            window.removeEventListener(PUBLIC_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [installRoute, setConfig, setUser]);

    useEffect(() => {
        const handleMissingConfig = () => {
            message.warning(t("modelChannelMissing"));
        };
        window.addEventListener("vozeb-pro-system-config-missing", handleMissingConfig);
        return () => window.removeEventListener("vozeb-pro-system-config-missing", handleMissingConfig);
    }, [message, t]);

    return (
        <>
            {children}
            {installRoute ? null : <SiteAnnouncementPopup />}
        </>
    );
}
