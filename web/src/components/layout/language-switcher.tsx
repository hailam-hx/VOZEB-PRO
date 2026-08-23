"use client";

import type { CSSProperties } from "react";
import { useState, useTransition } from "react";
import type { MenuProps } from "antd";
import { App, Dropdown } from "antd";
import { Check, Globe2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

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
    const [open, setOpen] = useState(false);
    const [pending, startTransition] = useTransition();
    const items: MenuProps["items"] = appLocales.map((itemLocale) => ({
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
                await setLocalePreference(key);
                router.refresh();
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
