"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Mail, Send } from "lucide-react";
import { useTranslations } from "next-intl";

import { SiteLogo } from "@/components/layout/site-logo";
import { builtInSiteCopy, localizeBuiltInSiteCopy } from "@/i18n/site-copy";
import { HOME_NAVIGATION, type HomeNavigationItem } from "./home-data";
import { useHomeActions } from "./home-actions";
import styles from "./home.module.css";

export function HomeCta() {
    const t = useTranslations("home");
    const { site, startCreating } = useHomeActions();
    return (
        <section className={styles.cta} aria-labelledby="home-cta-title">
            <span className={`${styles.ctaCrystal} ${styles.ctaCrystalLeft}`} aria-hidden="true" />
            <span className={`${styles.ctaCrystal} ${styles.ctaCrystalRight}`} aria-hidden="true" />
            <div>
                <h2 id="home-cta-title">{t("ctaTitle")}</h2>
                <p>{t("ctaDescription", { site: site.title })}</p>
            </div>
            <button type="button" onClick={() => startCreating()}>
                {t("startFree")} <ArrowRight aria-hidden="true" />
            </button>
        </section>
    );
}

export function HomeFooter() {
    const t = useTranslations("home");
    const publicT = useTranslations("public");
    const { site, openTopUp, openProtectedPath } = useHomeActions();
    const friendLinks = site.friendLinks.filter((item) => item.enabled && item.label.trim() && item.url.trim());
    const socials = Object.entries(site.socials).filter(([, item]) => item.enabled && item.label.trim() && item.url.trim());
    const copyright = site.footerCopyright?.trim();
    const description = localizeBuiltInSiteCopy(site.seoDescription, builtInSiteCopy.seoDescription, t("footerDefaultDescription"));
    const policies = [site.privacyUrl?.trim() ? { label: publicT("privacyLabel"), href: site.privacyUrl.trim() } : null, site.termsUrl?.trim() ? { label: publicT("termsLabel"), href: site.termsUrl.trim() } : null].filter(
        (item): item is { label: string; href: string } => Boolean(item),
    );
    const navigationGroups: Array<{ title: string; items: readonly HomeNavigationItem[] }> = [
        { title: t("footerProduct"), items: HOME_NAVIGATION },
        { title: t("footerPlatform"), items: [{ translationKey: "announcementCenter", href: "/announcements", action: "link" }] },
    ];

    return (
        <footer className={styles.footer}>
            <div className={styles.footerGrid}>
                <div className={styles.footerBrand}>
                    <Link href="/" className={styles.footerLogo}>
                        <SiteLogo logoUrl={site.logoUrl} className={styles.brandLogo} />
                        <span>{site.title}</span>
                    </Link>
                    {description ? <p>{description}</p> : null}
                    {socials.length ? (
                        <div className={styles.footerSocials}>
                            {socials.map(([key, item]) => {
                                const label = key === "email" ? localizeBuiltInSiteCopy(item.label, builtInSiteCopy.emailLabel, t("footerEmailLabel")) : item.label;
                                return (
                                    <a key={key} href={item.url} target={externalTarget(item.url)} rel={externalTarget(item.url) ? "noreferrer" : undefined} aria-label={label} title={label}>
                                        {socialIcon(key)}
                                    </a>
                                );
                            })}
                        </div>
                    ) : null}
                </div>

                <div className={styles.footerNavigation}>
                    {navigationGroups.map((group) => (
                        <FooterColumn key={group.title} title={group.title}>
                            {group.items.map((item) =>
                                item.action === "protected" ? (
                                    <button key={item.href} type="button" onClick={() => openProtectedPath(item.href)}>
                                        {t(item.translationKey)}
                                    </button>
                                ) : item.action === "billing" ? (
                                    <button key={item.href} type="button" onClick={openTopUp}>
                                        {t(item.translationKey)}
                                    </button>
                                ) : (
                                    <Link key={item.href} href={item.href}>
                                        {t(item.translationKey)}
                                    </Link>
                                ),
                            )}
                        </FooterColumn>
                    ))}
                    {friendLinks.length ? (
                        <FooterColumn title={t("friendLinks")}>
                            {friendLinks.map((item) => (
                                <a key={item.id} href={item.url} target={externalTarget(item.url)} rel={externalTarget(item.url) ? "noreferrer" : undefined}>
                                    {item.id === "qq-vozeb-open-source" ? localizeBuiltInSiteCopy(item.label, builtInSiteCopy.qqGroupLabel, t("footerQqGroupLabel")) : item.label}
                                </a>
                            ))}
                        </FooterColumn>
                    ) : null}
                </div>
            </div>
            {copyright || policies.length ? (
                <div className={styles.footerBottom} data-testid="home-footer-bottom">
                    {copyright ? <span>{copyright}</span> : null}
                    {policies.length ? (
                        <div>
                            {policies.map((item) => (
                                <a key={item.label} href={item.href} target={externalTarget(item.href)} rel={externalTarget(item.href) ? "noreferrer" : undefined}>
                                    {item.label}
                                </a>
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </footer>
    );
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
    return (
        <nav className={styles.footerColumn} aria-label={title}>
            <h2>{title}</h2>
            {children}
        </nav>
    );
}

function externalTarget(url: string) {
    return /^(https?:)?\/\//.test(url) ? "_blank" : undefined;
}

function socialIcon(key: string) {
    if (key === "telegram") return <Send aria-hidden="true" />;
    if (key === "x") return <span aria-hidden="true">X</span>;
    if (key === "instagram") return <span aria-hidden="true">◎</span>;
    return <Mail aria-hidden="true" />;
}
