"use client";

import { App, Button, Checkbox, Drawer, Empty, Input, InputNumber, Popconfirm, Select, Space, Switch, Tag } from "antd";
import { AlertTriangle, GitBranch, Pencil, RefreshCw, Route, Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import { LabeledControl, SectionTitle } from "@/components/admin/admin-settings-controls";
import type { LogicalModel, LogicalModelBinding, LogicalModelCapability, LogicalModelCapabilityProfile, LogicalModelGenerationParameters, SystemDefaultModels, SystemModelChannel } from "@/lib/auth/store";
import { fullGenerationParametersPreset, normalizeGenerationParameters } from "@/lib/generation-parameters";
import { generationParametersStatus } from "@/lib/generation-defaults-validation";
import { validateGenerationParametersInput } from "@/lib/generation-parameters-admin-validation";
import { capabilityLabel, isLogicalModelResolvable, normalizeDefaultModelsConfig, resolveLogicalModelConfig, synchronizeLogicalModelsWithChannels } from "@/lib/model-routing-config";

type Props = {
    channels: SystemModelChannel[];
    logicalModels: LogicalModel[];
    defaultModels: SystemDefaultModels;
    onChange: (value: { logicalModels: LogicalModel[]; defaultModels: SystemDefaultModels }) => void;
};

const capabilityOptions: Array<{ label: string; value: LogicalModelCapability }> = [
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
];

const defaultFields: Array<{ capability: LogicalModelCapability; key: keyof SystemDefaultModels; label: string }> = [
    { capability: "text", key: "textModel", label: "默认文本模型" },
    { capability: "image", key: "imageModel", label: "默认图片模型" },
    { capability: "video", key: "videoModel", label: "默认视频模型" },
    { capability: "audio", key: "audioModel", label: "默认音频模型" },
];

export function AdminLogicalModelManager({ channels, logicalModels, defaultModels, onChange }: Props) {
    const { message } = App.useApp();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [editingId, setEditingId] = useState("");
    const [draft, setDraft] = useState<LogicalModel | null>(null);
    const [query, setQuery] = useState("");
    const [capabilityFilter, setCapabilityFilter] = useState<LogicalModelCapability | "all">("all");
    const deferredQuery = useDeferredValue(query.trim().toLowerCase());
    const visibleModels = useMemo(
        () =>
            logicalModels.filter(
                (model) => (capabilityFilter === "all" || model.capability === capabilityFilter) && (!deferredQuery || `${model.id} ${model.name} ${model.bindings.map((binding) => binding.upstreamModel).join(" ")}`.toLowerCase().includes(deferredQuery)),
            ),
        [capabilityFilter, deferredQuery, logicalModels],
    );
    const availableDefaultFields = defaultFields.filter(({ capability }) => logicalModels.some((model) => model.capability === capability && isLogicalModelResolvable(logicalModels, channels, capability, model.id)));
    const availableCapabilityOptions = capabilityOptions.filter(({ value }) => availableDefaultFields.some(({ capability }) => capability === value));
    const readyCount = availableDefaultFields.filter(({ capability, key }) => isLogicalModelResolvable(logicalModels, channels, capability, defaultModels[key])).length;

    const openEdit = (model: LogicalModel) => {
        setEditingId(model.id);
        setDraft(cloneLogicalModel(model));
        setDrawerOpen(true);
    };

    const saveDraft = () => {
        if (!draft) return;
        const name = draft.name.trim();
        if (!name) {
            message.error("请填写前端展示昵称");
            return;
        }
        const nextModels = logicalModels.map((model) => (model.id === editingId ? cloneLogicalModel({ ...draft, name }) : model));
        onChange({ logicalModels: nextModels, defaultModels: normalizeDefaultModelsConfig(defaultModels, nextModels, channels) });
        setDrawerOpen(false);
        message.success("模型路由设置已更新，请保存渠道配置");
    };

    const syncChannelModels = () => {
        const nextModels = synchronizeLogicalModelsWithChannels(logicalModels, channels);
        if (JSON.stringify(nextModels) === JSON.stringify(logicalModels)) {
            message.info("逻辑模型已与渠道目录同步");
            return;
        }
        onChange({ logicalModels: nextModels, defaultModels: normalizeDefaultModelsConfig(defaultModels, nextModels, channels) });
        message.success(`已按上游模型名同步 ${nextModels.length} 个逻辑模型`);
    };

    const updateDefault = (key: keyof SystemDefaultModels, modelId: string) => onChange({ logicalModels, defaultModels: { ...defaultModels, [key]: modelId } });

    return (
        <section className="border-t border-stone-200 pt-5 dark:border-stone-800">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <SectionTitle icon={<Route className="size-4" />} title="逻辑模型路由" />
                        <Tag color={availableDefaultFields.length && readyCount === availableDefaultFields.length ? "green" : "orange"} className="m-0">
                            默认能力 {readyCount}/{availableDefaultFields.length} 可用
                        </Tag>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">逻辑模型由渠道模型目录自动生成；同名上游模型跨渠道合并，前端昵称可独立设置。</p>
                </div>
                <Button icon={<RefreshCw className="size-4" />} onClick={syncChannelModels}>
                    重新同步
                </Button>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="min-w-0">
                    <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
                        <Input allowClear value={query} prefix={<Search className="size-4 text-stone-400" />} placeholder="搜索模型昵称、ID 或上游模型" onChange={(event) => setQuery(event.target.value)} />
                        <Select value={capabilityFilter} options={[{ label: "全部能力", value: "all" }, ...availableCapabilityOptions]} onChange={(value) => setCapabilityFilter(value)} />
                    </div>
                    <div className="max-h-[680px] space-y-2 overflow-y-auto pr-1">
                        {visibleModels.map((model) => {
                            const resolved = resolveLogicalModelConfig(logicalModels, channels, model.capability, model.id);
                            const isDefault = Object.values(defaultModels).some((value) => value.toLowerCase() === model.id.toLowerCase());
                            const capabilityStatus = logicalModelCapabilityStatus(model);
                            return (
                                <div key={model.id} className="flex min-w-0 flex-col gap-3 rounded-lg border border-stone-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between dark:border-stone-800 dark:bg-stone-950">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="truncate text-sm font-semibold text-stone-950 dark:text-stone-100">{model.name}</span>
                                            <Tag className="m-0">{capabilityLabel(model.capability)}</Tag>
                                            <Tag color={model.enabled ? "green" : "default"} className="m-0">
                                                {model.enabled ? "启用" : "停用"}
                                            </Tag>
                                            {capabilityStatus ? (
                                                <Tag color={capabilityStatus.state === "configured" ? "green" : capabilityStatus.state === "incomplete" ? "orange" : "default"} className="m-0">
                                                    {capabilityStatus.label}
                                                </Tag>
                                            ) : null}
                                            {isDefault ? (
                                                <Tag color="blue" className="m-0">
                                                    默认
                                                </Tag>
                                            ) : null}
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                                            <span>ID：{model.id}</span>
                                            <span>{model.bindings.length} 个同名渠道绑定</span>
                                            <span className={resolved ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>{resolved ? `${resolved.channel.name} / ${resolved.binding.upstreamModel}` : "当前无可用渠道"}</span>
                                        </div>
                                    </div>
                                    <Button className="shrink-0" size="small" icon={<Pencil className="size-3.5" />} onClick={() => openEdit(model)}>
                                        路由设置
                                    </Button>
                                </div>
                            );
                        })}
                        {!visibleModels.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={logicalModels.length ? "没有匹配的逻辑模型" : "渠道尚未同步到模型目录"} /> : null}
                    </div>
                </div>

                <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
                    <SectionTitle icon={<GitBranch className="size-4" />} title="默认模型" />
                    <div className="mt-4 space-y-4">
                        {availableDefaultFields.map(({ capability, key, label }) => {
                            const options = logicalModels.filter((model) => model.capability === capability && isLogicalModelResolvable(logicalModels, channels, capability, model.id)).map((model) => ({ label: model.name, value: model.id }));
                            const selected = logicalModels.find((model) => model.id === defaultModels[key]);
                            const resolved = selected ? resolveLogicalModelConfig(logicalModels, channels, capability, selected.id) : null;
                            return (
                                <LabeledControl key={key} label={label}>
                                    <Select
                                        className="w-full"
                                        allowClear
                                        showSearch
                                        optionFilterProp="label"
                                        value={defaultModels[key] || undefined}
                                        placeholder={`选择可用${capabilityLabel(capability)}模型`}
                                        options={options}
                                        status={defaultModels[key] && !resolved ? "error" : undefined}
                                        onChange={(value) => updateDefault(key, value || "")}
                                    />
                                    <div className={`mt-1 flex items-center gap-1 text-xs ${resolved ? "text-stone-500 dark:text-stone-400" : "text-amber-600 dark:text-amber-400"}`}>
                                        {!resolved ? <AlertTriangle className="size-3.5 shrink-0" /> : null}
                                        <span>{resolved ? `实际路由：${resolved.channel.name} / ${resolved.binding.upstreamModel}` : defaultModels[key] ? "当前默认模型不可解析" : "尚未设置默认模型"}</span>
                                    </div>
                                </LabeledControl>
                            );
                        })}
                    </div>
                </div>
            </div>

            <Drawer
                title="模型路由设置"
                size="min(760px, 100vw)"
                styles={{ wrapper: { maxWidth: "100vw" } }}
                open={drawerOpen}
                destroyOnHidden
                onClose={() => setDrawerOpen(false)}
                extra={
                    <Space>
                        <Button onClick={() => setDrawerOpen(false)}>取消</Button>
                        <Button type="primary" disabled={!draft?.name.trim()} onClick={saveDraft}>
                            应用修改
                        </Button>
                    </Space>
                }
            >
                {draft ? (
                    <>
                        <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-900/40">
                            <div className="truncate text-xs text-stone-500 dark:text-stone-400">逻辑 ID：{draft.id}（由上游模型自动建立）</div>
                            <div className="mt-2 grid gap-3 sm:max-w-[456px] sm:grid-cols-[192px_144px_96px]">
                                <LabeledControl label="前端昵称">
                                    <Input
                                        className="!w-full"
                                        aria-label="前端展示昵称"
                                        maxLength={120}
                                        value={draft.name}
                                        placeholder={draft.bindings[0]?.upstreamModel || draft.id}
                                        onChange={(event) => setDraft((current) => (current ? { ...current, name: event.target.value } : current))}
                                    />
                                </LabeledControl>
                                <LabeledControl label="能力类型">
                                    <Select className="w-full" value={draft.capability} options={capabilityOptions} onChange={(capability) => setDraft((current) => (current ? { ...current, capability } : current))} />
                                </LabeledControl>
                                <LabeledControl label="模型状态">
                                    <div className="flex h-8 items-center">
                                        <Switch checkedChildren="启用" unCheckedChildren="停用" checked={draft.enabled} onChange={(enabled) => setDraft((current) => (current ? { ...current, enabled } : current))} />
                                    </div>
                                </LabeledControl>
                            </div>
                        </div>
                        <div className="mt-5">
                            <h3 className="text-sm font-semibold text-stone-950 dark:text-stone-100">同名渠道绑定</h3>
                            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">渠道与上游模型由目录自动同步；这里调整路由优先级、启停和能力档案。</p>
                            <div className="mt-3 space-y-3">
                                {draft.bindings.map((binding) => (
                                    <BindingEditor
                                        key={binding.id}
                                        binding={binding}
                                        capability={draft.capability}
                                        channels={channels}
                                        onChange={(patch) => setDraft((current) => (current ? { ...current, bindings: current.bindings.map((item) => (item.id === binding.id ? { ...item, ...patch } : item)) } : current))}
                                    />
                                ))}
                            </div>
                        </div>
                    </>
                ) : null}
            </Drawer>
        </section>
    );
}

function BindingEditor({ binding, capability, channels, onChange }: { binding: LogicalModelBinding; capability: LogicalModelCapability; channels: SystemModelChannel[]; onChange: (patch: Partial<LogicalModelBinding>) => void }) {
    const { message } = App.useApp();
    const channel = channels.find((item) => item.id === binding.channelId);
    const profile = binding.capabilityProfile || {};
    const effectiveAsync = profile.supportsAsync ?? (capability === "image" || capability === "video");
    const timeoutSeconds = profile.timeoutMs ? Math.round(profile.timeoutMs / 1000) : undefined;
    const defaultTimeoutSeconds = capability === "image" ? 600 : capability === "text" ? 180 : 1800;
    const updateProfile = (patch: Partial<LogicalModelCapabilityProfile>) => onChange({ capabilityProfile: { ...profile, ...patch } });
    const updateGenerationParameters = (patch: Partial<LogicalModelGenerationParameters>) => {
        const raw = { ...(binding.generationParameters || {}), ...patch };
        const error = validateGenerationParametersInput(raw);
        if (error) return message.error(error);
        onChange({ generationParameters: normalizeGenerationParameters(raw) });
    };
    const applyList = (label: string, field: "aspectRatios" | "pixelSizes" | "qualities" | "resolutions" | "voices" | "formats", value: string) => {
        const requested = value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
        const raw = { ...(binding.generationParameters || {}), [field]: requested };
        const error = validateGenerationParametersInput(raw);
        if (error) {
            message.error(error);
            return;
        }
        onChange({ generationParameters: normalizeGenerationParameters(raw) });
    };
    const applyDurationList = (value: string) => {
        const requested = value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
        const raw = { ...(binding.generationParameters || {}), durationMode: "discrete", durationSeconds: requested };
        const error = validateGenerationParametersInput(raw);
        if (error) {
            message.error(error);
            return;
        }
        onChange({ generationParameters: normalizeGenerationParameters(raw) });
    };
    return (
        <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-900/40">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_90px_90px_auto] sm:items-end">
                <LabeledControl label="渠道">
                    <div className="flex h-8 items-center truncate rounded-md border border-stone-200 bg-white px-3 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200">{channel?.name || "渠道已移除"}</div>
                </LabeledControl>
                <LabeledControl label="上游模型">
                    <div className="flex h-8 items-center truncate rounded-md border border-stone-200 bg-white px-3 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200">{binding.upstreamModel}</div>
                </LabeledControl>
                <LabeledControl label="优先级">
                    <InputNumber className="w-full" min={1} max={10000} precision={0} value={binding.priority} onChange={(priority) => onChange({ priority: Number(priority) || 1 })} />
                </LabeledControl>
                <LabeledControl label="权重">
                    <InputNumber className="w-full" min={1} max={10000} precision={0} value={binding.weight || 100} onChange={(weight) => onChange({ weight: Number(weight) || 100 })} />
                </LabeledControl>
                <div className="flex h-8 items-center">
                    <Switch size="small" checked={binding.enabled} aria-label={`${channel?.name || "渠道"}绑定启用状态`} onChange={(enabled) => onChange({ enabled })} />
                </div>
            </div>
            {capability !== "text" ? (
                <div className="mt-3 rounded-md border border-stone-200/80 bg-white/70 p-3 dark:border-stone-800 dark:bg-stone-950/40">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <div className="text-xs font-semibold text-stone-700 dark:text-stone-200">生成能力档案</div>
                            <div className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">仅描述这个绑定可执行的生成参数；留空的能力不会对外开放。</div>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                            <Tag
                                color={
                                    generationParametersStatus(capability, binding.generationParameters).state === "configured" ? "green" : generationParametersStatus(capability, binding.generationParameters).state === "incomplete" ? "orange" : "default"
                                }
                                className="m-0"
                            >
                                {generationParametersStatus(capability, binding.generationParameters).label}
                            </Tag>
                            {binding.generationParameters ? (
                                <>
                                    <Popconfirm
                                        title="覆盖当前能力配置？"
                                        description="将使用 VOZEB 全部当前选项替换这个 binding 的能力草稿。"
                                        okText="覆盖"
                                        cancelText="取消"
                                        onConfirm={() => onChange({ generationParameters: fullGenerationParametersPreset(capability) })}
                                    >
                                        <Button size="small">重新启用全部选项</Button>
                                    </Popconfirm>
                                    <Button size="small" onClick={() => onChange({ generationParameters: undefined })}>
                                        清除能力配置
                                    </Button>
                                </>
                            ) : (
                                <>
                                    <Button size="small" type="primary" onClick={() => onChange({ generationParameters: fullGenerationParametersPreset(capability) })}>
                                        启用全部选项
                                    </Button>
                                    <Button size="small" onClick={() => onChange({ generationParameters: normalizeGenerationParameters({}) })}>
                                        空白配置
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>
                    <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-5 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
                        快速模板只覆盖 VOZEB 当前选项，不代表上游已确认支持；保存前请删除不支持的参数。
                    </div>
                    {binding.generationParameters ? (
                        <GenerationCapabilityEditor capability={capability} parameters={binding.generationParameters} onUpdate={updateGenerationParameters} onApplyList={applyList} onApplyDurationList={applyDurationList} />
                    ) : null}
                </div>
            ) : null}
            <div className="mt-3 rounded-md border border-stone-200/80 bg-white/70 p-3 dark:border-stone-800 dark:bg-stone-950/40">
                <div className="mb-3 text-xs font-semibold text-stone-700 dark:text-stone-200">运行与计费设置</div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="flex flex-wrap items-center gap-3 text-xs text-stone-600 dark:text-stone-300 sm:col-span-2 lg:col-span-4">
                        <Checkbox checked={effectiveAsync} onChange={(event) => updateProfile({ supportsAsync: event.target.checked })}>
                            异步查询
                        </Checkbox>
                        <Checkbox checked={profile.supportsCancel === true} onChange={(event) => updateProfile({ supportsCancel: event.target.checked })}>
                            上游取消
                        </Checkbox>
                        <Checkbox checked={profile.supportsWebhook === true} onChange={(event) => updateProfile({ supportsWebhook: event.target.checked })}>
                            Webhook
                        </Checkbox>
                    </div>
                    {capability === "text" ? (
                        <>
                            <LabeledControl label="最大输入 Token">
                                <InputNumber className="w-full" min={1} precision={0} value={profile.maxInputTokens} placeholder="留空表示未配置" onChange={(value) => updateProfile({ maxInputTokens: value ? Number(value) : undefined })} />
                            </LabeledControl>
                            <LabeledControl label="最大输出 Token">
                                <InputNumber className="w-full" min={1} precision={0} value={profile.maxOutputTokens} placeholder="留空表示未配置" onChange={(value) => updateProfile({ maxOutputTokens: value ? Number(value) : undefined })} />
                            </LabeledControl>
                        </>
                    ) : null}
                    <LabeledControl label="请求超时（秒）">
                        <InputNumber
                            className="w-full"
                            min={5}
                            max={1800}
                            precision={0}
                            value={timeoutSeconds}
                            placeholder={`默认 ${defaultTimeoutSeconds} 秒`}
                            onChange={(value) => updateProfile({ timeoutMs: value ? Number(value) * 1000 : undefined })}
                        />
                    </LabeledControl>
                    <LabeledControl label="并发上限">
                        <InputNumber className="w-full" min={1} max={1000} precision={0} value={profile.concurrencyLimit} onChange={(value) => updateProfile({ concurrencyLimit: Number(value) || 1 })} />
                    </LabeledControl>
                    <LabeledControl label="单次成本">
                        <InputNumber className="w-full" min={0} precision={4} value={profile.unitCost} onChange={(value) => updateProfile({ unitCost: Number(value) || 0 })} />
                    </LabeledControl>
                    <LabeledControl label="成本货币">
                        <Input value={profile.unitCostCurrency || ""} maxLength={12} placeholder="USD / CNY" onChange={(event) => updateProfile({ unitCostCurrency: event.target.value.trim().toUpperCase() })} />
                    </LabeledControl>
                </div>
            </div>
        </div>
    );
}

function GenerationCapabilityEditor({
    capability,
    parameters,
    onUpdate,
    onApplyList,
    onApplyDurationList,
}: {
    capability: Exclude<LogicalModelCapability, "text">;
    parameters: LogicalModelGenerationParameters;
    onUpdate: (patch: Partial<LogicalModelGenerationParameters>) => void;
    onApplyList: (label: string, field: "aspectRatios" | "pixelSizes" | "qualities" | "resolutions" | "voices" | "formats", value: string) => void;
    onApplyDurationList: (value: string) => void;
}) {
    const toggleReference = (value: LogicalModelGenerationParameters["referenceInputs"][number], checked: boolean) =>
        onUpdate({ referenceInputs: checked ? [...parameters.referenceInputs, value] : parameters.referenceInputs.filter((item) => item !== value) });
    const listInput = (label: string, field: "aspectRatios" | "pixelSizes" | "qualities" | "resolutions" | "voices" | "formats", placeholder: string) => (
        <LabeledControl label={label}>
            <Input
                key={`${field}:${parameters[field].join(",")}`}
                defaultValue={parameters[field].join(", ")}
                placeholder={placeholder}
                onBlur={(event) => onApplyList(label, field, event.target.value)}
                onPressEnter={(event) => onApplyList(label, field, event.currentTarget.value)}
            />
        </LabeledControl>
    );
    return (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-wrap items-center gap-3 text-xs text-stone-600 dark:text-stone-300 sm:col-span-2 lg:col-span-4">
                {(["image", "video", "audio"] as const).map((value) => (
                    <Checkbox key={value} checked={parameters.referenceInputs.includes(value)} onChange={(event) => toggleReference(value, event.target.checked)}>
                        参考{value === "image" ? "图片" : value === "video" ? "视频" : "音频"}
                    </Checkbox>
                ))}
                {(capability === "image" || capability === "video") && (
                    <Checkbox checked={parameters.supportsCustomSize} onChange={(event) => onUpdate({ supportsCustomSize: event.target.checked })}>
                        支持自定义尺寸
                    </Checkbox>
                )}
                {(capability === "image" || capability === "video") && (
                    <Checkbox
                        checked={parameters.supportsCustomBatchSize === true}
                        onChange={(event) =>
                            onUpdate({
                                supportsCustomBatchSize: event.target.checked || undefined,
                                customBatchSizeRange: event.target.checked ? parameters.customBatchSizeRange || { min: 1, max: parameters.maxBatchSize || 4 } : undefined,
                            })
                        }
                    >
                        允许自定义数量
                    </Checkbox>
                )}
                {capability === "video" && parameters.durationMode === "discrete" ? (
                    <Checkbox
                        checked={parameters.supportsCustomDuration === true}
                        onChange={(event) =>
                            onUpdate({
                                supportsCustomDuration: event.target.checked || undefined,
                                customDurationRange: event.target.checked ? parameters.customDurationRange || { min: parameters.durationSeconds[0] || 1, max: parameters.durationSeconds.at(-1) || 15 } : undefined,
                            })
                        }
                    >
                        允许自定义时长
                    </Checkbox>
                ) : null}
            </div>
            {(capability === "image" || capability === "video") && (
                <>
                    <LabeledControl label="最大参考图片数">
                        <InputNumber className="w-full" min={1} precision={0} value={parameters.maxReferenceImages} onChange={(value) => onUpdate({ maxReferenceImages: value ? Number(value) : undefined })} />
                    </LabeledControl>
                    <LabeledControl label="最大批量数量">
                        <InputNumber className="w-full" min={1} precision={0} value={parameters.maxBatchSize} onChange={(value) => onUpdate({ maxBatchSize: value ? Number(value) : undefined })} />
                    </LabeledControl>
                    {parameters.supportsCustomBatchSize ? (
                        <>
                            <LabeledControl label="自定义数量下限">
                                <InputNumber
                                    className="w-full"
                                    min={1}
                                    precision={0}
                                    value={parameters.customBatchSizeRange?.min}
                                    onChange={(value) => onUpdate({ customBatchSizeRange: { min: Number(value), max: parameters.customBatchSizeRange?.max || Number(value) } })}
                                />
                            </LabeledControl>
                            <LabeledControl label="自定义数量上限">
                                <InputNumber
                                    className="w-full"
                                    min={1}
                                    precision={0}
                                    value={parameters.customBatchSizeRange?.max}
                                    onChange={(value) => onUpdate({ customBatchSizeRange: { min: parameters.customBatchSizeRange?.min || Number(value), max: Number(value) } })}
                                />
                            </LabeledControl>
                        </>
                    ) : null}
                    {listInput("支持比例（逗号分隔）", "aspectRatios", "1:1, 16:9, 9:16")}
                    {listInput("精确尺寸（逗号分隔）", "pixelSizes", "1024x1024, 1920x1080")}
                </>
            )}
            {capability === "image" && listInput("图片质量（逗号分隔）", "qualities", "low, medium, high")}
            {capability === "video" && (
                <>
                    {listInput("视频清晰度（逗号分隔）", "resolutions", "720, 1080")}
                    <LabeledControl label="时长模式">
                        <Select
                            className="w-full"
                            value={parameters.durationMode}
                            placeholder="选择时长模式"
                            options={[
                                { value: "discrete", label: "离散秒数" },
                                { value: "range", label: "连续范围" },
                            ]}
                            onChange={(durationMode) => onUpdate(durationMode === "discrete" ? { durationMode, durationRange: undefined } : { durationMode, durationSeconds: [], durationRange: parameters.durationRange })}
                        />
                    </LabeledControl>
                    {parameters.durationMode === "discrete" ? (
                        <LabeledControl label="可选秒数（逗号分隔）">
                            <Input
                                key={parameters.durationSeconds.join(",")}
                                defaultValue={parameters.durationSeconds.join(", ")}
                                placeholder="5, 10"
                                onBlur={(event) => onApplyDurationList(event.target.value)}
                                onPressEnter={(event) => onApplyDurationList(event.currentTarget.value)}
                            />
                        </LabeledControl>
                    ) : null}
                    {parameters.durationMode === "discrete" && parameters.supportsCustomDuration ? (
                        <>
                            <LabeledControl label="自定义时长下限（秒）">
                                <InputNumber
                                    className="w-full"
                                    min={0.01}
                                    value={parameters.customDurationRange?.min}
                                    onChange={(value) => onUpdate({ customDurationRange: { min: Number(value), max: parameters.customDurationRange?.max || Number(value) } })}
                                />
                            </LabeledControl>
                            <LabeledControl label="自定义时长上限（秒）">
                                <InputNumber
                                    className="w-full"
                                    min={0.01}
                                    value={parameters.customDurationRange?.max}
                                    onChange={(value) => onUpdate({ customDurationRange: { min: parameters.customDurationRange?.min || Number(value), max: Number(value) } })}
                                />
                            </LabeledControl>
                        </>
                    ) : null}
                    {parameters.durationMode === "range" ? (
                        <>
                            <LabeledControl label="最短时长（秒）">
                                <InputNumber className="w-full" min={0.01} value={parameters.durationRange?.min} onChange={(value) => onUpdate({ durationRange: { min: Number(value), max: parameters.durationRange?.max || Number(value) } })} />
                            </LabeledControl>
                            <LabeledControl label="最长时长（秒）">
                                <InputNumber className="w-full" min={0.01} value={parameters.durationRange?.max} onChange={(value) => onUpdate({ durationRange: { min: parameters.durationRange?.min || Number(value), max: Number(value) } })} />
                            </LabeledControl>
                        </>
                    ) : null}
                    <LabeledControl label="视频参考方式">
                        <Checkbox.Group
                            className="flex flex-wrap gap-2"
                            value={parameters.videoReferenceModes}
                            options={[
                                { value: "reference", label: "普通参考" },
                                { value: "first_frame", label: "首帧" },
                                { value: "first_last", label: "首尾帧" },
                            ]}
                            onChange={(videoReferenceModes) => onUpdate({ videoReferenceModes: videoReferenceModes as LogicalModelGenerationParameters["videoReferenceModes"] })}
                        />
                    </LabeledControl>
                </>
            )}
            {capability === "audio" && (
                <>
                    {listInput("音色（逗号分隔）", "voices", "alloy, nova")}
                    {listInput("输出格式（逗号分隔）", "formats", "mp3, wav")}
                    <LabeledControl label="最慢语速">
                        <InputNumber className="w-full" min={0.01} value={parameters.speedRange?.min} onChange={(value) => onUpdate({ speedRange: { min: Number(value), max: parameters.speedRange?.max || Number(value) } })} />
                    </LabeledControl>
                    <LabeledControl label="最快语速">
                        <InputNumber className="w-full" min={0.01} value={parameters.speedRange?.max} onChange={(value) => onUpdate({ speedRange: { min: parameters.speedRange?.min || Number(value), max: Number(value) } })} />
                    </LabeledControl>
                </>
            )}
        </div>
    );
}

function cloneLogicalModel(model: LogicalModel): LogicalModel {
    return {
        ...model,
        bindings: model.bindings.map((binding) => ({
            ...binding,
            capabilityProfile: binding.capabilityProfile ? { ...binding.capabilityProfile } : undefined,
            generationParameters: binding.generationParameters
                ? {
                      ...binding.generationParameters,
                      referenceInputs: [...binding.generationParameters.referenceInputs],
                      aspectRatios: [...binding.generationParameters.aspectRatios],
                      pixelSizes: [...binding.generationParameters.pixelSizes],
                      qualities: [...binding.generationParameters.qualities],
                      resolutions: [...binding.generationParameters.resolutions],
                      durationSeconds: [...binding.generationParameters.durationSeconds],
                      videoReferenceModes: [...binding.generationParameters.videoReferenceModes],
                      voices: [...binding.generationParameters.voices],
                      formats: [...binding.generationParameters.formats],
                      ...(binding.generationParameters.durationRange ? { durationRange: { ...binding.generationParameters.durationRange } } : {}),
                      ...(binding.generationParameters.customDurationRange ? { customDurationRange: { ...binding.generationParameters.customDurationRange } } : {}),
                      ...(binding.generationParameters.customBatchSizeRange ? { customBatchSizeRange: { ...binding.generationParameters.customBatchSizeRange } } : {}),
                      ...(binding.generationParameters.speedRange ? { speedRange: { ...binding.generationParameters.speedRange } } : {}),
                  }
                : undefined,
        })),
    };
}

function logicalModelCapabilityStatus(model: LogicalModel) {
    if (model.capability === "text") return undefined;
    const statuses = model.bindings.map((binding) => generationParametersStatus(model.capability, binding.generationParameters).state);
    if (statuses.every((status) => status === "configured")) return { state: "configured" as const, label: "已配置" };
    if (statuses.some((status) => status !== "unconfigured")) return { state: "incomplete" as const, label: "能力档案未完成" };
    return { state: "unconfigured" as const, label: "能力档案未配置" };
}
