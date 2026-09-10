"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Menu, X } from "lucide-react";
import { getLocalizedSeoHref } from "@/i18n/routing";
import { useLocale, useTranslations } from "next-intl";

import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { SiteLogo } from "@/components/layout/site-logo";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { useThemeStore } from "@/stores/use-theme-store";
import { HOME_NAVIGATION, HOME_PRODUCT_NAVIGATION, type HomeNavigationItem } from "./home-data";
import { useHomeActions } from "./home-actions";
import styles from "./home.module.css";

export function HomeHeader() {
    const locale = useLocale();
    const t = useTranslations("home");
    const common = useTranslations("common");
    const [mobileOpen, setMobileOpen] = useState(false);
    const [navIndicator, setNavIndicator] = useState({ left: 0, width: 0, visible: false });
    const navItemRefs = useRef<(HTMLElement | null)[]>([]);
    const hoveredNavIndex = useRef<number | null>(null);
    const { authenticated, site, openTopUp, openProtectedPath } = useHomeActions();
    const homeHref = getLocalizedSeoHref("/", locale);
    const brand = (
        <>
            <SiteLogo logoUrl={site.logoUrl} className={styles.brandLogo} />
            <span>{site.title}</span>
        </>
    );
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);

    const moveNavIndicator = useCallback((index: number) => {
        const item = navItemRefs.current[index];
        if (!item) return;
        const navigation = item.closest("nav");
        const itemBounds = item.getBoundingClientRect();
        const navigationBounds = navigation?.getBoundingClientRect();
        setNavIndicator({ left: navigationBounds ? itemBounds.left - navigationBounds.left : item.offsetLeft, width: itemBounds.width, visible: true });
    }, []);

    const hideNavIndicator = useCallback(() => {
        hoveredNavIndex.current = null;
        setNavIndicator((current) => ({ ...current, visible: false }));
    }, []);

    useLayoutEffect(() => {
        const updateIndicator = () => {
            if (hoveredNavIndex.current !== null) moveNavIndicator(hoveredNavIndex.current);
        };
        window.addEventListener("resize", updateIndicator);
        return () => window.removeEventListener("resize", updateIndicator);
    }, [moveNavIndicator]);

    const activate = (item: HomeNavigationItem) => {
        setMobileOpen(false);
        if (item.action === "billing") openTopUp();
        if (item.action === "protected") openProtectedPath(item.href);
    };

    const trackNavItem = (index: number) => {
        hoveredNavIndex.current = index;
        moveNavIndicator(index);
    };

    return (
        <header className={styles.header}>
            <div className={styles.headerInner}>
                {homeHref ? (
                    <Link href={homeHref} className={styles.brand} aria-label={`${site.title} ${t("home")}`}>
                        {brand}
                    </Link>
                ) : (
                    <div className={styles.brand}>{brand}</div>
                )}

                <nav
                    className={styles.desktopNav}
                    aria-label={t("mainNavigation")}
                    onPointerLeave={hideNavIndicator}
                    onBlur={(event) => {
                        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) hideNavIndicator();
                    }}
                >
                    <span className={styles.navGlassIndicator} data-testid="home-nav-glass" aria-hidden="true" style={{ left: navIndicator.left, opacity: navIndicator.visible ? 1 : 0, width: navIndicator.width }} />
                    <details className={styles.productMenu} onPointerEnter={() => trackNavItem(0)}>
                        <summary
                            ref={(node) => {
                                navItemRefs.current[0] = node;
                            }}
                            className={styles.navLink}
                            onFocus={() => trackNavItem(0)}
                        >
                            {t("products")}
                            <ChevronDown aria-hidden="true" />
                        </summary>
                        <div className={styles.productMenuPanel} data-testid="home-product-menu">
                            {HOME_PRODUCT_NAVIGATION.filter((item) => getLocalizedSeoHref(item.href, locale)).map((item) => (
                                <Link key={item.href} href={getLocalizedSeoHref(item.href, locale)!}>
                                    <span>{t(item.translationKey)}</span>
                                    <ArrowRight aria-hidden="true" />
                                </Link>
                            ))}
                        </div>
                    </details>
                    {HOME_NAVIGATION.map((item, index) =>
                        item.action !== "link" ? (
                            <button
                                key={item.href}
                                ref={(node) => {
                                    navItemRefs.current[index + 1] = node;
                                }}
                                type="button"
                                className={styles.navLink}
                                onClick={() => activate(item)}
                                onPointerEnter={() => trackNavItem(index + 1)}
                                onFocus={() => trackNavItem(index + 1)}
                            >
                                {t(item.translationKey)}
                            </button>
                        ) : (
                            <Link
                                key={item.href}
                                ref={(node) => {
                                    navItemRefs.current[index + 1] = node;
                                }}
                                href={getLocalizedSeoHref(item.href, locale)!}
                                className={styles.navLink}
                                onPointerEnter={() => trackNavItem(index + 1)}
                                onFocus={() => trackNavItem(index + 1)}
                            >
                                {t(item.translationKey)}
                            </Link>
                        ),
                    )}
                </nav>

                <div className={styles.headerActions}>
                    <LanguageSwitcher className={styles.languageButton} />
                    <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={styles.themeButton} aria-label={theme === "dark" ? common("themeLight") : common("themeDark")} />
                    <button type="button" className={styles.primarySmallButton} onClick={() => openProtectedPath("/create")}>
                        {authenticated ? t("startCreating") : t("tryNow")}
                    </button>
                    <button
                        type="button"
                        className={styles.mobileMenuButton}
                        onClick={() => setMobileOpen((value) => !value)}
                        aria-expanded={mobileOpen}
                        aria-controls="home-mobile-menu"
                        aria-label={mobileOpen ? t("closeNavigation") : t("openNavigation")}
                    >
                        {mobileOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
                    </button>
                </div>
            </div>

            {mobileOpen ? (
                <nav id="home-mobile-menu" className={styles.mobileNav} aria-label={t("mobileNavigation")}>
                    <div className={styles.mobileProductGroup}>
                        <span>{t("products")}</span>
                        {HOME_PRODUCT_NAVIGATION.filter((item) => getLocalizedSeoHref(item.href, locale)).map((item) => (
                            <Link key={item.href} href={getLocalizedSeoHref(item.href, locale)!} onClick={() => setMobileOpen(false)}>
                                {t(item.translationKey)}
                                <ArrowRight aria-hidden="true" />
                            </Link>
                        ))}
                    </div>
                    {HOME_NAVIGATION.map((item) =>
                        item.action !== "link" ? (
                            <button key={item.href} type="button" onClick={() => activate(item)}>
                                {t(item.translationKey)}
                                <ArrowRight aria-hidden="true" />
                            </button>
                        ) : (
                            <Link key={item.href} href={getLocalizedSeoHref(item.href, locale)!} onClick={() => setMobileOpen(false)}>
                                {t(item.translationKey)}
                                <ArrowRight aria-hidden="true" />
                            </Link>
                        ),
                    )}
                </nav>
            ) : null}
        </header>
    );
}
