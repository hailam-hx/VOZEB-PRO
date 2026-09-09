"use client";

import type { CSSProperties } from "react";
import { useState, useTransition } from "react";
import type { MenuProps } from "antd";
import { App, Dropdown } from "antd";
import { Check, Globe2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useRouter as useLocalizedRouter } from "@/i18n/navigation";
import { matchSeoRoute, isSeoPagePublished, seoPublicationRegistry } from "@/i18n/routing";

import { setLocalePreference } from "@/i18n/actions";
import { appLocales, defaultLocale, isAppLocale, localeMetadata } from "@/i18n/config";
import { cn } from "@/lib/utils";

type LanguageSwitcherProps = {
    className?: string;
    style?: CSSProperties;
    rootClassName?: string;
    onOpen?: () => void;
};

export function LanguageSwitcher({ className, style, rootClassName, onOpen }: LanguageSwitcherProps) {
    const requestedLocale = useLocale();
    const locale = isAppLocale(requestedLocale) ? requestedLocale : defaultLocale;
    const t = useTranslations("common");
    const { message } = App.useApp();
    const router = useRouter();
    const localizedRouter = useLocalizedRouter();
    const pathname = usePathname();
    const seoRoute = pathname ? matchSeoRoute(pathname) : null;
    const [open, setOpen] = useState(false);
    const [pending, startTransition] = useTransition();
    const items: MenuProps["items"] = appLocales
        .filter((itemLocale) => !seoRoute || isSeoPagePublished(seoRoute.pageId, itemLocale))
        .map((itemLocale) => ({
            key: itemLocale,
            label: (
                <span className="flex min-w-32 items-center justify-between gap-4">
                    <span>{localeMetadata[itemLocale].label}</span>
                    <span className="grid size-4 place-items-center text-[#5965ff]" aria-hidden="true">
                        {itemLocale === locale ? <Check className="size-4" /> : null}
                    </span>
                </span>
            ),
        }));

    const changeLocale: MenuProps["onClick"] = ({ key }) => {
        if (!isAppLocale(key) || key === locale) {
            setOpen(false);
            return;
        }
        setOpen(false);
        startTransition(async () => {
            try {
                if (seoRoute) localizedRouter.replace(seoPublicationRegistry[seoRoute.pageId].internalPath, { locale: key });
                else {
                    await setLocalePreference(key);
                    router.refresh();
                }
            } catch {
                message.error(t("languageChangeFailed"));
            }
        });
    };

    return (
        <Dropdown
            rootClassName={cn("language-switcher-dropdown", rootClassName)}
            open={open}
            onOpenChange={(nextOpen) => {
                setOpen(nextOpen);
                if (nextOpen) onOpen?.();
            }}
            menu={{ items, onClick: changeLocale, selectedKeys: [locale] }}
            trigger={["click"]}
            placement="bottomRight"
        >
            <button type="button" className={className} style={style} aria-label={t("switchLanguage")} title={t("switchLanguage")} aria-expanded={open} disabled={pending} data-locale={locale}>
                <Globe2 aria-hidden="true" />
            </button>
        </Dropdown>
    );
}
