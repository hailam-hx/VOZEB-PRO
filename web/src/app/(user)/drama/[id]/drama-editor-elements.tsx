"use client";

import type { ReactNode } from "react";
import { Tag } from "antd";
import { useTranslations } from "next-intl";

const compactTagClass = "!m-0 !inline-flex !h-6 !min-w-max !shrink-0 !items-center !whitespace-nowrap !rounded-md !border !px-2 !text-xs !font-medium !leading-6";

const statusToneClass: Record<string, string> = {
    idle: "!border-border !bg-muted/60 !text-muted-foreground",
    queued: "!border-sky-200 !bg-sky-50 !text-sky-700 dark:!border-sky-900/70 dark:!bg-sky-950/35 dark:!text-sky-300",
    running: "!border-amber-200 !bg-amber-50 !text-amber-700 dark:!border-amber-900/70 dark:!bg-amber-950/35 dark:!text-amber-300",
    success: "!border-emerald-200 !bg-emerald-50 !text-emerald-700 dark:!border-emerald-900/70 dark:!bg-emerald-950/35 dark:!text-emerald-300",
    error: "!border-rose-200 !bg-rose-50 !text-rose-700 dark:!border-rose-900/70 dark:!bg-rose-950/35 dark:!text-rose-300",
    cancelled: "!border-border !bg-muted/60 !text-muted-foreground",
};

const stageToneClass = {
    neutral: "border-border bg-muted/55 text-muted-foreground",
    ready: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/35 dark:text-emerald-300",
    attention: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/35 dark:text-amber-300",
    running: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/35 dark:text-sky-300",
} as const;

export function DramaStageHeader({
    step,
    title,
    description,
    status,
    tone = "neutral",
    metrics = [],
    action,
    secondaryAction,
    className = "",
}: {
    step: string;
    title: string;
    description: string;
    status: string;
    tone?: keyof typeof stageToneClass;
    metrics?: Array<{ label: string; value: ReactNode }>;
    action?: ReactNode;
    secondaryAction?: ReactNode;
    className?: string;
}) {
    return (
        <header className={`border-b border-border/80 pb-3 ${className}`} data-drama-stage-header>
            <div className="flex min-w-0 flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">{step}</span>
                        <h2 className="truncate text-base font-semibold leading-6 sm:text-[17px]">{title}</h2>
                        <span className={`inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[11px] font-medium ${stageToneClass[tone]}`}>{status}</span>
                    </div>
                    <p className="sr-only">{description}</p>
                    {metrics.length ? (
                        <dl className="mt-1.5 flex min-w-0 flex-wrap items-center gap-y-1 text-[11px] leading-4 text-muted-foreground" data-drama-stage-metrics>
                            {metrics.map((item, index) => (
                                <div key={item.label} className={`flex min-w-0 items-baseline gap-1.5 pr-3 ${index ? "border-l border-border/80 pl-3" : ""}`}>
                                    <dt className="whitespace-nowrap">{item.label}</dt>
                                    <dd className="whitespace-nowrap font-medium tabular-nums text-foreground">{item.value}</dd>
                                </div>
                            ))}
                        </dl>
                    ) : null}
                </div>
                {action || secondaryAction ? (
                    <div className="flex w-full shrink-0 flex-col-reverse gap-1.5 sm:w-auto sm:flex-row sm:items-center">
                        {secondaryAction}
                        {action}
                    </div>
                ) : null}
            </div>
        </header>
    );
}

export function SectionTitle({ title, description, className = "" }: { title: string; description: string; className?: string }) {
    return (
        <div className={`mb-4 sm:mb-8 ${className}`}>
            <h2 className="text-lg font-semibold sm:text-xl">{title}</h2>
            <p className="mt-1.5 text-sm leading-5 text-muted-foreground sm:mt-2 sm:leading-6">{description}</p>
        </div>
    );
}
export function GenerationTag({ status = "idle" }: { status?: string }) {
    const t = useTranslations("drama.editor");
    const values: Record<string, string> = {
        idle: t("generationStatuses.idle"),
        queued: t("generationStatuses.queued"),
        running: t("generationStatuses.running"),
        success: t("generationStatuses.success"),
        error: t("generationStatuses.error"),
        cancelled: t("generationStatuses.cancelled"),
    };
    return <Tag className={`${compactTagClass} ${statusToneClass[status] || statusToneClass.idle}`}>{values[status] || values.idle}</Tag>;
}
export function StoryboardTag({ status = "idle" }: { status?: string }) {
    const t = useTranslations("drama.editor");
    const values: Record<string, string> = {
        idle: t("storyboardStatuses.idle"),
        queued: t("storyboardStatuses.queued"),
        running: t("storyboardStatuses.running"),
        success: t("storyboardStatuses.success"),
        error: t("storyboardStatuses.error"),
        cancelled: t("storyboardStatuses.cancelled"),
    };
    return <Tag className={`${compactTagClass} ${statusToneClass[status] || statusToneClass.idle}`}>{values[status] || values.idle}</Tag>;
}
export function AudioTag({ status = "idle" }: { status?: string }) {
    const t = useTranslations("drama.editor");
    const values: Record<string, string> = {
        idle: t("audioStatuses.idle"),
        queued: t("audioStatuses.queued"),
        running: t("audioStatuses.running"),
        success: t("audioStatuses.success"),
        error: t("audioStatuses.error"),
        cancelled: t("audioStatuses.cancelled"),
    };
    return <Tag className={`${compactTagClass} ${statusToneClass[status] || statusToneClass.idle}`}>{values[status] || values.idle}</Tag>;
}
export function AssetPanel({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
    return (
        <section className="rounded-xl border border-border bg-background p-3 sm:rounded-2xl sm:p-6">
            <div className="mb-4 flex items-center gap-3 font-semibold sm:mb-6">
                {icon}
                {title}
            </div>
            {children}
        </section>
    );
}
export function AssetList({ items }: { items: Array<{ id: string; name: string; description: string }> }) {
    const t = useTranslations("drama.editor");
    return items.length ? (
        <div className="mt-4 space-y-3 sm:mt-6 sm:space-y-4">
            {items.map((item) => (
                <div key={item.id} className="rounded-xl border border-border bg-card p-3 sm:p-4">
                    <div className="text-sm font-semibold">{item.name}</div>
                    <div className="mt-2 text-xs leading-5 text-muted-foreground">{item.description || t("noDescription")}</div>
                </div>
            ))}
        </div>
    ) : (
        <p className="mt-6 text-sm text-muted-foreground">{t("notAdded")}</p>
    );
}

export function stableTaskUrl(...values: Array<string | undefined>) {
    return values.find((value) => Boolean(value && !value.startsWith("data:") && !value.startsWith("blob:"))) || "";
}
