"use client";

import { type ReactNode } from "react";
import { Select } from "antd";
import { useTranslations } from "next-intl";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { audioFormatOptions, audioSpeedLabel, audioVoiceOptions, normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@/lib/audio-generation";
import { type CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";

const speedOptions = ["0.75", "1", "1.25", "1.5"];

type AudioSettingKey = "audioVoice" | "audioFormat" | "audioSpeed" | "audioInstructions";

type AudioSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: AudioSettingKey, value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function AudioSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: AudioSettingsPanelProps) {
    const t = useTranslations("create.sharedSettings");
    const voice = normalizeAudioVoiceValue(config.audioVoice);
    const format = normalizeAudioFormatValue(config.audioFormat);
    const speed = normalizeAudioSpeedValue(config.audioSpeed);
    const speedSelectOptions = speedOptions.map((value) => ({ value, label: audioSpeedLabel(value) }));

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("audioSettings")}</div> : null}
                <SettingGroup title={t("voice")} color={theme.node.muted}>
                    <AudioSelect value={voice} options={audioVoiceOptions} theme={theme} onChange={(value) => onConfigChange("audioVoice", value)} />
                </SettingGroup>
                <div className="grid grid-cols-2 gap-2.5">
                    <SettingGroup title={t("format")} color={theme.node.muted}>
                        <AudioSelect value={format} options={audioFormatOptions} theme={theme} onChange={(value) => onConfigChange("audioFormat", value)} />
                    </SettingGroup>
                    <SettingGroup title={t("speechSpeed")} color={theme.node.muted}>
                        <AudioSelect value={speed} options={speedSelectOptions} theme={theme} onChange={(value) => onConfigChange("audioSpeed", value)} />
                    </SettingGroup>
                </div>
                <SettingGroup title={t("voiceInstructions")} color={theme.node.muted}>
                    <textarea
                        value={config.audioInstructions || ""}
                        placeholder={t("voiceInstructionsPlaceholder")}
                        className="thin-scrollbar h-16 w-full resize-none rounded-xl border bg-transparent px-3 py-2 text-sm leading-5 outline-none"
                        style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                        onChange={(event) => onConfigChange("audioInstructions", event.target.value)}
                        onMouseDown={(event) => event.stopPropagation()}
                    />
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function AudioSelect({ value, options, theme, onChange }: { value: string; options: Array<{ value: string; label: string }>; theme: CanvasTheme; onChange: (value: string) => void }) {
    return (
        <span className="block [&_.ant-select]:w-full" onMouseDown={(event) => event.stopPropagation()}>
            <Select value={value} options={options} onChange={onChange} />
        </span>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}
