"use client";

import { useLocale, useTranslations } from "next-intl";

import type { AppLocale } from "@/i18n/config";
import type { CreativeGenerationMode } from "@/lib/creative-runtime-contract";
import type { CreativeAgentRun } from "@/services/api/creative";

export type CreativeRunPresentationItem = { key: string; label: string; value: string };
export type CreativeRunPresentationCopy = {
    labels: Record<"mode" | "model" | "size" | "ratio" | "quality" | "definition" | "duration" | "voice" | "format" | "count" | "status", string>;
    modes: Record<CreativeGenerationMode, string>;
    qualities: Record<string, string>;
    statuses: Record<CreativeAgentRun["status"], string>;
    seconds: (value: number) => string;
    resultCount: (value: number) => string;
};

export function creativeRunPresentation(run: CreativeAgentRun | undefined, modelNames: ReadonlyMap<string, string>, copy: CreativeRunPresentationCopy) {
    if (!run) return [];
    const mode = creativeRunMode(run);
    const tasks = mode ? run.tasks.filter((task) => task.type === mode) : run.tasks;
    const preferences = mode ? run.generationPreferences?.[mode] : undefined;
    const items: CreativeRunPresentationItem[] = [];
    if (mode) items.push({ key: "mode", label: copy.labels.mode, value: copy.modes[mode] });

    const modelIds = uniqueText([...tasks.map((task) => task.model), ...(run.requestedModelIds || [])]);
    if (modelIds.length) items.push({ key: "model", label: copy.labels.model, value: modelIds.map((id) => modelNames.get(id) || id).join(" + ") });

    const size = firstText(tasks.map((task) => task.ratio)) || (preferences && "size" in preferences ? preferences.size : undefined);
    if (size) items.push({ key: "size", label: mode === "video" ? copy.labels.ratio : copy.labels.size, value: size });

    const quality = firstText(tasks.map((task) => task.quality)) || (preferences && "quality" in preferences ? preferences.quality : undefined);
    if (quality) items.push({ key: "quality", label: mode === "video" ? copy.labels.definition : copy.labels.quality, value: copy.qualities[quality.toLowerCase()] || quality });

    const seconds = firstNumber(tasks.map((task) => task.seconds)) || (preferences && "seconds" in preferences ? preferences.seconds : undefined);
    if (seconds) items.push({ key: "seconds", label: copy.labels.duration, value: copy.seconds(seconds) });

    const voice = firstText(tasks.map((task) => task.voice)) || (preferences && "voice" in preferences ? preferences.voice : undefined);
    if (voice) items.push({ key: "voice", label: copy.labels.voice, value: voice });
    const format = firstText(tasks.map((task) => task.format)) || (preferences && "format" in preferences ? preferences.format : undefined);
    if (format) items.push({ key: "format", label: copy.labels.format, value: format.toUpperCase() });

    const count = tasks.reduce((total, task) => total + (task.count || 1), 0);
    if (count > 1) items.push({ key: "count", label: copy.labels.count, value: copy.resultCount(count) });
    items.push({ key: "status", label: copy.labels.status, value: copy.statuses[run.status] });
    return items;
}

export function creativeRunDuration(run: CreativeAgentRun | undefined, locale: AppLocale = "zh-CN") {
    const startedAt = Number(run?.createdAt);
    const finishedAt = Number(run?.updatedAt);
    if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt <= startedAt) return "";
    const totalSeconds = Math.max(1, Math.round((finishedAt - startedAt) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const values: string[] = [];
    if (hours) values.push(new Intl.NumberFormat(locale, { style: "unit", unit: "hour", unitDisplay: "short" }).format(hours));
    if (minutes) values.push(new Intl.NumberFormat(locale, { style: "unit", unit: "minute", unitDisplay: "short" }).format(minutes));
    if (!hours && seconds) values.push(new Intl.NumberFormat(locale, { style: "unit", unit: "second", unitDisplay: "short" }).format(seconds));
    return values.join(locale === "zh-CN" ? "" : " ");
}

export function creativeRunMode(run: CreativeAgentRun | undefined): CreativeGenerationMode | undefined {
    const taskMode = run?.tasks.find((task) => task.type === "image" || task.type === "video" || task.type === "audio")?.type;
    return taskMode === "image" || taskMode === "video" || taskMode === "audio" ? taskMode : run?.generationPreferences?.mode;
}

export function useCreativeRunPresentation(run: CreativeAgentRun | undefined, modelNames: ReadonlyMap<string, string>) {
    const t = useTranslations("create");
    return creativeRunPresentation(run, modelNames, {
        labels: {
            mode: t("type"),
            model: t("model"),
            size: t("size"),
            ratio: t("ratio"),
            quality: t("imageQuality"),
            definition: t("definition"),
            duration: t("duration"),
            voice: t("voice"),
            format: t("format"),
            count: t("quantity"),
            status: t("status"),
        },
        modes: { image: t("modeImage"), video: t("modeVideo"), audio: t("modeAudio") },
        qualities: { auto: t("smart"), high: t("highImageQuality"), medium: t("standard"), low: t("fast") },
        statuses: { planning: t("statusPlanning"), running: t("generating"), paused: t("statusPaused"), completed: t("statusCompleted"), cancelled: t("statusCancelled"), failed: t("statusFailed") },
        seconds: (value) => t("secondsCompact", { value }),
        resultCount: (value) => t("resultCount", { count: value }),
    });
}

export function useCreativeRunDuration(run: CreativeAgentRun | undefined) {
    return creativeRunDuration(run, useLocale() as AppLocale);
}

function uniqueText(values: Array<string | undefined>) {
    return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function firstText(values: Array<string | undefined>) {
    return values.find((value) => Boolean(value?.trim()))?.trim();
}

function firstNumber(values: Array<number | undefined>) {
    return values.find((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
}
