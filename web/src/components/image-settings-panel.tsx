"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { ConfigProvider } from "antd";
import { useTranslations } from "next-intl";

import { type CanvasTheme } from "@/lib/canvas-theme";
import { parseImageDimensions } from "@/lib/image-size";
import type { AiConfig } from "@/stores/use-config-store";

const qualityOptions = ["auto", "high", "medium", "low"];
const aspectOptions = [
    { value: "1:1", label: "1:1", width: 1024, height: 1024, icon: "square" },
    { value: "3:2", label: "3:2", width: 1536, height: 1024, icon: "landscape" },
    { value: "2:3", label: "2:3", width: 1024, height: 1536, icon: "portrait" },
    { value: "4:3", label: "4:3", width: 1360, height: 1024, icon: "landscape" },
    { value: "3:4", label: "3:4", width: 1024, height: 1360, icon: "portrait" },
    { value: "16:9", label: "16:9", width: 1824, height: 1024, icon: "landscape" },
    { value: "9:16", label: "9:16", width: 1024, height: 1824, icon: "portrait" },
    { value: "1:1-2k", label: "1:1(2k)", size: "2048x2048", width: 2048, height: 2048, icon: "square" },
    { value: "16:9-2k", label: "16:9(2k)", size: "2048x1152", width: 2048, height: 1152, icon: "landscape" },
    { value: "9:16-2k", label: "9:16(2k)", size: "1152x2048", width: 1152, height: 2048, icon: "portrait" },
    { value: "16:9-4k", label: "16:9(4k)", size: "3840x2160", width: 3840, height: 2160, icon: "landscape" },
    { value: "9:16-4k", label: "9:16(4k)", size: "2160x3840", width: 2160, height: 3840, icon: "portrait" },
    { value: "auto", label: "auto", width: 0, height: 0, icon: "auto" },
];

type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "quality" | "size" | "count", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    maxCount?: number;
    quickCount?: number;
    showSizeControls?: boolean;
};

export function ImageSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", maxCount, quickCount = 4, showSizeControls = true }: ImageSettingsPanelProps) {
    const t = useTranslations("create.sharedSettings");
    const quality = config.quality || "auto";
    const count = positiveInteger(config.count);

    return (
        <ImageSettingsTheme theme={theme}>
            <div
                className={className}
                style={{ color: theme.node.text }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.target instanceof HTMLInputElement) return;
                    if (document.activeElement instanceof HTMLInputElement && event.currentTarget.contains(document.activeElement)) document.activeElement.blur();
                }}
            >
                {showTitle ? <div className="text-lg font-semibold">{t("imageSettings")}</div> : null}
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>{t("quality")}</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {qualityOptions.map((item) => (
                            <OptionPill key={item} selected={quality === item} theme={theme} onClick={() => onConfigChange("quality", item)}>
                                {t(item)}
                            </OptionPill>
                        ))}
                    </div>
                </div>
                {showSizeControls ? <ImageSizeControls size={config.size || "auto"} onChange={(value) => onConfigChange("size", value)} theme={theme} /> : null}
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>{t("generationCount")}</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        <OptionPill selected={count === undefined} theme={theme} onClick={() => onConfigChange("count", "auto")}>
                            {t("smart")}
                        </OptionPill>
                        {Array.from({ length: quickCount }, (_, index) => index + 1)
                            .filter((value) => maxCount === undefined || value <= maxCount)
                            .map((value) => (
                                <OptionPill key={value} selected={count === value} theme={theme} onClick={() => onConfigChange("count", String(value))}>
                                    {t("imageCount", { count: value })}
                                </OptionPill>
                            ))}
                        <CountInput value={count} max={maxCount} theme={theme} onChange={(value) => onConfigChange("count", value === null ? "auto" : String(value))} />
                    </div>
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

export function ImageSizeControls({ size, onChange, theme, compact = false }: { size: string; onChange: (value: string) => void; theme: CanvasTheme; compact?: boolean }) {
    const t = useTranslations("create.sharedSettings");
    const activeSize = size || "auto";
    const selectedAspect = aspectOptions.find((item) => imagePresetSize(item.value) === activeSize || item.value === activeSize);
    const dimensions = readSizeDimensions(activeSize, selectedAspect || aspectOptions[0]);
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = positiveInteger(value) || dimensions[key];
        const width = key === "width" ? next : dimensions.width;
        const height = key === "height" ? next : dimensions.height;
        if (positiveInteger(width) && positiveInteger(height)) onChange(`${width}x${height}`);
    };

    return (
        <div className="space-y-3">
            <div className="space-y-2.5">
                <SettingTitle color={theme.node.muted}>{t("size")}</SettingTitle>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                    <DimensionInput prefix="W" value={dimensions.width} theme={theme} onChange={(value) => updateDimension("width", value)} onCommit={(value) => updateDimension("width", value)} />
                    <span className="text-lg opacity-45">×</span>
                    <DimensionInput prefix="H" value={dimensions.height} theme={theme} onChange={(value) => updateDimension("height", value)} onCommit={(value) => updateDimension("height", value)} />
                </div>
            </div>
            <div className="space-y-2.5">
                <SettingTitle color={theme.node.muted}>{t("aspectRatio")}</SettingTitle>
                <div className={compact ? "grid grid-cols-4 gap-2" : "grid grid-cols-4 gap-2.5"}>
                    {aspectOptions.map((item) => (
                        <button
                            key={item.value}
                            type="button"
                            className={
                                compact
                                    ? "flex h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border bg-transparent text-xs transition hover:opacity-80"
                                    : "flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                            }
                            style={{ borderColor: selectedAspect?.value === item.value ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={() => onChange(imagePresetSize(item.value))}
                        >
                            <AspectIcon type={item.icon} width={item.width} height={item.height} color={theme.node.text} />
                            <span>{item.label}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: { colorBgContainer: theme.toolbar.panel, colorBgElevated: theme.toolbar.panel, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel },
                components: { Button: { defaultBg: theme.toolbar.panel, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text } },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function DimensionInput({ prefix, value, theme, onChange, onCommit }: { prefix: string; value: number; theme: CanvasTheme; onChange: (value: number | null) => void; onCommit: (value: number | null) => void }) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [draft, setDraft] = useState(String(value || ""));
    useEffect(() => {
        if (document.activeElement !== inputRef.current) setDraft(String(value || ""));
    }, [value]);
    const commit = (input: HTMLInputElement) => {
        const next = positiveInteger(input.value) || value;
        setDraft(String(next));
        onCommit(next);
    };

    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input
                ref={inputRef}
                type="number"
                min={1}
                className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                value={draft}
                onChange={(event) => {
                    setDraft(event.target.value);
                    const next = positiveInteger(event.target.value);
                    if (next) onChange(next);
                }}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

export function imagePresetSize(value: string) {
    const option = aspectOptions.find((item) => item.value === value);
    if (!option || option.value === "auto") return option?.value || value;
    return option.size || `${option.width}x${option.height}`;
}

function CountInput({ value, max, theme, onChange }: { value?: number; max?: number; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="col-span-2 flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input
                type="number"
                min={1}
                max={max}
                className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                value={value || ""}
                onChange={(event) => onChange(Number(event.target.value) || null)}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function AspectIcon({ type, width, height, color }: { type: string; width: number; height: number; color: string }) {
    if (type === "auto") return null;
    const ratio = width / Math.max(1, height);
    const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
    const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;
    return (
        <span className="grid h-7 w-9 place-items-center">
            <span className="border-2" style={{ width: boxWidth, height: boxHeight, borderColor: color }} />
        </span>
    );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}

function readSizeDimensions(size: string, fallback: { width: number; height: number }) {
    const dimensions = parseImageDimensions(size);
    return {
        width: dimensions?.width || fallback.width,
        height: dimensions?.height || fallback.height,
    };
}

function positiveInteger(value: unknown) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
