"use client";

import { Button, Select, Spin } from "antd";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import type { VoiceSelection } from "@/lib/voice-selection";
import { fetchPresetVoices, fetchVoiceProfiles, voiceSelectionKey, type PublicVoiceProfile } from "@/services/api/voice-profiles";

const presetCache = new Map<string, Array<{ id: string; name: string }>>();

export function VoiceSelector({ model, value, onChange, disabled, className }: { model: string; value?: VoiceSelection | null; onChange: (value: VoiceSelection) => void; disabled?: boolean; className?: string }) {
    const t = useTranslations("voices.selector");
    const [presets, setPresets] = useState<Array<{ id: string; name: string }>>(() => presetCache.get(model) || []);
    const [profiles, setProfiles] = useState<PublicVoiceProfile[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [loadedModel, setLoadedModel] = useState("");
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let active = true;
        setPresets(presetCache.get(model) || []);
        setLoading(true);
        setError("");
        Promise.all([presetCache.has(model) ? Promise.resolve({ voices: presetCache.get(model)! }) : fetchPresetVoices(model), fetchVoiceProfiles({ status: "ready", pageSize: 100 })])
            .then(([catalog, mine]) => {
                if (!active) return;
                presetCache.set(model, catalog.voices);
                setPresets(catalog.voices);
                setProfiles(mine.items);
                setLoadedModel(model);
            })
            .catch((cause) => active && setError(cause instanceof Error ? cause.message : t("loadFailed")))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [model, reloadKey, t]);

    useEffect(() => {
        if (loadedModel !== model || !value || value.type !== "preset" || presets.some((preset) => preset.id === value.voiceId) || !presets[0]) return;
        onChange({ type: "preset", voiceId: presets[0].id });
    }, [loadedModel, model, onChange, presets, value]);

    const options = useMemo(
        () => [
            { label: t("platformVoices"), options: presets.map((voice) => ({ value: `preset:${voice.id}`, label: voice.name })) },
            { label: t("myVoices"), options: profiles.map((profile) => ({ value: `profile:${profile.id}`, label: profile.name })) },
        ],
        [presets, profiles, t],
    );
    const selected = value ? voiceSelectionKey(value) : undefined;

    return (
        <div className={className}>
            <Select
                className="w-full"
                value={selected}
                disabled={disabled}
                loading={loading}
                status={error ? "error" : undefined}
                placeholder={loading ? t("loading") : t("placeholder")}
                notFoundContent={
                    loading ? (
                        <Spin size="small" />
                    ) : error ? (
                        <Button type="link" size="small" onClick={() => setReloadKey((current) => current + 1)}>
                            {t("retry")}
                        </Button>
                    ) : (
                        t("empty")
                    )
                }
                options={options}
                onChange={(key) => {
                    const [type, ...parts] = key.split(":");
                    const id = parts.join(":");
                    if (type === "preset") onChange({ type: "preset", voiceId: id });
                    if (type === "profile") onChange({ type: "profile", voiceProfileId: id });
                }}
                aria-label={t("ariaLabel")}
            />
            <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-[#7b8591] dark:text-[#98a2ae]">
                <span>{error || (!profiles.length && !loading ? t("noClonedVoices") : "")}</span>
                <Button href="/voices" type="link" size="small" className="!h-auto !p-0">
                    {t("manage")}
                </Button>
            </div>
        </div>
    );
}
