"use client";

import { InputNumber, Space, Switch, Tooltip } from "antd";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export function CapabilityControlTooltip({ reason, children, className }: { reason?: string; children: ReactNode; className?: string }) {
    if (!reason) return children;
    return (
        <Tooltip title={reason} trigger={["hover", "focus", "click"]}>
            <span data-capability-tooltip="true" tabIndex={0} role="note" aria-label={reason} className={cn("inline-flex min-w-0", className)}>
                {children}
            </span>
        </Tooltip>
    );
}

export function VideoQualityField({
    value,
    options,
    customOptions = [],
    showCustom = true,
    disabledReason,
    onChange,
}: {
    value?: string;
    options: readonly { value: string; label: string; shortLabel?: string; supported?: boolean }[];
    customOptions?: readonly string[];
    showCustom?: boolean;
    disabledReason?: string;
    onChange: (value?: string) => void;
}) {
    const t = useTranslations("create");
    const customSelected = Boolean(value && !options.some((option) => option.value === value));
    const [customOpen, setCustomOpen] = useState(customSelected);
    const [customValue, setCustomValue] = useState<string>(customSelected ? value || "" : "");

    useEffect(() => {
        if (!customSelected) return;
        setCustomOpen(true);
        setCustomValue(value || "");
    }, [customSelected, value]);

    const customInvalid = Boolean(customValue.trim() && !customOptions.includes(customValue.trim()));

    return (
        <div className="grid gap-1.5">
            <p className="text-[11px] font-medium text-[#7b8591] dark:text-[#98a2ae]">{t("definition")}</p>
            <div className="grid grid-cols-4 gap-1" role="group" aria-label={t("selectVideoDefinition")}>
                {options.map((option) => (
                    <OptionButton
                        key={option.value}
                        selected={(value || "auto") === option.value}
                        label={option.shortLabel || option.label}
                        ariaLabel={t("selectVideoDefinitionValue", { value: option.label })}
                        disabled={option.value !== "auto" && option.supported === false}
                        disabledReason={disabledReason}
                        onClick={() => onChange(option.value === "auto" ? undefined : option.value)}
                    />
                ))}
                {showCustom ? (
                    <OptionButton selected={customSelected} label={t("custom")} ariaLabel={t("selectVideoDefinitionValue", { value: t("custom") })} disabled={!customOptions.length} disabledReason={disabledReason} onClick={() => setCustomOpen(true)} />
                ) : null}
            </div>
            {showCustom && customOpen ? (
                <label className={cn("grid min-w-0 gap-1 rounded-lg border px-2 py-1", customInvalid ? "border-red-300 dark:border-red-700" : "border-[#dce2e7] focus-within:border-[#7da6ba] dark:border-[#3e4650]")}>
                    <input
                        aria-label={t("enterCustomVideoDefinition")}
                        aria-invalid={customInvalid}
                        value={customValue}
                        placeholder={t("customVideoDefinitionPlaceholder")}
                        onChange={(event) => {
                            const next = event.target.value;
                            setCustomValue(next);
                            const normalized = next.trim();
                            if (customOptions.includes(normalized)) onChange(normalized);
                        }}
                        className="h-8 min-w-0 bg-transparent text-xs outline-none placeholder:text-[#aeb6be] dark:placeholder:text-[#697480]"
                    />
                    {customInvalid ? <span className="text-[10px] text-red-600 dark:text-red-400">{disabledReason}</span> : null}
                </label>
            ) : null}
        </div>
    );
}

export function SuggestedPositiveIntegerField({
    label,
    ariaLabel,
    value,
    suffix,
    options,
    min,
    max,
    customEnabled,
    disabledReason,
    onChange,
}: {
    label: string;
    ariaLabel: string;
    value?: number;
    suffix: string;
    options: readonly { value: number; label: string; supported?: boolean }[];
    min?: number;
    max?: number;
    customEnabled: boolean;
    disabledReason?: string;
    onChange: (value?: number) => void;
}) {
    const t = useTranslations("create");
    const customSelected = value !== undefined && !options.some((option) => option.value === value);
    return (
        <div className="grid gap-1.5">
            <p className="text-[11px] font-medium text-[#7b8591] dark:text-[#98a2ae]">{label}</p>
            <div className="grid gap-1" role="group" aria-label={label} style={{ gridTemplateColumns: options.length ? `repeat(${options.length}, minmax(0, 1fr)) minmax(0, 1.35fr)` : "minmax(0, 1fr)" }}>
                {options.map((option) => (
                    <OptionButton
                        key={option.value}
                        selected={value === option.value}
                        label={option.label}
                        ariaLabel={`${ariaLabel} ${option.label}`}
                        disabled={option.supported === false}
                        disabledReason={disabledReason}
                        onClick={() => onChange(option.value)}
                    />
                ))}
                <CapabilityControlTooltip reason={customEnabled ? undefined : disabledReason} className="w-full">
                    <Space.Compact block className="min-w-0">
                        <InputNumber
                            aria-label={ariaLabel}
                            aria-disabled={!customEnabled}
                            disabled={!customEnabled}
                            controls={false}
                            step="any"
                            value={customSelected ? value : null}
                            placeholder={t("custom")}
                            onChange={(next) => {
                                const normalized = normalizePositiveNumber(next);
                                if (normalized && (min === undefined || normalized >= min) && (max === undefined || normalized <= max)) onChange(normalized);
                            }}
                            className="min-w-0 flex-1"
                        />
                        <Space.Addon>{suffix}</Space.Addon>
                    </Space.Compact>
                </CapabilityControlTooltip>
            </div>
        </div>
    );
}

export function PositiveNumberField({
    className,
    label,
    ariaLabel,
    value,
    suffix,
    min,
    max,
    enabled,
    disabledReason,
    onChange,
}: {
    className?: string;
    label: string;
    ariaLabel: string;
    value?: number;
    suffix: string;
    min?: number;
    max?: number;
    enabled: boolean;
    disabledReason?: string;
    onChange: (value?: number) => void;
}) {
    const t = useTranslations("create");
    return (
        <div className={cn("grid min-w-0 grid-cols-[auto_1fr] items-center gap-1 rounded-lg bg-[#f5f6f7] p-1 text-[10px] text-[#8b949f] dark:bg-[#24282e] dark:text-[#7f8996]", className)}>
            <button type="button" className="h-8 rounded-md px-2 text-[11px]" aria-pressed={value === undefined} onClick={() => onChange(undefined)}>
                {label} · {t("smart")}
            </button>
            <CapabilityControlTooltip reason={enabled ? undefined : disabledReason} className="w-full">
                <Space.Compact block className="min-w-0">
                    <InputNumber
                        aria-label={ariaLabel}
                        aria-disabled={!enabled}
                        disabled={!enabled}
                        controls={false}
                        step="any"
                        value={value}
                        placeholder={t("smart")}
                        onChange={(next) => {
                            const normalized = normalizePositiveNumber(next);
                            if (normalized && (min === undefined || normalized >= min) && (max === undefined || normalized <= max)) onChange(normalized);
                        }}
                        className="min-w-0 flex-1"
                    />
                    <Space.Addon>{suffix}</Space.Addon>
                </Space.Compact>
            </CapabilityControlTooltip>
        </div>
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

function OptionButton({ selected, label, ariaLabel, disabled = false, disabledReason, onClick }: { selected: boolean; label: string; ariaLabel: string; disabled?: boolean; disabledReason?: string; onClick: () => void }) {
    const button = (
        <button
            type="button"
            className={cn(
                "h-8 min-w-0 flex-1 rounded-lg px-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-40",
                selected
                    ? "bg-[#eaf1f5] font-medium text-[#315d78] dark:bg-[#2a3b46] dark:text-[#a8c8dc]"
                    : "bg-[#f5f6f7] text-[#687481] hover:bg-[#edf0f2] hover:text-[#20242a] dark:bg-[#24282e] dark:text-[#a6afb9] dark:hover:bg-[#30363e] dark:hover:text-white",
            )}
            disabled={disabled}
            aria-disabled={disabled}
            onClick={onClick}
            aria-label={ariaLabel}
            aria-pressed={selected}
        >
            {label}
        </button>
    );
    return (
        <CapabilityControlTooltip reason={disabled ? disabledReason : undefined} className="w-full">
            {button}
        </CapabilityControlTooltip>
    );
}
