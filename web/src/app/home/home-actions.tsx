"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal } from "antd";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { AuthForm } from "@/components/auth/auth-form";
import { SiteLogo } from "@/components/layout/site-logo";
import { createAgentPromptHref, type CreateAgentMode } from "@/lib/create-agent-prompt";
import { loadPublicSession, usePublicSessionStore } from "@/stores/use-public-session-store";
import { useUserStore } from "@/stores/use-user-store";
import type { HomeSiteSettings } from "./home-data";
import { DEFAULT_SITE_LOGO_URL, resolveSiteTitle } from "@/lib/site-brand";

type HomeActions = {
    authenticated: boolean;
    sessionReady: boolean;
    site: HomeSiteSettings;
    openLogin: (nextPath?: string) => void;
    openTopUp: () => void;
    openProtectedPath: (path: string) => void;
    startCreating: (prompt?: string, mode?: CreateAgentMode) => void;
};

const HomeActionsContext = createContext<HomeActions | null>(null);

export function HomeActionsProvider({ initialSite, children }: { initialSite: HomeSiteSettings; children: ReactNode }) {
    const t = useTranslations("home");
    const router = useRouter();
    const [authOpen, setAuthOpen] = useState(false);
    const [authNextPath, setAuthNextPath] = useState("/create");
    const mounted = useRef(true);
    const protectedActionVersion = useRef(0);
    const user = useUserStore((state) => state.user);
    const session = usePublicSessionStore((state) => state.payload);
    const sessionReady = usePublicSessionStore((state) => state.ready);
    const sessionSite = session?.settings?.site;
    const site = useMemo<HomeSiteSettings>(
        () => ({
            ...initialSite,
            ...(sessionSite || {}),
            title: resolveSiteTitle(sessionSite?.title || initialSite.title),
            logoUrl: sessionSite?.logoUrl?.trim() || initialSite.logoUrl || DEFAULT_SITE_LOGO_URL,
            friendLinks: sessionSite?.friendLinks || initialSite.friendLinks,
            socials: (sessionSite?.socials as HomeSiteSettings["socials"] | undefined) || initialSite.socials,
        }),
        [initialSite, sessionSite],
    );
    const authenticated = sessionReady && Boolean(user);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    const openLogin = (nextPath = "/create") => {
        setAuthNextPath(nextPath);
        setAuthOpen(true);
    };
    const openProtectedPath = (path: string) => {
        const actionVersion = ++protectedActionVersion.current;
        if (sessionReady) {
            if (user) router.push(path);
            else openLogin(path);
            return;
        }
        void loadPublicSession()
            .then((payload) => {
                if (!mounted.current || actionVersion !== protectedActionVersion.current) return;
                if (payload.user) router.push(path);
                else openLogin(path);
            })
            .catch(() => {
                if (mounted.current && actionVersion === protectedActionVersion.current) openLogin(path);
            });
    };
    const startCreating = (prompt = "", mode: CreateAgentMode = "agent") => openProtectedPath(createAgentPromptHref(prompt, { source: "home", mode }));

    return (
        <HomeActionsContext.Provider value={{ authenticated, sessionReady, site, openLogin, openTopUp: () => openProtectedPath("/profile?section=billing"), openProtectedPath, startCreating }}>
            {children}
            <Modal centered open={authOpen} width={740} footer={null} title={null} destroyOnHidden onCancel={() => setAuthOpen(false)} className="landing-auth-modal">
                <div className="landing-auth-modal-shell">
                    <section className="landing-auth-modal-brand">
                        <div className="inline-flex items-center gap-3 text-stone-950 dark:text-white">
                            <SiteLogo logoUrl={site.logoUrl} className="landing-auth-brand-logo bg-stone-950 dark:bg-white" />
                            <span className="text-xl font-semibold">{site.title}</span>
                        </div>
                        <div className="landing-auth-modal-copy">
                            <p className="landing-auth-modal-kicker text-sm font-medium">{t("continueCreating")}</p>
                            <h2 className="mt-3 text-3xl font-semibold leading-tight text-stone-950 dark:text-white">{t("loginReturnTitle")}</h2>
                            <p className="mt-4 text-sm leading-7 text-stone-500 dark:text-stone-300">{t("loginReturnDescription")}</p>
                        </div>
                        <div className="landing-auth-modal-bullets grid gap-2 text-sm text-stone-600 dark:text-stone-300">
                            {[t("savedSessions"), t("unifiedMediaCreation"), t("resumeProjects")].map((item) => (
                                <div key={item} className="flex items-center gap-2">
                                    <span className="landing-auth-feature-dot size-1.5 rounded-full" />
                                    <span>{item}</span>
                                </div>
                            ))}
                        </div>
                    </section>
                    <div className="landing-auth-modal-form">
                        <AuthForm mode="login" variant="embedded" nextPath={authNextPath} className="min-h-0 bg-transparent p-0 shadow-none" />
                    </div>
                </div>
            </Modal>
        </HomeActionsContext.Provider>
    );
}

export function useHomeActions() {
    const value = useContext(HomeActionsContext);
    if (!value) throw new Error("useHomeActions must be used within HomeActionsProvider");
    return value;
}
