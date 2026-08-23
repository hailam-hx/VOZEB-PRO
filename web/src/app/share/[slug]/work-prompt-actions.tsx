"use client";

import { App, Button } from "antd";
import { Copy, Sparkles } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

export function WorkPromptActions({ prompt, createHref }: { prompt: string; createHref: string }) {
    const t = useTranslations("public.share.actions");
    const { message } = App.useApp();

    const copyPrompt = async () => {
        try {
            await navigator.clipboard.writeText(prompt);
            message.success(t("promptCopied"));
        } catch {
            message.error(t("promptCopyFailed"));
        }
    };

    return (
        <div className="mt-3 grid grid-cols-2 gap-2">
            <Button icon={<Copy className="size-4" />} onClick={() => void copyPrompt()}>
                {t("copyPrompt")}
            </Button>
            <Link href={createHref} className="inline-flex h-8 items-center justify-center gap-2 rounded-md !bg-foreground px-3 text-sm font-medium !text-background transition hover:opacity-80">
                <Sparkles className="size-4" />
                {t("remix")}
            </Link>
        </div>
    );
}
