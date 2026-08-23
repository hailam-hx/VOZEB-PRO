"use client";

import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { isFullscreenWorkspacePath } from "@/components/layout/app-workspace-path";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { SiteLogo } from "@/components/layout/site-logo";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { navigationToolForPathname } from "@/constant/navigation-tools";
import { DEFAULT_SITE_TITLE, resolveSiteTitle } from "@/lib/site-brand";
import { usePublicSessionStore } from "@/stores/use-public-session-store";

const PAGE_TITLE_KEYS: Record<string, "billing" | "helpCenter" | "profileCenter"> = {
    billing: "billing",
    help: "helpCenter",
    profile: "profileCenter",
};

export function AppWorkspaceShell({ children }: { children: ReactNode }) {
    const t = useTranslations("workspace");
    const pathname = usePathname();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [sidebarExpanded, setSidebarExpanded] = useState(true);
    const site = usePublicSessionStore((state) => state.payload?.settings?.site) || { title: DEFAULT_SITE_TITLE, logoUrl: "/logo.svg" };
    const siteTitle = resolveSiteTitle(site.title);
    const tool = navigationToolForPathname(pathname);
    const fullscreen = isFullscreenWorkspacePath(pathname);
    const rootSlug = pathname.split("/").filter(Boolean)[0] || "";
    const pageTitle = tool ? t(tool.labelKey) : PAGE_TITLE_KEYS[rootSlug] ? t(PAGE_TITLE_KEYS[rootSlug]) : t("workspace");

    if (fullscreen) return <div className="h-dvh min-h-0 overflow-hidden">{children}</div>;

    return (
        <div className="workspace-shell flex h-dvh min-h-0 overflow-hidden bg-white text-foreground dark:bg-[#111316]">
            <AppSidebar activeToolSlug={tool?.slug} expanded={sidebarExpanded} />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[#eaecf0] bg-white/96 px-3 backdrop-blur-xl sm:px-4 lg:px-7 dark:border-[#292d33] dark:bg-[#111316]/95">
                    <div className="flex min-w-0 items-center gap-2.5">
                        <button
                            type="button"
                            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-stone-600 transition hover:bg-stone-100 hover:text-stone-950 lg:hidden dark:text-stone-300 dark:hover:bg-stone-900 dark:hover:text-white"
                            onClick={() => setMobileNavOpen(true)}
                            aria-label={t("openNavigation")}
                            title={t("navigationMenu")}
                        >
                            <Menu className="size-5" />
                        </button>
                        <Link href="/create" className="inline-flex shrink-0 items-center lg:hidden" aria-label={siteTitle}>
                            <SiteLogo logoUrl={site.logoUrl} className="size-6" />
                        </Link>
                        <button
                            type="button"
                            className="hidden size-8 shrink-0 items-center justify-center rounded-lg text-[#68717c] transition hover:bg-[#f1f3f5] hover:text-[#20242a] lg:inline-flex dark:text-[#a5adb8] dark:hover:bg-[#22262c] dark:hover:text-white"
                            onClick={() => setSidebarExpanded((value) => !value)}
                            aria-label={sidebarExpanded ? t("collapseSidebar") : t("expandSidebar")}
                            title={sidebarExpanded ? t("collapseSidebar") : t("expandSidebar")}
                            aria-pressed={sidebarExpanded}
                        >
                            {sidebarExpanded ? <PanelLeftClose className="size-[17px]" /> : <PanelLeftOpen className="size-[17px]" />}
                        </button>
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-[#20242a] dark:text-[#f3f5f7]">{pageTitle}</div>
                        </div>
                    </div>
                    <div className="min-w-0 max-w-[calc(100vw-6.5rem)] shrink-0 overflow-visible sm:max-w-[calc(100vw-8rem)] lg:max-w-none">
                        <UserStatusActions />
                    </div>
                </header>
                <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-white dark:bg-[#111316]">{children}</div>
            </div>
            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={tool?.slug} onClose={() => setMobileNavOpen(false)} />
        </div>
    );
}
