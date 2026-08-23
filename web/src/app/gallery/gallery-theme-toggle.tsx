"use client";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { useTranslations } from "next-intl";
import { useThemeStore } from "@/stores/use-theme-store";

export function GalleryThemeToggle() {
    const t = useTranslations("common");
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    return (
        <AnimatedThemeToggler
            theme={theme}
            onThemeChange={setTheme}
            className={`!inline-flex !size-9 shrink-0 !items-center !justify-center !rounded-md !border-0 !bg-transparent !p-0 !text-muted-foreground transition hover:!bg-transparent hover:!text-foreground focus-visible:!outline-none focus-visible:!ring-2 focus-visible:!ring-ring [&>svg]:!size-5 ${theme === "dark" ? "" : "[&>svg]:translate-x-px"}`}
            aria-label={theme === "dark" ? t("themeLight") : t("themeDark")}
            title={theme === "dark" ? t("themeLight") : t("themeDark")}
        />
    );
}
