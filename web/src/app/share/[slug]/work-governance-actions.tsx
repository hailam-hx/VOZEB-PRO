"use client";

import { App, Button } from "antd";
import { GalleryVerticalEnd, Share2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { PublicWorkReportButton } from "@/components/works/public-work-report-button";

export function WorkGovernanceActions({ slug, createHref }: { slug: string; createHref?: string }) {
    const t = useTranslations("public.share.actions");
    const { message } = App.useApp();

    const share = async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            message.success(t("linkCopied"));
        } catch {
            message.error(t("linkCopyFailed"));
        }
    };

    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {createHref ? (
                <Link href={createHref} className="inline-flex h-9 items-center gap-2 rounded-md !bg-foreground px-3 text-sm font-medium !text-background transition hover:opacity-80">
                    <Sparkles className="size-4" />
                    {t("remix")}
                </Link>
            ) : null}
            <Link href="/gallery" className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9dde2] px-3 text-sm font-medium text-[#30353b] transition hover:bg-[#f2f4f6] dark:border-[#343941] dark:text-[#e8ebee] dark:hover:bg-[#1b1e23]">
                <GalleryVerticalEnd className="size-4" />
                <span className="hidden sm:inline">{t("gallery")}</span>
            </Link>
            <Button className="!h-9" icon={<Share2 className="size-4" />} onClick={() => void share()} aria-label={t("copyLinkAria")}>
                <span className="hidden sm:inline">{t("share")}</span>
            </Button>
            <PublicWorkReportButton slug={slug} className="!h-9" />
        </div>
    );
}
