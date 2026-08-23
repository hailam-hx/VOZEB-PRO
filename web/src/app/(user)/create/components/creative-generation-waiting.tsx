"use client";

import { Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import type { CreativeMessage } from "@/lib/creative-runtime-contract";
import type { AppLocale } from "@/i18n/config";
import type { CreativeAgentRun } from "@/services/api/creative";

import { creativeRunMode } from "./creative-run-presentation";

const LONG_WAIT_MESSAGE_KEYS = ["waitingVeryLongGenericOne", "waitingVeryLongGenericTwo", "waitingVeryLongGenericThree"] as const;

export function CreativeGenerationWaiting({ run, message }: { run?: CreativeAgentRun; message: Pick<CreativeMessage, "content" | "createdAt"> }) {
    const t = useTranslations("create");
    const locale = useLocale() as AppLocale;
    const startedAt = run?.createdAt || message.createdAt;
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const update = () => setNow(Date.now());
        update();
        const timer = window.setInterval(update, 1000);
        return () => window.clearInterval(timer);
    }, [startedAt]);

    const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
    const copy = t(creativeGenerationWaitingMessageKey({ mode: creativeRunMode(run), runStatus: run?.status, progressText: message.content, elapsedSeconds }));

    return (
        <div data-testid="creative-generation-waiting" className="mb-3 max-w-[520px] py-1 text-[#667085] dark:text-[#a0a9b4]">
            <div className="flex items-start gap-2.5">
                <Sparkles className="mt-1 size-4 shrink-0 animate-pulse text-primary/75" aria-hidden />
                <div className="min-w-0">
                    <p className="text-sm leading-6 text-[#596474] dark:text-[#b0b8c2]" aria-live="polite">
                        {copy}
                    </p>
                    <p data-testid="creative-generation-elapsed" className="mt-0.5 text-[11px] tabular-nums leading-4 text-[#98a2b3] dark:text-[#7f8996]">
                        {t("waitedFor", { duration: formatCreativeWaitingTime(elapsedSeconds, locale) })}
                    </p>
                </div>
            </div>
        </div>
    );
}

export function creativeGenerationWaitingMessageKey({ mode, runStatus, progressText, elapsedSeconds }: { mode?: "text" | "image" | "video" | "audio"; runStatus?: CreativeAgentRun["status"]; progressText: string; elapsedSeconds: number }) {
    const progress = progressText.trim();
    if (runStatus === "paused" || /任务已暂停/.test(progress)) return "waitingPaused";
    if (/连接暂时中断|无法确认实时状态/.test(progress)) return "waitingConnectionUnstable";
    if (/连接已恢复|恢复连接/.test(progress)) return "waitingConnectionRestored";
    if (/检查完成|正在整理|创作结果/.test(progress)) return "waitingFinishing";

    const activeTask = /正在处理|上游处理中|创作任务|重新生成|正在优化/.test(progress);
    if (!activeTask && (runStatus === "planning" || /理解需求|匹配创作技能|方案已确定|创建任务/.test(progress))) return planningMessageKey(mode);

    const elapsedMinutes = Math.floor(Math.max(0, elapsedSeconds) / 60);
    if (elapsedMinutes === 0) {
        if (mode === "image") return "waitingImageInitial";
        if (mode === "video") return "waitingVideoInitial";
        if (mode === "audio") return "waitingAudioInitial";
        return "waitingTextInitial";
    }
    if (elapsedMinutes === 1) return longWaitMessageKey(mode, false);
    return longWaitMessageKey(mode, true, LONG_WAIT_MESSAGE_KEYS[(elapsedMinutes - 2) % LONG_WAIT_MESSAGE_KEYS.length]);
}

function planningMessageKey(mode?: "text" | "image" | "video" | "audio") {
    if (mode === "image") return "waitingImagePlanning" as const;
    if (mode === "video") return "waitingVideoPlanning" as const;
    if (mode === "audio") return "waitingAudioPlanning" as const;
    return "waitingTextPlanning" as const;
}

function longWaitMessageKey(mode: "text" | "image" | "video" | "audio" | undefined, veryLong: boolean, fallback: (typeof LONG_WAIT_MESSAGE_KEYS)[number] = "waitingVeryLongGenericOne") {
    if (veryLong) {
        if (mode === "image") return "waitingImageVeryLong" as const;
        if (mode === "video") return "waitingVideoVeryLong" as const;
        if (mode === "audio") return "waitingAudioVeryLong" as const;
        return fallback;
    }
    if (mode === "image") return "waitingImageLong" as const;
    if (mode === "video") return "waitingVideoLong" as const;
    if (mode === "audio") return "waitingAudioLong" as const;
    return "waitingTextLong" as const;
}

export function formatCreativeWaitingTime(elapsedSeconds: number, locale: AppLocale = "zh-CN") {
    const totalSeconds = Math.max(0, Math.floor(elapsedSeconds));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const values: string[] = [];
    if (hours) values.push(new Intl.NumberFormat(locale, { style: "unit", unit: "hour", unitDisplay: "short" }).format(hours));
    if (minutes) values.push(new Intl.NumberFormat(locale, { style: "unit", unit: "minute", unitDisplay: "short" }).format(minutes));
    if (seconds || !values.length) values.push(new Intl.NumberFormat(locale, { style: "unit", unit: "second", unitDisplay: "short" }).format(seconds));
    return values.join(locale === "zh-CN" ? "" : " ");
}
