"use client";

import { InputNumber, Space, Switch } from "antd";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export function VideoQualityField({ value, options, onChange }: { value: string; options: readonly { value: string; label: string; shortLabel?: string }[]; onChange: (value: string) => void }) {
    const t = useTranslations("create");
    const customSelected = !options.some((option) => option.value === value);
    const [draft, setDraft] = useState(customSelected ? value : "");

    useEffect(() => {
        setDraft(options.some((option) => option.value === value) ? "" : value);
    }, [options, value]);

    return (
        <div className="grid gap-1.5">
            <p className="text-[11px] font-medium text-[#7b8591] dark:text-[#98a2ae]">{t("definition")}</p>
            <div className="grid grid-cols-4 gap-1" role="group" aria-label={t("selectVideoDefinition")}>
                {options.map((option) => (
                    <OptionButton key={option.value} selected={value === option.value} label={option.shortLabel || option.label} ariaLabel={t("selectVideoDefinitionValue", { value: option.label })} onClick={() => onChange(option.value)} />
                ))}
            </div>
            <label
                className={cn(
                    "grid min-w-0 grid-cols-[1fr_auto] items-center rounded-lg border px-2 transition",
                    customSelected
                        ? "border-[#9bbdce] bg-[#f2f8fb] text-[#315d78] dark:border-[#557f96] dark:bg-[#20333d] dark:text-[#a8c8dc]"
                        : "border-[#dce2e7] bg-white text-[#687481] focus-within:border-[#7da6ba] focus-within:ring-2 focus-within:ring-[#7da6ba]/15 dark:border-[#3e4650] dark:bg-[#181b20] dark:text-[#a6afb9]",
                )}
            >
                <input
                    aria-label={t("enterCustomVideoDefinition")}
                    value={draft}
                    placeholder={t("customVideoDefinitionPlaceholder")}
                    onChange={(event) => {
                        const next = event.target.value;
                        setDraft(next);
                        const normalized = normalizeVideoQuality(next);
                        if (normalized) onChange(normalized);
                    }}
                    className="h-8 min-w-0 bg-transparent text-xs outline-none placeholder:text-[#aeb6be] dark:placeholder:text-[#697480]"
                />
                <span className="text-[10px] text-[#9aa4ae]">{t("suggestedValuesHint")}</span>
            </label>
        </div>
    );
}

export function SuggestedPositiveIntegerField({
    label,
    ariaLabel,
    value,
    suffix,
    options,
    onChange,
}: {
    label: string;
    ariaLabel: string;
    value: number;
    suffix: string;
    options: readonly { value: number; label: string }[];
    onChange: (value: number) => void;
}) {
    const t = useTranslations("create");
    const customSelected = !options.some((option) => option.value === value);
    return (
        <div className="grid gap-1.5">
            <p className="text-[11px] font-medium text-[#7b8591] dark:text-[#98a2ae]">{label}</p>
            <div className="grid grid-cols-[repeat(2,minmax(0,1fr))_minmax(0,1.35fr)] gap-1">
                {options.map((option) => (
                    <OptionButton key={option.value} selected={value === option.value} label={option.label} ariaLabel={`${ariaLabel} ${option.label}`} onClick={() => onChange(option.value)} />
                ))}
                <Space.Compact block className="min-w-0">
                    <InputNumber
                        aria-label={ariaLabel}
                        controls={false}
                        min={1}
                        value={customSelected ? value : null}
                        placeholder={t("custom")}
                        onChange={(next) => {
                            const normalized = normalizePositiveInteger(next);
                            if (normalized) onChange(normalized);
                        }}
                        className="min-w-0 flex-1"
                    />
                    <Space.Addon>{suffix}</Space.Addon>
                </Space.Compact>
            </div>
        </div>
    );
}

export function PositiveNumberField({ className, label, ariaLabel, value, suffix, onChange }: { className?: string; label: string; ariaLabel: string; value: number; suffix: string; onChange: (value: number) => void }) {
    return (
        <label className={cn("grid min-w-0 gap-0.5 rounded-lg bg-[#f5f6f7] px-2 py-1 text-[10px] text-[#8b949f] dark:bg-[#24282e] dark:text-[#7f8996]", className)}>
            {label}
            <Space.Compact block className="min-w-0">
                <InputNumber
                    aria-label={ariaLabel}
                    controls={false}
                    value={value}
                    onChange={(next) => {
                        const normalized = normalizePositiveNumber(next);
                        if (normalized) onChange(normalized);
                    }}
                    className="min-w-0 flex-1"
                />
                <Space.Addon>{suffix}</Space.Addon>
            </Space.Compact>
        </label>
    );
}

export function SwitchPreference({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <label className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-[#f5f6f7] px-2.5 py-2 text-[11px] font-medium text-[#687481] dark:bg-[#24282e] dark:text-[#a6afb9]">
            <span>{label}</span>
            <Switch size="small" checked={checked} onChange={onChange} aria-label={label} />
        </label>
    );
}

export function normalizeVideoQuality(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

export function normalizePositiveInteger(value: unknown) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

export function normalizePositiveNumber(value: unknown) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function OptionButton({ selected, label, ariaLabel, onClick }: { selected: boolean; label: string; ariaLabel: string; onClick: () => void }) {
    return (
        <button
            type="button"
            className={cn(
                "h-8 min-w-0 rounded-lg px-1 text-[11px] transition",
                selected
                    ? "bg-[#eaf1f5] font-medium text-[#315d78] dark:bg-[#2a3b46] dark:text-[#a8c8dc]"
                    : "bg-[#f5f6f7] text-[#687481] hover:bg-[#edf0f2] hover:text-[#20242a] dark:bg-[#24282e] dark:text-[#a6afb9] dark:hover:bg-[#30363e] dark:hover:text-white",
            )}
            onClick={onClick}
            aria-label={ariaLabel}
            aria-pressed={selected}
        >
            {label}
        </button>
    );
}
