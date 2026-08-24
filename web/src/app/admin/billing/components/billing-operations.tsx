"use client";

import { App, Button, DatePicker, Form, Input, InputNumber, Modal, Pagination, Segmented, Select, Switch, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { AlertTriangle, CircleDollarSign, FileUp, Pencil, Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { allowedAdminBillingTabs, hasAdminPermission, type AdminBillingTab } from "@/lib/admin-permissions";
import type { AdminBillingSummary, AdminProviderUsageAttempt, AdminRecoveryItem, AdminTopUpConfig, AdminUsageAuditItem } from "@/lib/admin-billing-types";
import type { LogicalModel } from "@/lib/auth/store";
import type { ProviderCostUnit } from "@/lib/billing/money";
import type { PricingComponent, PricingDimension } from "@/lib/billing/pricing";
import type { PaymentConfigSummary } from "@/lib/payment-config-types";
import { AdminUserIdentity } from "@/components/admin/admin-user-identity";
import {
    deleteAdminTopUpPreset,
    getAdminModelPricing,
    getAdminTopUpConfig,
    getAdminTopUpSummary,
    getAdminUsageAttempts,
    getAdminUsageAudit,
    listAdminTopUpOrders,
    listAdminTopUpPresets,
    recoverAdminUsageHolds,
    refundAdminTopUpOrder,
    saveAdminTopUpConfig,
    saveAdminModelPricing,
    saveAdminTopUpPreset,
    type AdminTopUpOrder,
} from "@/services/api/admin-billing-commerce";
import type { TopUpOrder, TopUpOrderStatus, TopUpPreset } from "@/services/api/billing";
import { useUserStore } from "@/stores/use-user-store";
import { BillingReconciliationImport } from "./billing-reconciliation-import";
import { PaymentConfigPanel } from "./billing-operation-elements";

const PAGE_SIZE = 20;
const tabs: Array<{ label: string; value: AdminBillingTab }> = [
    { label: "充值订单", value: "orders" },
    { label: "充值预设", value: "presets" },
    { label: "定价与汇率", value: "pricing" },
    { label: "用量毛利", value: "usage" },
    { label: "异常恢复", value: "recovery" },
    { label: "支付对账", value: "reconciliation" },
    { label: "支付渠道", value: "payments" },
];

const orderStatuses: Array<{ label: string; value: TopUpOrderStatus | "" }> = [
    { label: "全部状态", value: "" },
    { label: "待支付", value: "pending" },
    { label: "已支付", value: "paid" },
    { label: "已取消", value: "canceled" },
    { label: "退款中", value: "refunding" },
    { label: "已退款", value: "refunded" },
];

type PresetForm = { id?: string; name: string; description?: string; nominalNativeAmount: string; enabled: boolean; sortOrder: number };
type PricingComponentForm = PricingComponent;
type BindingPricingForm = {
    bindingId: string;
    costComponents: PricingComponentForm[];
    unitKind: ProviderCostUnit["kind"];
    provider?: string;
    unit?: string;
    conversionVersion?: string;
    usdPerUnit?: string;
};
type ModelPricingForm = { modelId: string; saleComponents: PricingComponentForm[]; bindings: BindingPricingForm[] };

export function BillingOperations({ initialTab = "orders", initialPaymentConfig, embedded = false, hideTabs = false }: { initialTab?: AdminBillingTab; initialPaymentConfig?: PaymentConfigSummary; embedded?: boolean; hideTabs?: boolean }) {
    const currentUser = useUserStore((state) => state.user);
    const allowedTabs = useMemo(() => allowedAdminBillingTabs(currentUser), [currentUser]);
    const [activeTab, setActiveTab] = useState<AdminBillingTab>(allowedTabs.includes(initialTab) ? initialTab : allowedTabs[0] || "orders");
    const visibleTabs = tabs.filter((tab) => allowedTabs.includes(tab.value));

    useEffect(() => {
        const next = allowedTabs.includes(initialTab) ? initialTab : allowedTabs[0];
        if (next) setActiveTab(next);
    }, [allowedTabs, initialTab]);

    return (
        <div className={embedded ? "min-w-0" : "min-w-0 space-y-4"}>
            {!hideTabs && visibleTabs.length > 1 ? (
                <div className="overflow-x-auto">
                    <Segmented className="min-w-max" value={activeTab} options={visibleTabs} onChange={(value) => setActiveTab(value as AdminBillingTab)} />
                </div>
            ) : null}
            {activeTab === "orders" ? <OrdersPanel /> : null}
            {activeTab === "presets" ? <PresetsPanel /> : null}
            {activeTab === "pricing" ? <PricingPanel /> : null}
            {activeTab === "usage" ? <UsagePanel mode="usage" /> : null}
            {activeTab === "recovery" ? <UsagePanel mode="recovery" /> : null}
            {activeTab === "reconciliation" ? <ReconciliationPanel /> : null}
            {activeTab === "payments" ? <PaymentPanel initial={initialPaymentConfig} embedded={embedded} /> : null}
        </div>
    );
}

function OrdersPanel() {
    const { message, modal } = App.useApp();
    const canManageBilling = useUserStore((state) => hasAdminPermission(state.user, "billing.manage"));
    const [orders, setOrders] = useState<AdminTopUpOrder[]>([]);
    const [summary, setSummary] = useState<AdminBillingSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [status, setStatus] = useState<TopUpOrderStatus | "">("");
    const [keyword, setKeyword] = useState("");
    const [submittedKeyword, setSubmittedKeyword] = useState("");
    const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
    const [refunding, setRefunding] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [orderResult, summaryResult] = await Promise.all([
                listAdminTopUpOrders({ page, pageSize: PAGE_SIZE, status, keyword: submittedKeyword }),
                getAdminTopUpSummary({ startDate: range?.[0]?.format("YYYY-MM-DD"), endDate: range?.[1]?.format("YYYY-MM-DD") }),
            ]);
            setOrders(orderResult.orders);
            setTotal(orderResult.total);
            setSummary(summaryResult.summary);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加载充值订单失败");
        } finally {
            setLoading(false);
        }
    }, [message, page, range, status, submittedKeyword]);
    useEffect(() => {
        void load();
    }, [load]);

    const refund = (order: TopUpOrder) => {
        let reason = "";
        modal.confirm({
            title: "确认发起全额退款？",
            content: (
                <Input.TextArea
                    aria-label="退款原因"
                    maxLength={200}
                    placeholder="填写退款原因"
                    onChange={(event) => {
                        reason = event.target.value;
                    }}
                />
            ),
            okText: "确认退款",
            okButtonProps: { danger: true },
            onOk: async () => {
                setRefunding(order.id);
                try {
                    await refundAdminTopUpOrder(order.id, reason);
                    message.success("退款请求已处理");
                    await load();
                } finally {
                    setRefunding("");
                }
            },
        });
    };

    const columns: TableColumnsType<AdminTopUpOrder> = [
        {
            title: "订单",
            dataIndex: "orderNo",
            width: 210,
            render: (_, order) => (
                <div>
                    <div className="font-mono text-xs">{order.orderNo}</div>
                    <div className="mt-1 text-xs text-stone-500">{order.subject}</div>
                </div>
            ),
        },
        { title: "用户", dataIndex: "user", width: 210, render: (_, order) => <AdminUserIdentity {...order.user} fallback="用户信息不可用" /> },
        { title: "VND 实付", dataIndex: "payableNativeAmount", width: 145, render: (value: string) => formatVnd(value) },
        { title: "积分", dataIndex: "creditAmount", width: 110 },
        {
            title: "支付/发放",
            width: 170,
            render: (_, order) => (
                <div className="space-y-1">
                    <Tag color={statusColor(order.status)}>{statusLabel(order.status)}</Tag>
                    <div className="text-xs text-stone-500">
                        {order.paymentState} / {order.creditGrantState}
                    </div>
                </div>
            ),
        },
        {
            title: "退款/追回",
            width: 180,
            render: (_, order) => (
                <div className="text-xs text-stone-500">
                    {order.providerRefundState} / {order.creditRecoveryState}
                </div>
            ),
        },
        { title: "渠道", dataIndex: "provider", width: 100 },
        ...(canManageBilling
            ? [
                  {
                      title: "操作",
                      fixed: "right",
                      width: 100,
                      render: (_, order) => (
                          <Button danger size="small" loading={refunding === order.id} disabled={order.status !== "paid"} onClick={() => refund(order)}>
                              退款
                          </Button>
                      ),
                  } satisfies TableColumnsType<AdminTopUpOrder>[number],
              ]
            : []),
    ];

    const currency = summary?.currencies.find((item) => item.currency === "VND");
    return (
        <Panel
            title="充值订单与退款"
            description="订单的支付、积分发放、渠道退款和积分追回状态分别展示，避免把不同状态混成一个标签。"
            action={
                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
                    刷新
                </Button>
            }
        >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="VND 实收" value={formatVnd(currency?.paidNativeAmount || "0")} />
                <Metric label="VND 退款" value={formatVnd(currency?.refundedNativeAmount || "0")} />
                <Metric label="USD 实收快照" value={formatUsd(summary?.paidUsdValue || "0")} />
                <Metric label="USD 退款快照" value={formatUsd(summary?.refundedUsdValue || "0")} />
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-[180px_260px_minmax(0,1fr)_auto]">
                <Select
                    value={status}
                    options={orderStatuses}
                    onChange={(value) => {
                        setStatus(value);
                        setPage(1);
                    }}
                />
                <DatePicker.RangePicker value={range} onChange={(value) => setRange(value as [Dayjs | null, Dayjs | null] | null)} />
                <Input
                    value={keyword}
                    allowClear
                    placeholder="订单号、渠道订单号或用户"
                    onChange={(event) => setKeyword(event.target.value)}
                    onPressEnter={() => {
                        setSubmittedKeyword(keyword.trim());
                        setPage(1);
                    }}
                />
                <Button
                    icon={<Search className="size-4" />}
                    onClick={() => {
                        setSubmittedKeyword(keyword.trim());
                        setPage(1);
                    }}
                >
                    查询
                </Button>
            </div>
            <Table className="mt-4" rowKey="id" size="small" scroll={{ x: 1160 }} pagination={false} loading={loading} columns={columns} dataSource={orders} />
            {total > PAGE_SIZE ? <Pagination className="mt-4" current={page} pageSize={PAGE_SIZE} total={total} showSizeChanger={false} onChange={setPage} /> : null}
        </Panel>
    );
}

function PresetsPanel() {
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<PresetForm>();
    const [presets, setPresets] = useState<TopUpPreset[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const load = useCallback(async () => {
        setLoading(true);
        try {
            setPresets((await listAdminTopUpPresets()).presets);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加载充值预设失败");
        } finally {
            setLoading(false);
        }
    }, [message]);
    useEffect(() => {
        void load();
    }, [load]);
    const edit = (preset?: TopUpPreset) => {
        form.setFieldsValue(preset || { name: "", description: "", nominalNativeAmount: "", enabled: true, sortOrder: presets.length + 1 });
        setOpen(true);
    };
    const save = async () => {
        const value = await form.validateFields();
        setSaving(true);
        try {
            await saveAdminTopUpPreset(value);
            message.success("充值预设已保存");
            setOpen(false);
            await load();
        } finally {
            setSaving(false);
        }
    };
    const remove = (preset: TopUpPreset) =>
        modal.confirm({
            title: `删除“${preset.name}”？`,
            content: "删除只影响后续充值入口，不会改变已创建订单。",
            okText: "删除",
            okButtonProps: { danger: true },
            onOk: async () => {
                await deleteAdminTopUpPreset(preset.id);
                message.success("充值预设已删除");
                await load();
            },
        });
    return (
        <Panel
            title="充值预设"
            description="预设只定义 VND 名义充值金额；积分、汇率和价格版本始终由服务端报价生成。"
            action={
                <Button type="primary" icon={<Plus className="size-4" />} onClick={() => edit()}>
                    新建预设
                </Button>
            }
        >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {presets.map((preset) => (
                    <article key={preset.id} className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
                        <div className="flex items-start justify-between gap-2">
                            <div>
                                <h3 className="font-semibold">{preset.name}</h3>
                                <p className="mt-1 text-xs text-stone-500">{preset.description || "无说明"}</p>
                            </div>
                            <Tag color={preset.enabled ? "green" : "default"}>{preset.enabled ? "启用" : "停用"}</Tag>
                        </div>
                        <div className="mt-4 text-xl font-semibold">{formatVnd(preset.nominalNativeAmount)}</div>
                        <div className="mt-4 flex gap-2">
                            <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => edit(preset)}>
                                编辑
                            </Button>
                            <Button danger size="small" icon={<Trash2 className="size-3.5" />} onClick={() => remove(preset)}>
                                删除
                            </Button>
                        </div>
                    </article>
                ))}
                {!loading && !presets.length ? <div className="col-span-full rounded-xl border border-dashed p-8 text-center text-sm text-stone-500">暂无充值预设</div> : null}
            </div>
            <Modal title={form.getFieldValue("id") ? "编辑充值预设" : "新建充值预设"} open={open} confirmLoading={saving} onOk={() => void save()} onCancel={() => setOpen(false)} okText="保存" cancelText="取消" width="min(560px, calc(100vw - 24px))">
                <Form form={form} layout="vertical" className="mt-4">
                    <Form.Item name="id" hidden>
                        <Input />
                    </Form.Item>
                    <div className="grid gap-x-3 sm:grid-cols-2">
                        <Form.Item label="名称" name="name" rules={[{ required: true }]}>
                            <Input />
                        </Form.Item>
                        <Form.Item label="VND 名义金额" name="nominalNativeAmount" rules={[{ required: true, pattern: /^[1-9]\d*$/, message: "请输入正整数 VND" }]}>
                            <InputNumber stringMode min="1" precision={0} className="w-full" />
                        </Form.Item>
                        <Form.Item label="排序" name="sortOrder">
                            <InputNumber min={0} precision={0} className="w-full" />
                        </Form.Item>
                        <Form.Item label="启用" name="enabled" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                        <Form.Item className="sm:col-span-2" label="说明" name="description">
                            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} />
                        </Form.Item>
                    </div>
                </Form>
            </Modal>
        </Panel>
    );
}

function PricingPanel() {
    const { message } = App.useApp();
    const [form] = Form.useForm<AdminTopUpConfig>();
    const [pricingForm] = Form.useForm<ModelPricingForm>();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [pricingSaving, setPricingSaving] = useState(false);
    const [editingModel, setEditingModel] = useState<LogicalModel>();
    const [models, setModels] = useState<LogicalModel[]>([]);
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [topUp, pricing] = await Promise.all([getAdminTopUpConfig(), getAdminModelPricing()]);
            if (topUp.config) form.setFieldsValue(topUp.config);
            setModels(pricing.models);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加载定价配置失败");
        } finally {
            setLoading(false);
        }
    }, [form, message]);
    useEffect(() => {
        void load();
    }, [load]);
    const save = async () => {
        setSaving(true);
        try {
            await saveAdminTopUpConfig(await form.validateFields());
            message.success("客户汇率与充值版本已保存");
            await load();
        } finally {
            setSaving(false);
        }
    };
    const editPricing = (model: LogicalModel) => {
        pricingForm.setFieldsValue({
            modelId: model.id,
            saleComponents: model.saleRateCard?.components || [defaultPricingComponent(model.capability)],
            bindings: model.bindings.map((binding) => ({
                bindingId: binding.id,
                costComponents: binding.costRateCard?.components || [],
                unitKind: binding.providerCostUnit?.kind || "fiat",
                ...(binding.providerCostUnit?.kind === "provider-native"
                    ? {
                          provider: binding.providerCostUnit.provider,
                          unit: binding.providerCostUnit.unit,
                          conversionVersion: binding.providerCostUnit.usdConversion.version,
                          usdPerUnit: binding.providerCostUnit.usdConversion.usdPerUnit,
                      }
                    : {}),
            })),
        });
        setEditingModel(model);
    };
    const savePricing = async () => {
        const value = await pricingForm.validateFields();
        setPricingSaving(true);
        try {
            await saveAdminModelPricing({
                modelId: value.modelId,
                saleRateCard: { version: 1, components: value.saleComponents.map(cleanPricingComponent) },
                bindings: value.bindings.map((binding) => {
                    const costRateCard = binding.costComponents.length ? { version: 1 as const, components: binding.costComponents.map(cleanPricingComponent) } : null;
                    const providerCostUnit: ProviderCostUnit | null = !costRateCard
                        ? null
                        : binding.unitKind === "provider-native"
                          ? { kind: "provider-native", provider: binding.provider || "", unit: binding.unit || "", usdConversion: { version: binding.conversionVersion || "", usdPerUnit: binding.usdPerUnit || "" } }
                          : { kind: "fiat", currency: "USD" };
                    return { bindingId: binding.bindingId, costRateCard, providerCostUnit };
                }),
            });
            message.success("模型售价、绑定成本与单位换算已保存");
            setEditingModel(undefined);
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存模型计价失败");
        } finally {
            setPricingSaving(false);
        }
    };
    return (
        <>
            <Panel
                title="客户汇率与模型计价"
                description="客户充值汇率、逻辑模型售价、绑定成本价和供应商原生单位换算分开管理；成本与毛利仅管理员可见。"
                action={
                    <Button type="primary" icon={<Save className="size-4" />} loading={saving} onClick={() => void save()}>
                        保存汇率
                    </Button>
                }
            >
                <Form form={form} layout="vertical">
                    <div className="grid gap-x-3 sm:grid-cols-3">
                        <Form.Item label="充值价格版本" name="pricingVersion" rules={[{ required: true }]}>
                            <Input />
                        </Form.Item>
                        <Form.Item label="客户汇率版本" name="customerFxVersion" rules={[{ required: true }]}>
                            <Input />
                        </Form.Item>
                        <Form.Item label="1 VND 对应 USD" name="usdPerVnd" rules={[{ required: true, pattern: /^(?:0|[1-9]\d*)(?:\.\d+)?$/ }]}>
                            <Input inputMode="decimal" />
                        </Form.Item>
                    </div>
                </Form>
                <div className="mt-4 overflow-x-auto">
                    <Table rowKey="id" size="small" loading={loading} pagination={false} scroll={{ x: 980 }} dataSource={models} columns={pricingColumns(editPricing)} />
                </div>
            </Panel>
            <Modal
                title={editingModel ? `编辑 ${editingModel.name} 计价` : "编辑模型计价"}
                open={Boolean(editingModel)}
                width="min(980px, calc(100vw - 24px))"
                styles={{ body: { maxHeight: "min(72dvh, 760px)", overflowY: "auto" } }}
                confirmLoading={pricingSaving}
                okText="保存模型计价"
                cancelText="取消"
                onOk={() => void savePricing()}
                onCancel={() => (pricingSaving ? undefined : setEditingModel(undefined))}
            >
                <Form form={pricingForm} layout="vertical" className="mt-4">
                    <Form.Item name="modelId" hidden>
                        <Input />
                    </Form.Item>
                    <RateComponentsEditor name="saleComponents" title="逻辑销售价格卡" required />
                    <Form.List name="bindings">
                        {(fields) => (
                            <div className="mt-4 space-y-3">
                                {fields.map((field, index) => {
                                    const binding = editingModel?.bindings[index];
                                    return (
                                        <section key={field.key} className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
                                            <div className="mb-3 text-sm font-semibold">{binding ? `${binding.channelId} / ${binding.upstreamModel}` : `绑定 ${index + 1}`}</div>
                                            <Form.Item name={[field.name, "bindingId"]} hidden>
                                                <Input />
                                            </Form.Item>
                                            <RateComponentsEditor name={[field.name, "costComponents"]} title="绑定成本价格卡" />
                                            <div className="mt-3 grid gap-x-3 sm:grid-cols-2 lg:grid-cols-4">
                                                <Form.Item label="成本单位类型" name={[field.name, "unitKind"]}>
                                                    <Select
                                                        options={[
                                                            { value: "fiat", label: "USD 法币" },
                                                            { value: "provider-native", label: "供应商原生单位" },
                                                        ]}
                                                    />
                                                </Form.Item>
                                                <Form.Item noStyle shouldUpdate={(previous, current) => previous.bindings?.[index]?.unitKind !== current.bindings?.[index]?.unitKind}>
                                                    {({ getFieldValue }) =>
                                                        getFieldValue(["bindings", index, "unitKind"]) === "provider-native" ? (
                                                            <>
                                                                <Form.Item label="供应商" name={[field.name, "provider"]} rules={[{ required: true }]}>
                                                                    <Input />
                                                                </Form.Item>
                                                                <Form.Item label="原生单位" name={[field.name, "unit"]} rules={[{ required: true }]}>
                                                                    <Input />
                                                                </Form.Item>
                                                                <Form.Item label="换算版本" name={[field.name, "conversionVersion"]} rules={[{ required: true }]}>
                                                                    <Input />
                                                                </Form.Item>
                                                                <Form.Item label="每单位 USD" name={[field.name, "usdPerUnit"]} rules={[{ required: true, pattern: /^(?:0|[1-9]\d*)(?:\.\d+)?$/ }]}>
                                                                    <Input inputMode="decimal" />
                                                                </Form.Item>
                                                            </>
                                                        ) : null
                                                    }
                                                </Form.Item>
                                            </div>
                                        </section>
                                    );
                                })}
                            </div>
                        )}
                    </Form.List>
                </Form>
            </Modal>
        </>
    );
}

function pricingColumns(onEdit: (model: LogicalModel) => void): TableColumnsType<LogicalModel> {
    return [
        {
            title: "逻辑模型",
            render: (_, model) => (
                <div>
                    <b>{model.name}</b>
                    <div className="text-xs text-stone-500">
                        {model.id} · {model.capability}
                    </div>
                </div>
            ),
        },
        { title: "销售价格卡", render: (_, model) => <RateCard value={model.saleRateCard} /> },
        {
            title: "绑定成本与单位换算",
            render: (_, model) => (
                <div className="space-y-2">
                    {model.bindings.map((binding) => (
                        <div key={binding.id} className="text-xs">
                            <b>
                                {binding.channelId} / {binding.upstreamModel}
                            </b>
                            <div className="text-stone-500">
                                成本：{rateCardText(binding.costRateCard)} · 单位：{providerUnitText(binding.providerCostUnit)}
                            </div>
                        </div>
                    ))}
                </div>
            ),
        },
        {
            title: "操作",
            fixed: "right",
            width: 100,
            render: (_, model) => (
                <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => onEdit(model)}>
                    编辑计价
                </Button>
            ),
        },
    ];
}

function RateComponentsEditor({ name, title, required = false }: { name: string | Array<string | number>; title: string; required?: boolean }) {
    const dimensions: Array<{ value: PricingDimension; label: string }> = [
        { value: "inputTokens", label: "输入 Token" },
        { value: "outputTokens", label: "输出 Token" },
        { value: "count", label: "生成数量" },
        { value: "durationSeconds", label: "时长（秒）" },
        { value: "quality", label: "质量" },
        { value: "resolution", label: "分辨率" },
        { value: "format", label: "格式" },
    ];
    return (
        <div className="rounded-xl bg-stone-50/70 p-3 dark:bg-stone-900/45">
            <div className="mb-2 text-xs font-semibold text-stone-700 dark:text-stone-200">{title}</div>
            <Form.List name={name} rules={required ? [{ validator: async (_, value) => (Array.isArray(value) && value.length ? undefined : Promise.reject(new Error("至少配置一个价格组件"))) }] : undefined}>
                {(fields, { add, remove }, { errors }) => (
                    <div className="space-y-2">
                        {fields.map((field) => (
                            <div key={field.key} className="grid min-w-0 gap-2 rounded-lg border border-stone-200 bg-white p-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto] dark:border-stone-800 dark:bg-stone-950">
                                <Form.Item className="mb-0" label="组件 ID" name={[field.name, "id"]} rules={[{ required: true }]}>
                                    <Input />
                                </Form.Item>
                                <Form.Item className="mb-0" label="计价维度" name={[field.name, "dimension"]} rules={[{ required: true }]}>
                                    <Select options={dimensions} />
                                </Form.Item>
                                <Form.Item className="mb-0" label="单价" name={[field.name, "unitPrice"]} rules={[{ required: true, pattern: /^(?:0|[1-9]\d*)(?:\.\d+)?$/ }]}>
                                    <Input inputMode="decimal" />
                                </Form.Item>
                                <Form.Item className="mb-0" label="每单位" name={[field.name, "per"]}>
                                    <Input inputMode="decimal" placeholder="默认 1" />
                                </Form.Item>
                                <Form.Item className="mb-0" label="匹配值" name={[field.name, "match"]}>
                                    <Input placeholder="分类维度必填" />
                                </Form.Item>
                                <Button className="self-end" danger aria-label="删除价格组件" icon={<Trash2 className="size-3.5" />} onClick={() => remove(field.name)} />
                            </div>
                        ))}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <Form.ErrorList errors={errors} />
                            <Button size="small" icon={<Plus className="size-3.5" />} onClick={() => add({ id: "", dimension: "count", unitPrice: "0", per: "1", match: "" })}>
                                添加价格组件
                            </Button>
                        </div>
                    </div>
                )}
            </Form.List>
        </div>
    );
}

function defaultPricingComponent(capability: LogicalModel["capability"]): PricingComponentForm {
    return { id: capability === "text" ? "input" : "count", dimension: capability === "text" ? "inputTokens" : "count", unitPrice: "0", per: "1" };
}

function cleanPricingComponent(component: PricingComponentForm): PricingComponent {
    const per = component.per?.trim();
    const match = component.match?.trim();
    return { id: component.id.trim(), dimension: component.dimension, unitPrice: component.unitPrice.trim(), ...(per ? { per } : {}), ...(match ? { match } : {}) };
}

function UsagePanel({ mode }: { mode: "usage" | "recovery" }) {
    const { message } = App.useApp();
    const [items, setItems] = useState<AdminUsageAuditItem[]>([]);
    const [recovery, setRecovery] = useState<AdminRecoveryItem[]>([]);
    const [stats, setStats] = useState({ total: 0, zeroUsage: 0, negativeMargin: 0 });
    const [page, setPage] = useState(1);
    const [recoveryPage, setRecoveryPage] = useState(1);
    const [recoveryTotal, setRecoveryTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [recovering, setRecovering] = useState(false);
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await getAdminUsageAudit({ page, pageSize: PAGE_SIZE, recoveryPage, recoveryPageSize: PAGE_SIZE });
            setItems(result.items);
            setRecovery(result.recovery);
            setStats({ total: result.total, zeroUsage: result.zeroUsage, negativeMargin: result.negativeMargin });
            setRecoveryTotal(result.recoveryTotal);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加载用量审计失败");
        } finally {
            setLoading(false);
        }
    }, [message, page, recoveryPage]);
    useEffect(() => {
        void load();
    }, [load]);
    const runRecovery = async () => {
        setRecovering(true);
        try {
            const result = await recoverAdminUsageHolds();
            message.success(`已检查 ${result.inspected} 项，结算 ${result.settled} 项，释放 ${result.released} 项`);
            await load();
        } finally {
            setRecovering(false);
        }
    };
    if (mode === "recovery")
        return (
            <Panel
                title="孤儿预留恢复"
                description="仅检查已到期或已进入人工复核的钱包预留，复用 Worker 的真实任务证据检查与恢复编排。"
                action={
                    <Button type="primary" loading={recovering} icon={<RefreshCw className="size-4" />} onClick={() => void runRecovery()}>
                        立即检查
                    </Button>
                }
            >
                <Table rowKey="id" size="small" loading={loading} pagination={false} scroll={{ x: 880 }} dataSource={recovery} columns={recoveryColumns} />
                {recoveryTotal > PAGE_SIZE ? <Pagination className="mt-4" current={recoveryPage} total={recoveryTotal} pageSize={PAGE_SIZE} showSizeChanger={false} onChange={setRecoveryPage} /> : null}
            </Panel>
        );
    return (
        <Panel
            title="用量、成本与毛利"
            description="销售积分按 USD 等值口径与真实供应商成本对照，并标出零用量成本和负毛利异常。"
            action={
                <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
                    刷新
                </Button>
            }
        >
            <div className="grid grid-cols-3 gap-2">
                <Metric label="用量账单" value={stats.total} />
                <Metric label="零用量有成本" value={stats.zeroUsage} tone={stats.zeroUsage ? "danger" : undefined} />
                <Metric label="负毛利" value={stats.negativeMargin} tone={stats.negativeMargin ? "danger" : undefined} />
            </div>
            <Table className="mt-4" rowKey="id" size="small" loading={loading} pagination={false} scroll={{ x: 1080 }} dataSource={items} columns={usageColumns} expandable={{ expandedRowRender: (item) => <ProviderAttemptsPanel chargeId={item.id} /> }} />
            {stats.total > PAGE_SIZE ? <Pagination className="mt-4" current={page} total={stats.total} pageSize={PAGE_SIZE} showSizeChanger={false} onChange={setPage} /> : null}
        </Panel>
    );
}

const usageColumns: TableColumnsType<AdminUsageAuditItem> = [
    { title: "用户", dataIndex: "user", width: 210, render: (_, item) => <AdminUserIdentity {...item.user} fallback="用户信息不可用" /> },
    {
        title: "账单",
        dataIndex: "id",
        width: 190,
        render: (value: string, item) => (
            <div className="font-mono text-xs">
                {value}
                <div className="mt-1 text-stone-500">
                    {item.capability} · {item.usageSource}
                    {item.estimated ? " · 估算" : ""}
                </div>
            </div>
        ),
    },
    { title: "销售积分 / USD", dataIndex: "settledCredits", width: 140 },
    { title: "供应商成本 USD", dataIndex: "providerCostUsd", width: 150 },
    { title: "毛利 USD", dataIndex: "marginUsd", width: 120, render: (value: string) => <span className={value.startsWith("-") ? "text-rose-600" : "text-emerald-600"}>{value}</span> },
    {
        title: "异常",
        dataIndex: "anomaly",
        width: 150,
        render: (value: AdminUsageAuditItem["anomaly"]) =>
            value === "none" ? (
                <Tag color="green">正常</Tag>
            ) : (
                <Tag color="red" icon={<AlertTriangle className="mr-1 inline size-3" />}>
                    {value === "zero_usage_cost" ? "零用量有成本" : "负毛利"}
                </Tag>
            ),
    },
    { title: "时间", dataIndex: "createdAt", width: 170, render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm") },
];
const recoveryColumns: TableColumnsType<AdminRecoveryItem> = [
    { title: "预留 ID", dataIndex: "id", width: 210, render: (value: string) => <span className="font-mono text-xs">{value}</span> },
    { title: "用户", dataIndex: "user", width: 210, render: (_, item) => <AdminUserIdentity {...item.user} fallback="用户信息不可用" /> },
    { title: "预留积分", dataIndex: "amount", width: 110 },
    { title: "业务 ID", dataIndex: "businessId", width: 220 },
    { title: "复核原因", dataIndex: "reviewReason", width: 230, render: (value?: string) => value || "已过期待检查" },
];

function ProviderAttemptsPanel({ chargeId }: { chargeId: string }) {
    const { message } = App.useApp();
    const [items, setItems] = useState<AdminProviderUsageAttempt[]>([]);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        let active = true;
        setLoading(true);
        void getAdminUsageAttempts(chargeId, { page, pageSize: 10 })
            .then((result) => {
                if (!active) return;
                setItems(result.items);
                setTotal(result.total);
            })
            .catch((error) => {
                if (active) message.error(error instanceof Error ? error.message : "加载供应商尝试失败");
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [chargeId, message, page]);
    return (
        <div className="min-w-0 rounded-lg border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-900/45">
            <div className="mb-2 text-xs font-semibold text-stone-700 dark:text-stone-200">供应商尝试（失败尝试同样计入真实成本）</div>
            <Table rowKey="id" size="small" loading={loading} pagination={false} scroll={{ x: 980 }} dataSource={items} columns={attemptColumns} />
            {total > 10 ? <Pagination className="mt-3" size="small" current={page} total={total} pageSize={10} showSizeChanger={false} onChange={setPage} /> : null}
        </div>
    );
}

const attemptColumns: TableColumnsType<AdminProviderUsageAttempt> = [
    { title: "尝试", dataIndex: "attemptNumber", width: 75, render: (value: number) => `#${value}` },
    { title: "状态", dataIndex: "status", width: 105, render: (value: AdminProviderUsageAttempt["status"]) => <Tag color={value === "succeeded" ? "green" : value === "failed" ? "red" : value === "pending" ? "blue" : "default"}>{value}</Tag> },
    {
        title: "供应商 / 绑定",
        width: 220,
        render: (_, item) => (
            <span className="text-xs">
                {item.provider} · {item.bindingId}
            </span>
        ),
    },
    { title: "原生金额", dataIndex: "nativeCostAmount", width: 120 },
    { title: "成本单位", width: 180, render: (_, item) => providerUnitText(item.nativeCostUnit) },
    { title: "USD 换算快照", dataIndex: "usdConversionRate", width: 150 },
    { title: "成本 USD", dataIndex: "costUsd", width: 120 },
    { title: "完成时间", dataIndex: "completedAt", width: 170, render: (value?: string) => (value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—") },
];

function ReconciliationPanel() {
    const [open, setOpen] = useState(false);
    return (
        <Panel
            title="支付商对账"
            description="导入支付商账单，按 PaymentAmount 比较 VND 最小单位或加密资产原子单位，不使用模糊的分值字段。"
            action={
                <Button type="primary" icon={<FileUp className="size-4" />} onClick={() => setOpen(true)}>
                    导入账单
                </Button>
            }
        >
            <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500 dark:border-stone-700">选择“导入账单”查看近期批次、差异金额和逐行异常。</div>
            <BillingReconciliationImport open={open} onClose={() => setOpen(false)} />
        </Panel>
    );
}

function PaymentPanel({ initial, embedded }: { initial?: PaymentConfigSummary; embedded: boolean }) {
    const { message } = App.useApp();
    const [config, setConfig] = useState<PaymentConfigSummary | null>(initial || null);
    const [loading, setLoading] = useState(!initial);
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch("/api/admin/billing/payment-config", { cache: "no-store" });
            const payload = (await response.json().catch(() => null)) as { paymentConfig?: PaymentConfigSummary; error?: string } | null;
            if (!response.ok || !payload?.paymentConfig) throw new Error(payload?.error || "加载支付配置失败");
            setConfig(payload.paymentConfig);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加载支付配置失败");
        } finally {
            setLoading(false);
        }
    }, [message]);
    useEffect(() => {
        if (!config) void load();
    }, [config, load]);
    return <PaymentConfigPanel paymentConfig={config} loading={loading} embedded={embedded} onRefresh={load} onCopy={(value) => void navigator.clipboard.writeText(value)} />;
}

function Panel({ title, description, action, children }: { title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className="min-w-0 overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
            <header className="flex items-start justify-between gap-3 border-b border-stone-200 p-3 sm:p-5 dark:border-stone-800">
                <div>
                    <h2 className="text-lg font-semibold">{title}</h2>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-stone-500 dark:text-stone-400">{description}</p>
                </div>
                {action}
            </header>
            <div className="min-w-0 p-3 sm:p-5">{children}</div>
        </section>
    );
}
function Metric({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "danger" }) {
    return (
        <div
            className={`min-w-0 rounded-xl border p-3 ${tone === "danger" ? "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200" : "border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900/50"}`}
        >
            <div className="text-xs opacity-65">{label}</div>
            <div className="mt-1 truncate text-lg font-semibold">{value}</div>
        </div>
    );
}
function RateCard({ value }: { value?: LogicalModel["saleRateCard"] }) {
    return <span className="text-xs text-stone-500">{rateCardText(value)}</span>;
}
function rateCardText(value: LogicalModel["saleRateCard"] | undefined) {
    return value?.components?.length ? value.components.map((item) => `${item.dimension}=${item.unitPrice}${item.per ? `/${item.per}` : ""}`).join("；") : "未配置";
}
function providerUnitText(value: LogicalModel["bindings"][number]["providerCostUnit"]) {
    return !value ? "未配置" : value.kind === "fiat" ? value.currency : `${value.provider}:${value.unit} × ${value.usdConversion.usdPerUnit} USD (${value.usdConversion.version})`;
}
function formatVnd(value: string) {
    return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(BigInt(value))} ₫`;
}
function formatUsd(value: string) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 8 }).format(Number(value));
}
function statusLabel(status: TopUpOrderStatus) {
    return ({ pending: "待支付", paid: "已支付", canceled: "已取消", refunding: "退款中", refunded: "已退款" } as const)[status];
}
function statusColor(status: TopUpOrderStatus) {
    return status === "paid" ? "green" : status === "pending" ? "gold" : status === "refunding" ? "orange" : status === "refunded" ? "blue" : "default";
}
