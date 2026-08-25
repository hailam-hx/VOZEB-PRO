"use client";

import { useFormatter, useTranslations } from "next-intl";

import type { TopUpPreset } from "@/services/api/billing";

export function TopUpPresetGrid({
    presets,
    selectedPresetId,
    customSelected,
    onSelectPreset,
    onSelectCustom,
}: {
    presets: TopUpPreset[];
    selectedPresetId?: string;
    customSelected: boolean;
    onSelectPreset: (preset: TopUpPreset) => void;
    onSelectCustom: () => void;
}) {
    const t = useTranslations("billing.topUp");
    const format = useFormatter();
    const buttonClass = "min-w-0 rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 sm:p-4";
    return (
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {presets.map((preset) => {
                const selected = preset.id === selectedPresetId && !customSelected;
                return (
                    <button
                        key={preset.id}
                        type="button"
                        data-top-up-preset={preset.id}
                        aria-pressed={selected}
                        className={`${buttonClass} ${selected ? "border-sky-500 bg-sky-50 text-sky-950 dark:border-sky-400 dark:bg-sky-950/35 dark:text-sky-100" : "border-stone-200 bg-white text-stone-950 hover:border-stone-300 hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-100 dark:hover:border-stone-700 dark:hover:bg-stone-900"}`}
                        onClick={() => onSelectPreset(preset)}
                    >
                        <span className="block truncate text-sm font-semibold">{preset.name}</span>
                        <span className="mt-1 block text-base font-semibold tabular-nums">{format.number(Number(preset.nominalNativeAmount), { style: "currency", currency: "VND", maximumFractionDigits: 0 })}</span>
                        {preset.description ? <span className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500 dark:text-stone-400">{preset.description}</span> : null}
                    </button>
                );
            })}
            <button
                type="button"
                data-top-up-custom="true"
                aria-pressed={customSelected}
                className={`${buttonClass} ${customSelected ? "border-sky-500 bg-sky-50 text-sky-950 dark:border-sky-400 dark:bg-sky-950/35 dark:text-sky-100" : "border-dashed border-stone-300 bg-stone-50 text-stone-700 hover:border-stone-400 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-200 dark:hover:border-stone-600"}`}
                onClick={onSelectCustom}
            >
                <span className="block text-sm font-semibold">{t("customAmount")}</span>
                <span className="mt-1 block text-xs leading-5 text-stone-500 dark:text-stone-400">{t("customAmountDescription")}</span>
            </button>
        </div>
    );
}
