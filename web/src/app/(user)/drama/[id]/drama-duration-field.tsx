"use client";

import { InputNumber, Select } from "antd";

import { CapabilityControlTooltip } from "@/components/creative-generation-preference-fields";
import type { LogicalModelGenerationParameters } from "@/lib/auth/store-types";
import { checkDramaDuration, type DramaGenerationCapabilities } from "../drama-generation-capabilities";

export function DramaDurationField({ ariaLabel, value, parameters, className, onChange }: { ariaLabel: string; value: number; parameters?: LogicalModelGenerationParameters; className?: string; onChange: (value: number) => void }) {
    const state: DramaGenerationCapabilities = { videoParameters: parameters };
    const compatibility = checkDramaDuration(state, value);
    const reason = compatibility.compatible ? undefined : compatibility.reason;
    const customRange = parameters?.supportsCustomDuration ? parameters.customDurationRange : parameters?.durationMode === "range" ? parameters.durationRange : undefined;
    if (!customRange && parameters?.durationMode === "discrete" && parameters.durationSeconds.length) {
        const supported = parameters.durationSeconds.includes(value);
        const options = [...(!supported ? [{ value, label: `${value} 秒（当前不支持）`, disabled: true }] : []), ...parameters.durationSeconds.map((seconds) => ({ value: seconds, label: `${seconds} 秒` }))];
        return (
            <div className={className}>
                <CapabilityControlTooltip reason={reason} className="w-full">
                    <Select className="!w-full" aria-label={ariaLabel} aria-invalid={!compatibility.compatible} status={compatibility.compatible ? undefined : "error"} value={value} options={options} onChange={(next) => onChange(next)} />
                </CapabilityControlTooltip>
            </div>
        );
    }
    const editable = Boolean(customRange);
    return (
        <div className={className}>
            <CapabilityControlTooltip reason={reason} className="w-full">
                <InputNumber
                    className="!h-9 !w-full"
                    aria-label={ariaLabel}
                    aria-disabled={!editable}
                    aria-invalid={!compatibility.compatible}
                    disabled={!editable}
                    status={compatibility.compatible ? undefined : "error"}
                    step="any"
                    value={value}
                    onChange={(next) => {
                        if (typeof next !== "number") return;
                        if (checkDramaDuration(state, next).compatible) onChange(next);
                    }}
                />
            </CapabilityControlTooltip>
        </div>
    );
}
