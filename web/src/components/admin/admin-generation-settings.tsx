"use client";

import { App, AutoComplete, Input, InputNumber, Select } from "antd";
import { CircleGauge, SlidersHorizontal, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { AuthSettings } from "@/lib/auth/store";
import { generationDefaultCapabilities, generationDefaultImageSizeOptions, generationDefaultsValidationError, resetIncompatibleGenerationDefaults } from "@/lib/generation-defaults-validation";
import { resolveLogicalModelConfig } from "@/lib/model-routing-config";
import { LabeledControl, SectionTitle } from "@/components/admin/admin-settings-controls";

const settingsPanelSurfaceClass = "rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950";

export type AgentReadiness = {
    ready: boolean;
    capabilities: Array<{ type: "text" | "image" | "video" | "audio"; model: string; ready: boolean; message: string }>;
    skills: Record<"image" | "video" | "canvas" | "drama", number>;
};

export function generationDefaultsPanelState(settings: AuthSettings) {
    const capabilities = generationDefaultCapabilities(settings);
    const imageSizeCapability = generationDefaultImageSizeOptions(settings);
    return {
        capabilities,
        imageSizeOptions: [{ value: "auto", label: "自动" }, ...imageSizeCapability.options.map((value) => ({ value, label: value }))],
        imageSizeCustomSupported: imageSizeCapability.supportsCustomSize,
        resets: resetIncompatibleGenerationDefaults(settings),
    };
}

export function GenerationConcurrencyPanel({ settings, onChange }: { settings: AuthSettings; onChange: (key: keyof AuthSettings["generationConcurrency"], value: number | null) => void }) {
    return (
        <div className={settingsPanelSurfaceClass}>
            <SectionTitle icon={<Sparkles className="size-4" />} title="每用户并发上限" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <LabeledControl label="Agent 同时运行">
                    <InputNumber className="w-full" min={1} precision={0} value={settings.generationConcurrency.agent} onChange={(value) => onChange("agent", value)} />
                </LabeledControl>
                <LabeledControl label="生图同时生成">
                    <InputNumber className="w-full" min={1} precision={0} value={settings.generationConcurrency.image} onChange={(value) => onChange("image", value)} />
                </LabeledControl>
                <LabeledControl label="视频同时生成">
                    <InputNumber className="w-full" min={1} precision={0} value={settings.generationConcurrency.video} onChange={(value) => onChange("video", value)} />
                </LabeledControl>
                <LabeledControl label="音频同时生成">
                    <InputNumber className="w-full" min={1} precision={0} value={settings.generationConcurrency.audio} onChange={(value) => onChange("audio", value)} />
                </LabeledControl>
                <LabeledControl label="文本同时生成">
                    <InputNumber className="w-full" min={1} precision={0} value={settings.generationConcurrency.text} onChange={(value) => onChange("text", value)} />
                </LabeledControl>
                <LabeledControl label="整集合成同时运行">
                    <InputNumber className="w-full" min={1} precision={0} value={settings.generationConcurrency.render} onChange={(value) => onChange("render", value)} />
                </LabeledControl>
            </div>
            <div className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">限制的是单个用户自己的并发任务，不是全站共享上限。</div>
        </div>
    );
}

export function GenerationCostControlPanel({ settings, onChange }: { settings: AuthSettings; onChange: (key: keyof AuthSettings["generationCostControl"], value: number | null) => void }) {
    return (
        <div className={settingsPanelSurfaceClass}>
            <SectionTitle icon={<CircleGauge className="size-4" />} title="生成成本保护" />
            <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                <LabeledControl label="单任务积分上限">
                    <InputNumber className="w-full" min={0} precision={2} value={settings.generationCostControl.maxPointsPerTask} onChange={(value) => onChange("maxPointsPerTask", value)} />
                </LabeledControl>
                <LabeledControl label="单用户日消费上限">
                    <InputNumber className="w-full" min={0} precision={2} value={settings.generationCostControl.dailyUserPointSpend} onChange={(value) => onChange("dailyUserPointSpend", value)} />
                </LabeledControl>
                <LabeledControl label="全站日消费上限">
                    <InputNumber className="w-full" min={0} precision={2} value={settings.generationCostControl.dailyTotalPointSpend} onChange={(value) => onChange("dailyTotalPointSpend", value)} />
                </LabeledControl>
            </div>
        </div>
    );
}

export function localAgentReadiness(settings: AuthSettings): AgentReadiness {
    const models = { text: settings.defaultModels.textModel, image: settings.defaultModels.imageModel, video: settings.defaultModels.videoModel, audio: settings.defaultModels.audioModel } as const;
    const capabilities = Object.entries(models).map(([type, model]) => {
        const capability = type as keyof typeof models;
        const resolved = resolveLogicalModelConfig(settings.logicalModels, settings.systemChannels, capability, model);
        return { type: capability, model, ready: Boolean(model && resolved), message: !model ? "未设置默认模型" : !resolved ? "默认模型没有可用渠道绑定" : "使用渠道：" + resolved.channel.name };
    });
    const skills = { image: 0, video: 0, canvas: 0, drama: 0 };
    for (const skill of settings.agentSkills) if (skill.enabled) for (const workspace of skill.workspaces || ["image"]) skills[workspace] += 1;
    return { ready: capabilities.every((item) => item.ready), capabilities, skills };
}

export function GenerationDefaultsPanel({ settings, onChange }: { settings: AuthSettings; onChange: <K extends keyof AuthSettings["generationDefaults"]>(key: K, value: AuthSettings["generationDefaults"][K]) => void }) {
    const { message } = App.useApp();
    const { capabilities, imageSizeOptions, imageSizeCustomSupported, resets } = useMemo(() => generationDefaultsPanelState(settings), [settings]);
    const capabilityKey = useMemo(
        () =>
            JSON.stringify({
                defaultModels: settings.defaultModels,
                logicalModels: settings.logicalModels.map((model) => ({
                    id: model.id,
                    capability: model.capability,
                    enabled: model.enabled,
                    bindings: model.bindings.map((binding) => ({ id: binding.id, enabled: binding.enabled, generationParameters: binding.generationParameters })),
                })),
            }),
        [settings.defaultModels, settings.logicalModels],
    );
    const [imageSizeDraft, setImageSizeDraft] = useState(settings.generationDefaults.imageSize);
    const [videoSecondsDraft, setVideoSecondsDraft] = useState(String(settings.generationDefaults.videoSeconds));
    useEffect(() => {
        (Object.entries(resets) as Array<[keyof typeof resets, string | number]>).forEach(([key, value]) => {
            if (settings.generationDefaults[key] !== value) onChange(key, value as never);
        });
        setImageSizeDraft(resets.imageSize);
        setVideoSecondsDraft(String(resets.videoSeconds));
    }, [capabilityKey]);
    const optionValues = (values: string[] | undefined) => [{ value: "auto", label: "自动" }, ...(values || []).map((value) => ({ value, label: value }))];
    const countOptions = (maximum: number | undefined) => [{ value: "auto", label: "自动" }, ...(maximum ? Array.from({ length: maximum }, (_, index) => ({ value: index + 1, label: `${index + 1} 张` })) : [])];
    return (
        <div className={settingsPanelSurfaceClass}>
            <SectionTitle icon={<SlidersHorizontal className="size-4" />} title="生成默认值" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <LabeledControl label="画布默认生图张数">
                    <Select
                        className="w-full"
                        value={settings.generationDefaults.canvasImageCount}
                        disabled={!capabilities.image?.maxBatchSize}
                        options={countOptions(capabilities.image?.maxBatchSize)}
                        onChange={(value) => onChange("canvasImageCount", value)}
                    />
                </LabeledControl>
                <LabeledControl label="Agent 默认生图张数">
                    <Select className="w-full" value={settings.generationDefaults.imageCount} disabled={!capabilities.image?.maxBatchSize} options={countOptions(capabilities.image?.maxBatchSize)} onChange={(value) => onChange("imageCount", value)} />
                </LabeledControl>
                <LabeledControl label="默认图片/视频比例">
                    <AutoComplete
                        className="w-full"
                        value={imageSizeDraft}
                        disabled={imageSizeOptions.length === 1 && !imageSizeCustomSupported}
                        options={imageSizeOptions}
                        onChange={setImageSizeDraft}
                        onBlur={() => {
                            const error = generationDefaultsValidationError({ ...settings, generationDefaults: { ...settings.generationDefaults, imageSize: imageSizeDraft } }, ["imageSize"]);
                            if (error) return message.error(error);
                            onChange("imageSize", imageSizeDraft);
                        }}
                    />
                </LabeledControl>
                <LabeledControl label="默认图片质量">
                    <Select className="w-full" value={settings.generationDefaults.imageQuality} disabled={!capabilities.image} options={optionValues(capabilities.image?.qualities)} onChange={(value) => onChange("imageQuality", value)} />
                </LabeledControl>
                <LabeledControl label="默认视频清晰度">
                    <Select className="w-full" value={settings.generationDefaults.videoQuality} disabled={!capabilities.video} options={optionValues(capabilities.video?.resolutions)} onChange={(value) => onChange("videoQuality", value)} />
                </LabeledControl>
                <LabeledControl label="默认视频秒数">
                    {capabilities.video?.durationMode === "discrete" ? (
                        <Select
                            className="w-full"
                            disabled={!capabilities.video}
                            value={settings.generationDefaults.videoSeconds}
                            options={[{ value: -1, label: "自动" }, ...capabilities.video.durationSeconds.map((value) => ({ value, label: `${value} 秒` }))]}
                            onChange={(value) => onChange("videoSeconds", value)}
                        />
                    ) : (
                        <Input
                            className="w-full"
                            disabled={!capabilities.video?.durationRange}
                            placeholder="-1 表示自动"
                            inputMode="decimal"
                            value={videoSecondsDraft}
                            onChange={(event) => setVideoSecondsDraft(event.target.value)}
                            onBlur={() => {
                                const seconds = Number(videoSecondsDraft);
                                if (!Number.isFinite(seconds) || (seconds !== -1 && (!capabilities.video?.durationRange || seconds < capabilities.video.durationRange.min || seconds > capabilities.video.durationRange.max)))
                                    return message.error("默认视频秒数不受当前默认视频模型支持");
                                onChange("videoSeconds", seconds);
                            }}
                        />
                    )}
                </LabeledControl>
                <LabeledControl label="默认音频音色">
                    <Select className="w-full" disabled={!capabilities.audio} value={settings.generationDefaults.audioVoice} options={optionValues(capabilities.audio?.voices)} onChange={(value) => onChange("audioVoice", value)} />
                </LabeledControl>
                <LabeledControl label="默认音频格式">
                    <Select className="w-full" disabled={!capabilities.audio} value={settings.generationDefaults.audioFormat} options={optionValues(capabilities.audio?.formats)} onChange={(value) => onChange("audioFormat", value)} />
                </LabeledControl>
            </div>
            <div className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">新建画布生图节点和配置节点默认使用，单个节点仍可单独覆盖。</div>
        </div>
    );
}
