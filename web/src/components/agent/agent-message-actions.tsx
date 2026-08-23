"use client";

import type { CSSProperties } from "react";
import { Copy, Download, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

import { downloadAgentMedia, type AgentMediaDownload } from "@/components/agent/agent-media-download";
import { useCopyText } from "@/hooks/use-copy-text";
import { cn } from "@/lib/utils";

export function AgentMessageActions({
    text,
    downloads = [],
    onEdit,
    align = "start",
    className,
    style,
}: {
    text: string;
    downloads?: AgentMediaDownload[];
    onEdit?: (text: string) => void;
    align?: "start" | "end";
    className?: string;
    style?: CSSProperties;
}) {
    const t = useTranslations("common.agentMessage");
    const copyText = useCopyText();
    if (!text.trim() && !downloads.length) return null;
    const downloadLabel = downloads.length > 1 ? t("downloadAll", { count: downloads.length }) : downloads[0]?.type === "video" ? t("downloadVideo") : t("downloadImage");
    return (
        <div
            className={cn(
                "mt-1 flex min-h-7 items-center gap-0.5 text-stone-500 opacity-70 transition sm:opacity-0 sm:group-hover/message:opacity-70 sm:group-focus-within/message:opacity-70 dark:text-stone-400",
                align === "end" ? "justify-end" : "justify-start",
                className,
            )}
            style={style}
        >
            {downloads.length ? (
                <button
                    type="button"
                    className="grid size-8 place-items-center rounded-md text-current transition hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 sm:size-7"
                    onClick={() => downloadAgentMedia(downloads)}
                    aria-label={downloadLabel}
                    title={downloads.length > 1 ? t("downloadAllShort") : downloadLabel}
                >
                    <Download className="size-3.5" />
                </button>
            ) : null}
            {text.trim() ? (
                <button
                    type="button"
                    className="grid size-8 place-items-center rounded-md text-current transition hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 sm:size-7"
                    onClick={() => copyText(text, t("copied"))}
                    aria-label={t("copyMessage")}
                    title={t("copy")}
                >
                    <Copy className="size-3.5" />
                </button>
            ) : null}
            {onEdit ? (
                <button
                    type="button"
                    className="grid size-8 place-items-center rounded-md text-current transition hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 sm:size-7"
                    onClick={() => onEdit(text)}
                    aria-label={t("editMessage")}
                    title={t("editAndResend")}
                >
                    <Pencil className="size-3.5" />
                </button>
            ) : null}
        </div>
    );
}
