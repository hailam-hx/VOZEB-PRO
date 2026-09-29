"use client";

import { App, Button, DatePicker, Form, Input, InputNumber, Modal, Pagination, Segmented, Select, Switch, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { AlertTriangle, CircleDollarSign, FileUp, Pencil, Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";

import { allowedAdminBillingTabs, hasAdminPermission, type AdminBillingTab } from "@/lib/admin-permissions";
import type { AdminBillingSummary, AdminProviderUsageAttempt, AdminRecoveryItem, AdminTopUpConfig, AdminUsageAuditItem } from "@/lib/admin-billing-types";
import type { LogicalModel, LogicalModelBinding } from "@/lib/auth/store";
import { formatVndAmount as formatVnd, type ProviderCostUnit } from "@/lib/billing/money";
import type { ModelEstimatorCoverage } from "@/lib/billing/creative-sale-estimator";
import type { PricingBasis, PricingComponent, PricingConditionDimension, PricingDimension } from "@/lib/billing/pricing";
import type { SystemPricingPolicy } from "@/lib/billing/pricing-policy";
import { providerPricingNonExecutableFields, type ProviderPricingProfile } from "@/lib/billing/provider-pricing";
import { hasApprovedSalePriceDrift } from "@/lib/billing/suggested-sale-approval";
import type { PaymentConfigSummary } from "@/lib/payment-config-types";
import { AdminUserIdentity } from "@/components/admin/admin-user-identity";
import {
    applyAdminSuggestedSalePrices,
    closeAdminTopUpOrder,
    deleteAdminTopUpPreset,
    getAdminModelPricing,
    getAdminTopUpConfig,
    getAdminTopUpSummary,
    getAdminUsageAttempts,
    getAdminUsageAudit,
    listAdminTopUpOrders,
    listAdminTopUpPresets,
    recoverAdminUsageHolds,
    receiveAdminTopUpOrder,
    probeAdminDflopModelCapability,
    refundAdminTopUpOrder,
    saveAdminTopUpConfig,
    saveAdminModelPricing,
    saveAdminPricingPolicy,
    saveAdminTopUpPreset,
    updateAdminProviderPricingDimension,
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
type PricingPolicyForm = Pick<SystemPricingPolicy, "cnyToUsd" | "hotxUsdPerCredit" | "markupMultiplier" | "minimumMarginRate" | "costBasis" | "autoApplySalePrice">;

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
    const [actioning, setActioning] = useState("");

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
                setActioning(`refund:${order.id}`);
                try {
                    await refundAdminTopUpOrder(order.id, reason);
                    message.success("退款请求已处理");
                    await load();
                } finally {
                    setActioning("");
                }
            },
        });
    };

    const receive = (order: TopUpOrder) =>
        modal.confirm({
            title: "确认已收到款项？",
            content: `订单 ${order.orderNo} 将按快照发放 ${order.creditAmount} 积分；重复确认不会重复发放。`,
            okText: "确认收款",
            onOk: async () => {
                setActioning(`receive:${order.id}`);
                try {
                    const result = await receiveAdminTopUpOrder(order.id);
                    message.success(result.duplicate ? "该订单已确认收款" : "收款已确认，积分已发放");
                    await load();
                } finally {
                    setActioning("");
                }
            },
        });

    const close = (order: TopUpOrder) =>
        modal.confirm({
            title: "确认关闭未支付订单？",
            content: `订单 ${order.orderNo} 关闭后不会发放积分。`,
            okText: "确认关单",
            okButtonProps: { danger: true },
            onOk: async () => {
                setActioning(`close:${order.id}`);
                try {
                    const result = await closeAdminTopUpOrder(order.id);
                    message.success(result.duplicate ? "该订单已关闭" : "订单已关闭");
                    await load();
                } finally {
                    setActioning("");
                }
            },
        });

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
        { title: "渠道", dataIndex: "provider", width: 100, render: (value: string) => adminTopUpProviderLabel(value) },
        ...(canManageBilling
            ? [
                  {
                      title: "操作",
                      fixed: "right",
                      width: 150,
                      render: (_, order) => {
                          const actions = adminTopUpOrderActions(order);
                          return actions.length ? (
                              <div className="flex items-center gap-2">
                                  {actions.includes("receive") ? (
                                      <Button type="primary" size="small" loading={actioning === `receive:${order.id}`} onClick={() => receive(order)}>
                                          收款
                                      </Button>
                                  ) : null}
                                  {actions.includes("close") ? (
                                      <Button danger size="small" loading={actioning === `close:${order.id}`} onClick={() => close(order)}>
                                          关单
                                      </Button>
                                  ) : null}
                                  {actions.includes("refund") ? (
                                      <Button danger size="small" loading={actioning === `refund:${order.id}`} onClick={() => refund(order)}>
                                          退款
                                      </Button>
                                  ) : null}
                              </div>
                          ) : (
                              <span className="text-stone-400">—</span>
                          );
                      },
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
    const [editing, setEditing] = useState(false);
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
        setEditing(Boolean(preset));
        form.setFieldsValue(preset || { name: "", description: "", nominalNativeAmount: "", enabled: true, sortOrder: presets.length + 1 });
        setOpen(true);
    };
    const save = async () => {
        try {
            const value = await resolveFormValidation(form.validateFields());
            if (!value) return;
            setSaving(true);
            await saveAdminTopUpPreset(value);
            message.success("充值预设已保存");
            setOpen(false);
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存充值预设失败");
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
            <Modal forceRender title={editing ? "编辑充值预设" : "新建充值预设"} open={open} confirmLoading={saving} onOk={() => void save()} onCancel={() => setOpen(false)} okText="保存" cancelText="取消" width="min(560px, calc(100vw - 24px))">
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
    const { message, modal } = App.useApp();
    const canProbeUpstream = useUserStore((state) => hasAdminPermission(state.user, "billing.manage") && hasAdminPermission(state.user, "upstream.manage"));
    const [form] = Form.useForm<AdminTopUpConfig>();
    const [pricingForm] = Form.useForm<ModelPricingForm>();
    const [policyForm] = Form.useForm<PricingPolicyForm>();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [pricingSaving, setPricingSaving] = useState(false);
    const [probingBindingId, setProbingBindingId] = useState("");
    const [editingModel, setEditingModel] = useState<LogicalModel>();
    const [models, setModels] = useState<LogicalModel[]>([]);
    const [pricingPolicy, setPricingPolicy] = useState<SystemPricingPolicy>();
    const [estimatorCoverage, setEstimatorCoverage] = useState<ModelEstimatorCoverage>();
    const [selectedPricingModelIds, setSelectedPricingModelIds] = useState<string[]>([]);
    const [approvalPreview, setApprovalPreview] = useState<LogicalModel[]>();
    const [approvalSaving, setApprovalSaving] = useState(false);
    const [priceCoverageFilter, setPriceCoverageFilter] = useState<"all" | "missing">("all");
    const [approvalReadinessFilter, setApprovalReadinessFilter] = useState<"all" | "ready">("all");
    const [modelSearch, setModelSearch] = useState("");
    const deferredModelSearch = useDeferredValue(modelSearch);
    const visiblePricingModels = useMemo(
        () =>
            models.filter(
                (model) =>
                    matchesPricingModelSearch(model, deferredModelSearch) && (priceCoverageFilter === "missing" ? !model.saleRateCard : true) && (approvalReadinessFilter === "ready" ? suggestedSaleApprovalReady(model, pricingPolicy?.version) : true),
            ),
        [approvalReadinessFilter, deferredModelSearch, models, priceCoverageFilter, pricingPolicy?.version],
    );
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [topUp, pricing] = await Promise.all([getAdminTopUpConfig(), getAdminModelPricing()]);
            if (topUp.config) form.setFieldsValue(topUp.config);
            setModels(pricing.models);
            setPricingPolicy(pricing.pricingPolicy);
            setEstimatorCoverage(pricing.estimatorCoverage);
            policyForm.setFieldsValue(pricing.pricingPolicy);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加载定价配置失败");
        } finally {
            setLoading(false);
        }
    }, [form, message, policyForm]);
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
                bindings: value.bindings
                    .filter((_, index) => !editingModel?.bindings[index]?.providerPricingProfile)
                    .map((binding) => {
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
    const savePolicy = async () => {
        setPricingSaving(true);
        try {
            const policy = await saveAdminPricingPolicy(await policyForm.validateFields());
            setPricingPolicy(policy);
            message.success("DFLOP 成本换算与建议售价策略已保存");
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存定价策略失败");
        } finally {
            setPricingSaving(false);
        }
    };
    const updateProviderDimension = async (modelId: string, bindingId: string, dimensionId: string, effectiveValue?: string) => {
        setPricingSaving(true);
        try {
            const result = await updateAdminProviderPricingDimension({
                modelId,
                dimensionCommand: effectiveValue === undefined ? { action: "restore_upstream", bindingId, dimensionId } : { action: "set_manual", bindingId, dimensionId, effectiveValue },
            });
            setModels((current) => current.map((model) => (model.id === result.model.id ? result.model : model)));
            setEditingModel(result.model);
            message.success(effectiveValue === undefined ? "已恢复上游价格" : "人工成本价格已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新价格维度失败");
        } finally {
            setPricingSaving(false);
        }
    };
    const probeProviderCapability = (modelId: string, binding: LogicalModelBinding) => {
        const qwen = binding.upstreamModel.toLowerCase() === "qwen-image-3.0-pro";
        modal.confirm({
            title: "重新验证 DFLOP 能力与计价契约？",
            content: qwen ? "将按顺序提交 7 个最小图片探测请求并读取 DFLOP 调用日志；请求可能产生上游费用。" : "将提交 1 个最小 Responses image_generation 探测请求并读取 DFLOP 调用日志；请求可能产生上游费用。",
            okText: "开始验证",
            onOk: async () => {
                setProbingBindingId(binding.id);
                try {
                    const result = await probeAdminDflopModelCapability({ modelId, bindingId: binding.id });
                    setModels((current) => current.map((model) => (model.id === result.model.id ? result.model : model)));
                    setEditingModel(result.model);
                    message.success(`能力验证完成：${result.probe.outcome}`);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "能力验证失败");
                    throw error;
                } finally {
                    setProbingBindingId("");
                }
            },
        });
    };
    const openSuggestedApproval = (modelIds: string[]) => {
        const selected = modelIds.flatMap((modelId) => models.find((model) => model.id === modelId) || []);
        if (!selected.length) return message.warning("请选择需要应用建议售价的逻辑模型");
        setApprovalPreview(selected);
    };
    const applySuggestedApproval = async () => {
        if (!approvalPreview?.length || !pricingPolicy) return;
        setApprovalSaving(true);
        try {
            const result = await applyAdminSuggestedSalePrices({
                modelIds: approvalPreview.map((model) => model.id),
                suggestedRevisions: Object.fromEntries(approvalPreview.flatMap((model) => (model.suggestedSaleRateCard ? [[model.id, model.suggestedSaleRateCard.rateCard.revision]] : []))),
                pricingPolicyVersion: pricingPolicy.version,
            });
            if (result.skipped.length) message.warning(`已应用 ${result.applied.length} 个，跳过 ${result.skipped.length} 个：${result.skipped.map((item) => `${item.modelId}（${item.reason}）`).join("、")}`);
            else message.success(`已应用 ${result.applied.length} 个建议售价`);
            setApprovalPreview(undefined);
            setSelectedPricingModelIds([]);
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "应用建议售价失败");
        } finally {
            setApprovalSaving(false);
        }
    };
    return (
        <>
            <Panel
                title="客户汇率与模型计价"
                description="客户充值汇率、逻辑模型售价、绑定成本价和供应商原生单位换算分开管理；成本与毛利仅管理员可见。"
                action={
                    <div className="flex flex-wrap gap-2">
                        <Button icon={<Save className="size-4" />} loading={pricingSaving} onClick={() => void savePolicy()}>
                            保存成本策略
                        </Button>
                        <Button icon={<CircleDollarSign className="size-4" />} disabled={!selectedPricingModelIds.length} onClick={() => openSuggestedApproval(selectedPricingModelIds)}>
                            批量应用建议售价
                        </Button>
                        <Button type="primary" icon={<Save className="size-4" />} loading={saving} onClick={() => void save()}>
                            保存充值汇率
                        </Button>
                    </div>
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
                <div className="mt-4 rounded-xl border border-stone-200 p-3 dark:border-stone-800">
                    <div className="mb-1 text-sm font-semibold">DFLOP 成本换算与建议售价</div>
                    <div className="mb-3 text-xs text-stone-500">markupMultiplier=1 仅表示盈亏平衡成本基准；默认不会覆盖正式销售价格。</div>
                    <Form form={policyForm} layout="vertical">
                        <div className="grid gap-x-3 sm:grid-cols-2 lg:grid-cols-4">
                            <Form.Item label={`DFLOP credits/CNY${pricingPolicy ? `（${pricingPolicy.dflopCreditsPerCnySource}）` : ""}`}>
                                <Input value={pricingPolicy?.dflopCreditsPerCny} disabled />
                            </Form.Item>
                            <Form.Item label="CNY → USD" name="cnyToUsd" rules={[{ required: true }]}>
                                <Input inputMode="decimal" />
                            </Form.Item>
                            <Form.Item label="1 HOTX credit 对应 USD" name="hotxUsdPerCredit" rules={[{ required: true }]}>
                                <Input inputMode="decimal" />
                            </Form.Item>
                            <Form.Item label="建议售价加价系数" name="markupMultiplier" rules={[{ required: true }]}>
                                <Input inputMode="decimal" />
                            </Form.Item>
                            <Form.Item label="最低毛利率（可空）" name="minimumMarginRate">
                                <Input inputMode="decimal" placeholder="暂不强制" />
                            </Form.Item>
                            <Form.Item label="建议价成本基准" name="costBasis">
                                <Select
                                    options={[
                                        { value: "max_active_binding_cost", label: "最高启用 Binding 成本" },
                                        { value: "primary_binding_cost", label: "主 Binding 成本" },
                                    ]}
                                />
                            </Form.Item>
                            <Form.Item label="自动应用正式售价" name="autoApplySalePrice" valuePropName="checked">
                                <Switch disabled aria-label="自动应用正式售价（暂未开放）" />
                            </Form.Item>
                            <Form.Item label="策略版本">
                                <Input value={pricingPolicy?.version} disabled />
                            </Form.Item>
                        </div>
                    </Form>
                </div>
                {estimatorCoverage ? (
                    <div className="mt-4 rounded-xl border border-stone-200 p-3 dark:border-stone-800">
                        <div className="text-sm font-semibold">预计积分覆盖率</div>
                        <div className="mt-1 text-xs text-stone-500">按当前可路由逻辑模型与正式售价统计；无法安全估算的模型保留明确原因。</div>
                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                            {[
                                ["可路由模型", estimatorCoverage.totalRoutableModels],
                                ["已配置正式售价", estimatorCoverage.officialPriceConfigured],
                                ["精确估算", estimatorCoverage.exactEstimate],
                                ["保守估算", estimatorCoverage.conservativeEstimate],
                                ["缺少正式售价", estimatorCoverage.missingOfficialSalePrice],
                                ["计价基准不支持", estimatorCoverage.unsupportedPricingBasis],
                                ["缺少用量输入", estimatorCoverage.usageInputMissing],
                            ].map(([label, value]) => (
                                <div key={label} className="rounded-lg bg-stone-50 px-3 py-2 dark:bg-stone-900/60">
                                    <div className="text-[11px] text-stone-500">{label}</div>
                                    <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
                                </div>
                            ))}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-stone-600 dark:text-stone-300">
                            {(
                                [
                                    ["文本", "text"],
                                    ["图片", "image"],
                                    ["视频", "video"],
                                    ["音频", "audio"],
                                    ["音乐", "music"],
                                    ["数字人", "avatar"],
                                    ["其他", "other"],
                                ] as const
                            ).map(([label, key]) => (
                                <span key={key} className="rounded-full border border-stone-200 px-2 py-1 dark:border-stone-700">
                                    {label} {estimatorCoverage.byCategory[key].total} · 精确 {estimatorCoverage.byCategory[key].exact} · 保守 {estimatorCoverage.byCategory[key].conservative} · 缺价 {estimatorCoverage.byCategory[key].missingOfficialPrice}
                                </span>
                            ))}
                        </div>
                        <div className="mt-2 text-xs text-stone-500">
                            原因：
                            {Object.entries(estimatorCoverage.reasonBreakdown)
                                .map(([reason, count]) => `${reason} ${count}`)
                                .join(" · ") || "无"}
                        </div>
                    </div>
                ) : null}
                <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-stone-50 p-3 dark:bg-stone-900/45">
                    <div className="w-full sm:w-64">
                        <Input allowClear value={modelSearch} prefix={<Search className="size-4 text-stone-400" />} placeholder="搜索模型名称、ID 或上游模型" aria-label="搜索定价模型" onChange={(event) => setModelSearch(event.target.value)} />
                    </div>
                    <div>
                        <div className="mb-1 text-[11px] text-stone-500">正式售价</div>
                        <Segmented
                            size="small"
                            value={priceCoverageFilter}
                            onChange={(value) => setPriceCoverageFilter(value as "all" | "missing")}
                            options={[
                                { value: "all", label: "全部" },
                                { value: "missing", label: "缺少正式售价" },
                            ]}
                        />
                    </div>
                    <div>
                        <div className="mb-1 text-[11px] text-stone-500">审批资格</div>
                        <Segmented
                            size="small"
                            value={approvalReadinessFilter}
                            onChange={(value) => setApprovalReadinessFilter(value as "all" | "ready")}
                            options={[
                                { value: "all", label: "全部" },
                                { value: "ready", label: "可安全审批" },
                            ]}
                        />
                    </div>
                    <span className="text-xs text-stone-500">当前显示 {visiblePricingModels.length} 个模型</span>
                </div>
                <div className="mt-4 overflow-x-auto">
                    <Table
                        rowKey="id"
                        size="small"
                        loading={loading}
                        pagination={false}
                        scroll={{ x: 1320 }}
                        dataSource={visiblePricingModels}
                        columns={pricingColumns(editPricing, (model) => openSuggestedApproval([model.id]), pricingPolicy?.version)}
                        rowSelection={{ selectedRowKeys: selectedPricingModelIds, onChange: (keys) => setSelectedPricingModelIds(keys.map(String)) }}
                    />
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
                                            {binding?.providerPricingProfile ? (
                                                <ProviderPricingDimensions
                                                    modelId={editingModel!.id}
                                                    binding={binding}
                                                    saving={pricingSaving}
                                                    probing={probingBindingId === binding.id}
                                                    canProbe={canProbeUpstream}
                                                    onProbe={probeProviderCapability}
                                                    onSave={updateProviderDimension}
                                                />
                                            ) : null}
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
            <Modal
                title="确认应用建议售价"
                open={Boolean(approvalPreview)}
                width="min(860px, calc(100vw - 24px))"
                styles={{ body: { maxHeight: "min(72dvh, 720px)", overflowY: "auto" } }}
                okText="确认应用"
                cancelText="取消"
                confirmLoading={approvalSaving}
                okButtonProps={{ disabled: !approvalPreview?.some((model) => suggestedSaleApprovalReady(model, pricingPolicy?.version)) }}
                onOk={() => void applySuggestedApproval()}
                onCancel={() => (approvalSaving ? undefined : setApprovalPreview(undefined))}
            >
                <div className="space-y-3 pt-3">
                    <div className="text-xs text-stone-500">仅应用当前价格状态为 READY 的模型。保存时服务端会重新校验建议价 revision、策略版本和 binding 状态。</div>
                    <div className="flex gap-2 text-xs">
                        <Tag color="green">可应用 {approvalPreview?.filter((model) => suggestedSaleApprovalReady(model, pricingPolicy?.version)).length || 0}</Tag>
                        <Tag color="orange">跳过 {approvalPreview?.filter((model) => !suggestedSaleApprovalReady(model, pricingPolicy?.version)).length || 0}</Tag>
                    </div>
                    {approvalPreview?.map((model) => {
                        const readiness = suggestedSaleApprovalReadiness(model, pricingPolicy?.version);
                        const diff = buildSuggestedSalePriceDiff(model.saleRateCard, model.suggestedSaleRateCard?.rateCard);
                        return (
                            <section key={model.id} className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                        <b>{model.name}</b>
                                        <div className="text-xs text-stone-500">{model.id}</div>
                                    </div>
                                    <Tag color={readiness.ready ? "green" : "orange"}>{readiness.label}</Tag>
                                </div>
                                {model.suggestedSaleRateCard ? (
                                    <div className="mt-2 text-xs text-stone-500">
                                        策略：{model.suggestedSaleRateCard.pricingPolicyVersion} · 成本基准：{model.suggestedSaleRateCard.costBasis} · 计算时间：{model.suggestedSaleRateCard.calculatedAt}
                                    </div>
                                ) : null}
                                <div className="mt-3 space-y-1 text-xs">
                                    {diff.length ? (
                                        diff.map((item) => (
                                            <div key={item.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
                                                <span className="truncate">{item.label}</span>
                                                <span className="text-stone-500">{item.oldValue ?? "未配置"}</span>
                                                <span>→ {item.newValue ?? "删除"}</span>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-stone-500">没有可预览的建议售价维度</div>
                                    )}
                                </div>
                            </section>
                        );
                    })}
                </div>
            </Modal>
        </>
    );
}

function pricingColumns(onEdit: (model: LogicalModel) => void, onApplySuggestion: (model: LogicalModel) => void, pricingPolicyVersion?: string): TableColumnsType<LogicalModel> {
    return [
        {
            title: "逻辑模型",
            width: 240,
            render: (_, model) => (
                <div>
                    <b>{model.name}</b>
                    <div className="text-xs text-stone-500">
                        {model.id} · {model.capability}
                    </div>
                </div>
            ),
        },
        {
            title: "销售价格",
            width: 340,
            render: (_, model) => (
                <div className="space-y-2">
                    <div>
                        <span className="text-xs text-stone-500">正式售价{model.salePriceSource ? ` · ${model.salePriceSource}` : ""}</span>
                        {hasApprovedSalePriceDrift(model) ? (
                            <Tag className="ml-2" color="orange">
                                价格漂移
                            </Tag>
                        ) : null}
                        <RateCard value={model.saleRateCard} priceUnit="积分" />
                    </div>
                    <div>
                        <span className="text-xs text-stone-500">建议售价 · {model.suggestedSaleRateCard?.costBasis || "未计算"}</span>
                        <RateCard value={model.suggestedSaleRateCard?.rateCard} priceUnit="积分" />
                        {model.suggestedSaleRateCard ? (
                            <div className="mt-1 break-all text-[11px] text-stone-500">
                                策略 {model.suggestedSaleRateCard.pricingPolicyVersion} · 加价 {model.suggestedSaleRateCard.markupMultiplier} · revision {model.suggestedSaleRateCard.rateCard.revision}
                            </div>
                        ) : null}
                    </div>
                </div>
            ),
        },
        {
            title: "审批状态",
            width: 150,
            render: (_, model) => {
                const readiness = suggestedSaleApprovalReadiness(model, pricingPolicyVersion);
                return <Tag color={readiness.ready ? "green" : "orange"}>{readiness.label}</Tag>;
            },
        },
        {
            title: "绑定成本与单位换算",
            width: 360,
            render: (_, model) => (
                <div className="min-w-0 space-y-3">
                    {model.bindings.map((binding) => {
                        const costUnit = formatProviderCostUnitForAdmin(binding.providerCostUnit);
                        return (
                            <div key={binding.id} className="min-w-0 text-xs">
                                <b>
                                    {binding.channelId} / {binding.upstreamModel}
                                </b>
                                <div className="mt-1 text-stone-500 dark:text-stone-400">成本价格卡</div>
                                <RateCard value={binding.costRateCard} priceUnit={costUnit.priceUnit} />
                                <div className="mt-1 break-words text-stone-500 dark:text-stone-400">单位换算：{costUnit.conversionLabel}</div>
                            </div>
                        );
                    })}
                </div>
            ),
        },
        {
            title: "操作",
            fixed: "right",
            width: 150,
            render: (_, model) => (
                <div className="flex flex-col gap-1">
                    <Button size="small" icon={<CircleDollarSign className="size-3.5" />} disabled={!model.suggestedSaleRateCard} onClick={() => onApplySuggestion(model)}>
                        应用建议售价
                    </Button>
                    <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => onEdit(model)}>
                        编辑计价
                    </Button>
                </div>
            ),
        },
    ];
}

function ProviderPricingDimensions({
    modelId,
    binding,
    saving,
    probing,
    canProbe,
    onProbe,
    onSave,
}: {
    modelId: string;
    binding: LogicalModelBinding;
    saving: boolean;
    probing: boolean;
    canProbe: boolean;
    onProbe: (modelId: string, binding: LogicalModelBinding) => void;
    onSave: (modelId: string, bindingId: string, dimensionId: string, effectiveValue?: string) => Promise<void>;
}) {
    const profile = binding.providerPricingProfile!;
    const statusReasons = providerPricingStatusReasons(profile);
    const nonExecutable = new Set(providerPricingNonExecutableFields(profile));
    const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(profile.dimensions.map((dimension) => [dimension.id, dimension.effectiveValue])));
    useEffect(() => setValues(Object.fromEntries(profile.dimensions.map((dimension) => [dimension.id, dimension.effectiveValue]))), [profile]);
    return (
        <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900/70 dark:bg-blue-950/20">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold">DFLOP Provider Pricing Profile</div>
                <div className="flex items-center gap-2">
                    {canProbe && ["gpt-6", "gpt-6-astra", "qwen-image-3.0-pro"].includes(binding.upstreamModel.toLowerCase()) ? (
                        <Button size="small" icon={<RefreshCw className="size-3.5" />} loading={probing} onClick={() => onProbe(modelId, binding)}>
                            重新验证能力
                        </Button>
                    ) : null}
                    <Tag color={profile.status === "READY" ? "green" : profile.status === "STALE" ? "orange" : "gold"}>{profile.status}</Tag>
                </div>
            </div>
            <div className="mt-1 text-[11px] text-stone-500">
                同步：{profile.syncedAt} · {profile.conversion ? `换算策略 ${profile.conversion.pricingPolicyVersion}` : "尚未换算"}
            </div>
            {providerPricingExecutionSummary(profile).length ? <div className="mt-1 text-[11px] text-stone-600 dark:text-stone-300">{providerPricingExecutionSummary(profile).join(" · ")}</div> : null}
            {providerCapabilityProbeSummary(profile).map((summary) => (
                <div key={summary} className="mt-1 text-[11px] text-stone-500">
                    {summary}
                </div>
            ))}
            {statusReasons.length ? <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{statusReasons.join("；")}</div> : null}
            <div className="mt-2 space-y-2">
                {profile.dimensions.map((dimension) => (
                    <div
                        key={`${dimension.id}:${dimension.unit}`}
                        className="grid gap-2 rounded-lg border border-blue-100 bg-white p-2 sm:grid-cols-[minmax(150px,1.2fr)_minmax(100px,.7fr)_minmax(130px,.8fr)_auto] sm:items-end dark:border-blue-900/60 dark:bg-stone-950"
                    >
                        <div className="min-w-0 text-[11px]">
                            <b className="break-all">{dimension.id}</b>
                            <div className="text-stone-500">
                                scope: {dimension.operationScope || "other"} · upstream: {dimension.key || "—"} · usage: {providerPricingUsageSource(dimension.kind)} · executable: {nonExecutable.has(dimension.key || dimension.id) ? "no" : "yes"} ·
                                syncedAt: {dimension.syncedAt}
                            </div>
                            <div className="text-stone-500">
                                {dimension.unit} · override: {dimension.source === "manual" ? "manual" : "none"}
                                {dimension.conditions
                                    ? ` · ${Object.entries(dimension.conditions)
                                          .map(([key, value]) => `${key}=${value}`)
                                          .join(", ")}`
                                    : ""}
                            </div>
                        </div>
                        <div className="text-[11px]">
                            <span className="text-stone-500">上游</span>
                            <div>{dimension.upstreamValue ?? "缺失"} DFLOP credits</div>
                        </div>
                        <div>
                            <div className="mb-1 flex items-center gap-1 text-[11px]">
                                <Tag className="m-0" color={dimension.source === "manual" ? "gold" : "blue"}>
                                    {dimension.source}
                                </Tag>
                                <span className="text-stone-500">HOTX {dimension.providerCostHotxCredits ?? "待换算"}</span>
                            </div>
                            <Input size="small" value={values[dimension.id]} inputMode="decimal" onChange={(event) => setValues((current) => ({ ...current, [dimension.id]: event.target.value }))} />
                        </div>
                        <div className="flex gap-1">
                            <Button size="small" loading={saving} onClick={() => void onSave(modelId, binding.id, dimension.id, values[dimension.id])}>
                                保存
                            </Button>
                            <Button size="small" disabled={dimension.upstreamValue === undefined} onClick={() => void onSave(modelId, binding.id, dimension.id)}>
                                恢复上游
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function providerPricingUsageSource(kind: ProviderPricingProfile["dimensions"][number]["kind"]) {
    if (kind === "CACHE_CREATION") return "usage.cache_creation_input_tokens";
    if (kind === "SERVER_TOOL_CALL") return "usage.num_server_side_tools_used";
    if (kind === "IMAGE_INPUT") return "server request reference count";
    if (kind === "IMAGE_OUTPUT" || kind === "IMAGE_LARGE") return "server result count + canonical size";
    if (kind === "TOKEN_INPUT" || kind === "TOKEN_CACHED_INPUT" || kind === "TOKEN_OUTPUT") return "authoritative token usage";
    if (kind === "VIDEO_TOKEN") return "usage.completion_tokens";
    if (kind === "VIDEO_SECOND" || kind === "VIDEO_SECOND_STAGE") return "delivered duration";
    return "normalized server usage";
}

export function providerPricingStatusReasons(profile: ProviderPricingProfile) {
    return [...new Set([...profile.warnings.map((warning) => `${warning.code}: ${warning.message}`), ...providerPricingNonExecutableFields(profile).map((field) => `未进入可执行成本模型：${field}`)])];
}

export function providerPricingExecutionSummary(profile: ProviderPricingProfile) {
    if (profile.operationPricingStatus) {
        const labels: Partial<Record<keyof typeof profile.operationPricingStatus, string>> = {
            text_generation: "Text pricing",
            builtin_image_generation: "Built-in image pricing",
            standalone_image_generation: "Standalone image pricing",
            image_edit: "Image edit pricing",
            video_generation: "Video pricing",
            tts: "TTS pricing",
            voice_clone: "Voice clone pricing",
            music_generation: "Music pricing",
            avatar: "Avatar pricing",
            other: "Other pricing",
        };
        return Object.entries(profile.operationPricingStatus).map(([scope, value]) => `${labels[scope as keyof typeof labels] || scope}: ${value.status === "READY" ? "Executable" : value.status}`);
    }
    if (profile.metadata?.category !== "text") return [];
    const nonExecutable = new Set(providerPricingNonExecutableFields(profile));
    const textKinds = new Set(["TOKEN_INPUT", "TOKEN_CACHED_INPUT", "TOKEN_OUTPUT", "CACHE_CREATION", "SERVER_TOOL_CALL"]);
    const textDimensions = profile.dimensions.filter((dimension) => textKinds.has(dimension.kind) && dimension.effectiveValue !== "0");
    const crossModalDimensions = profile.dimensions.filter((dimension) => dimension.kind === "IMAGE_OUTPUT" && dimension.effectiveValue !== "0");
    const isExecutable = (dimension: ProviderPricingProfile["dimensions"][number]) => !nonExecutable.has(dimension.key || dimension.id);
    return [
        ...(textDimensions.length ? [`Text pricing: ${textDimensions.every(isExecutable) ? "Executable" : "Partial"}`] : []),
        ...(crossModalDimensions.length ? [`Cross-modal pricing: ${crossModalDimensions.every(isExecutable) ? "Executable" : "Partial"}`] : []),
    ];
}

export function providerCapabilityProbeSummary(profile: ProviderPricingProfile) {
    const probes = profile.metadata?.capabilityProbes;
    if (!probes || typeof probes !== "object" || Array.isArray(probes)) return ["Probe verified: no"];
    const summaries = Object.entries(probes as Record<string, unknown>).flatMap(([scope, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const probe = value as Record<string, unknown>;
        const evidence = probe.billingEvidence && typeof probe.billingEvidence === "object" && !Array.isArray(probe.billingEvidence) ? (probe.billingEvidence as Record<string, unknown>) : {};
        const cases = Array.isArray(probe.cases) ? probe.cases : [];
        return [
            `${scope} · Probe verified: yes · Last verified at: ${String(probe.probedAt || "—")} · Tier/Billing source: ${String(evidence.source || "none")} · Billing basis: ${String(evidence.basis || "unresolved")} · Result: ${String(probe.outcome || "inconclusive")} · Usage: ${probe.usageSeen === true ? "yes" : "no"} · Image output: ${probe.imageOutputSeen === true ? "yes" : "no"}${evidence.providerCost !== undefined ? ` · Provider cost: ${String(evidence.providerCost)}` : ""}${probe.requestId ? ` · Request ID: ${String(probe.requestId)}` : ""}`,
            ...cases.flatMap((item) => {
                if (!item || typeof item !== "object" || Array.isArray(item)) return [];
                const current = item as Record<string, unknown>;
                const actualSize = current.actualWidth && current.actualHeight ? `${current.actualWidth}x${current.actualHeight}` : "—";
                return [
                    `Probe case ${String(current.requestSize || "—")} → response ${String(current.responseSize || "—")} · actual ${actualSize} · HTTP ${String(current.statusCode || "—")} · billed ${String(current.billingAmount ?? "—")} ${String(current.billingUnit ?? "")} · tier ${String(current.billedTier || "—")} · request ${String(current.requestId || "—")} · task ${String(current.taskId || "—")} · usage record ${String(current.providerUsageRecordId || "—")}`,
                ];
            }),
        ];
    });
    const rawPrices = profile.metadata?.unscopedProviderPrices;
    const hasScopedImagePrice = profile.dimensions.some((dimension) => dimension.key === "price_per_image");
    if (!hasScopedImagePrice && rawPrices && typeof rawPrices === "object" && !Array.isArray(rawPrices) && (rawPrices as Record<string, unknown>).price_per_image !== undefined)
        summaries.push(`price_per_image: ${(rawPrices as Record<string, unknown>).price_per_image}（仅保留为 Raw provider metadata）`);
    return summaries;
}

function RateComponentsEditor({ name, title, required = false }: { name: string | Array<string | number>; title: string; required?: boolean }) {
    const dimensions: Array<{ value: PricingDimension; label: string }> = [
        { value: "request", label: "请求次数" },
        { value: "inputTokens", label: "输入 Token" },
        { value: "cachedInputTokens", label: "缓存输入 Token" },
        { value: "cacheCreationTokens", label: "缓存写入 Token" },
        { value: "outputTokens", label: "输出 Token" },
        { value: "serverToolCalls", label: "服务端工具调用" },
        { value: "inputImageCount", label: "输入参考图" },
        { value: "count", label: "生成数量" },
        { value: "megapixels", label: "总百万像素" },
        { value: "characters", label: "字符数" },
        { value: "durationSeconds", label: "时长（秒）" },
        { value: "quality", label: "质量" },
        { value: "resolution", label: "分辨率" },
        { value: "format", label: "格式" },
    ];
    const bases: Array<{ value: PricingBasis; label: string }> = [
        "TOKEN_INPUT",
        "TOKEN_CACHED_INPUT",
        "TOKEN_OUTPUT",
        "CACHE_CREATION",
        "SERVER_TOOL_CALL",
        "IMAGE_OUTPUT",
        "IMAGE_INPUT",
        "IMAGE_LARGE",
        "VIDEO_SECOND",
        "VIDEO_INPUT_SECOND",
        "VIDEO_TOKEN",
        "VIDEO_SECOND_STAGE",
        "TTS_CHARACTER",
        "VOICE_CLONE_CALL",
        "MUSIC_GENERATION",
        "AVATAR_CREATE",
        "AVATAR_SECOND",
        "TRANSCRIPT_CALL",
        "PER_GENERATION",
        "PER_CALL",
        "PER_CHARACTER",
        "PER_SECOND",
    ].map((value) => ({ value: value as PricingBasis, label: value }));
    return (
        <div className="rounded-xl bg-stone-50/70 p-3 dark:bg-stone-900/45">
            <div className="mb-2 text-xs font-semibold text-stone-700 dark:text-stone-200">{title}</div>
            <Form.List name={name} rules={required ? [{ validator: async (_, value) => (Array.isArray(value) && value.length ? undefined : Promise.reject(new Error("至少配置一个价格组件"))) }] : undefined}>
                {(fields, { add, remove }, { errors }) => (
                    <div className="space-y-2">
                        {fields.map((field) => (
                            <div key={field.key} className="min-w-0 rounded-lg border border-stone-200 bg-white p-2 dark:border-stone-800 dark:bg-stone-950">
                                <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr_auto]">
                                    <Form.Item className="mb-0" label="组件 ID" name={[field.name, "id"]} rules={[{ required: true }]}>
                                        <Input />
                                    </Form.Item>
                                    <Form.Item className="mb-0" label="计价维度" name={[field.name, "dimension"]} rules={[{ required: true }]}>
                                        <Select options={dimensions} />
                                    </Form.Item>
                                    <Form.Item className="mb-0" label="计价基准" name={[field.name, "basis"]}>
                                        <Select allowClear showSearch options={bases} placeholder="按维度推断" />
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
                                <div className="mt-2 grid gap-2 border-t border-dashed border-stone-200 pt-2 sm:grid-cols-2 lg:grid-cols-4 dark:border-stone-800">
                                    <Form.Item className="mb-0" label="条件：分辨率" name={[field.name, "when", "resolution"]}>
                                        <Input placeholder="例如 1920x1080" />
                                    </Form.Item>
                                    <Form.Item className="mb-0" label="条件：质量" name={[field.name, "when", "quality"]}>
                                        <Input placeholder="例如 standard" />
                                    </Form.Item>
                                    <Form.Item className="mb-0" label="条件：格式" name={[field.name, "when", "format"]}>
                                        <Input placeholder="例如 mp4" />
                                    </Form.Item>
                                    <Form.Item className="mb-0" label="条件：计费基准" name={[field.name, "when", "billingBasis"]}>
                                        <Select
                                            allowClear
                                            options={[
                                                { value: "default", label: "默认" },
                                                { value: "with_video_input", label: "含参考视频" },
                                            ]}
                                        />
                                    </Form.Item>
                                </div>
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
    const when = (["quality", "resolution", "format", "billingBasis"] as PricingConditionDimension[]).reduce<NonNullable<PricingComponent["when"]>>((result, dimension) => {
        const value = component.when?.[dimension]?.trim();
        if (value) result[dimension] = value;
        return result;
    }, {});
    return {
        id: component.id.trim(),
        dimension: component.dimension,
        ...(component.basis ? { basis: component.basis } : {}),
        unitPrice: component.unitPrice.trim(),
        ...(per ? { per } : {}),
        ...(match ? { match } : {}),
        ...(Object.keys(when).length ? { when } : {}),
    };
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
                <Table rowKey="id" size="small" loading={loading} pagination={false} scroll={{ x: 1050 }} dataSource={recovery} columns={recoveryColumns} />
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
    { title: "最近证据检查", dataIndex: "recoveryCheckedAt", width: 170, render: (value?: string) => (value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "尚未检查") },
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
function RateCard({ value, priceUnit }: { value?: LogicalModel["saleRateCard"]; priceUnit: string }) {
    const summary = formatPricingRateCardForAdmin(value, priceUnit);
    return (
        <div className="min-w-0 space-y-1 text-xs text-stone-600 dark:text-stone-300">
            {summary.componentLabels.map((label, index) => (
                <div key={`${index}-${label}`} className="break-words leading-5">
                    {label}
                </div>
            ))}
            {summary.versionLabel ? <div className="text-[11px] text-stone-400 dark:text-stone-500">{summary.versionLabel}</div> : null}
        </div>
    );
}

const pricingDimensionLabels: Record<PricingDimension, { label: string; unit: string }> = {
    request: { label: "请求次数", unit: "次" },
    inputTokens: { label: "输入 Token", unit: "Token" },
    cachedInputTokens: { label: "缓存输入 Token", unit: "Token" },
    cacheCreationTokens: { label: "缓存写入 Token", unit: "Token" },
    outputTokens: { label: "输出 Token", unit: "Token" },
    serverToolCalls: { label: "服务端工具调用", unit: "次" },
    inputImageCount: { label: "输入参考图", unit: "张" },
    count: { label: "生成数量", unit: "个" },
    megapixels: { label: "总百万像素", unit: "MP" },
    characters: { label: "字符数", unit: "字符" },
    durationSeconds: { label: "时长", unit: "秒" },
    quality: { label: "质量", unit: "个" },
    resolution: { label: "分辨率", unit: "个" },
    format: { label: "格式", unit: "个" },
};
const pricingConditionLabels: Record<PricingConditionDimension, string> = { quality: "质量", resolution: "分辨率", format: "格式", billingBasis: "计费基准", contextTier: "上下文档位", megapixelTier: "像素档位" };
const pricingConditionOrder: PricingConditionDimension[] = ["quality", "resolution", "format", "billingBasis", "contextTier", "megapixelTier"];

export function formatPricingRateCardForAdmin(value: LogicalModel["saleRateCard"] | undefined, priceUnit: string) {
    if (!value?.components?.length) return { versionLabel: "", componentLabels: ["未配置"] };
    return {
        versionLabel: `价格卡 v${value.version}`,
        componentLabels: value.components.map((item) => {
            const dimension = pricingDimensionLabels[item.dimension];
            const subject = item.match ? `${dimension.label} ${item.match}` : dimension.label;
            const conditions = pricingConditionOrder.flatMap((condition) => (item.when?.[condition] ? [`${pricingConditionLabels[condition]} ${item.when[condition]}`] : []));
            return `${subject}：${item.unitPrice} ${priceUnit} / ${item.per || "1"} ${dimension.unit}${conditions.length ? `（${conditions.join(" · ")}）` : ""}`;
        }),
    };
}

export function formatProviderCostUnitForAdmin(value: LogicalModel["bindings"][number]["providerCostUnit"]): { priceUnit: string; conversionLabel: string } {
    if (!value) return { priceUnit: "成本单位", conversionLabel: "未配置" };
    if (value.kind === "fiat") return { priceUnit: value.currency, conversionLabel: value.currency };
    return { priceUnit: value.unit, conversionLabel: `${value.provider} · 1 ${value.unit} = ${value.usdConversion.usdPerUnit} USD · ${value.usdConversion.version}` };
}

export function buildSuggestedSalePriceDiff(current: LogicalModel["saleRateCard"] | undefined, suggested: LogicalModel["saleRateCard"] | undefined) {
    const currentByDimension = new Map((current?.components || []).map((component) => [pricingComponentIdentity(component), component]));
    const suggestedByDimension = new Map((suggested?.components || []).map((component) => [pricingComponentIdentity(component), component]));
    return Array.from(new Set([...currentByDimension.keys(), ...suggestedByDimension.keys()]))
        .sort()
        .map((key) => {
            const oldComponent = currentByDimension.get(key);
            const newComponent = suggestedByDimension.get(key);
            const component = newComponent || oldComponent!;
            const dimension = pricingDimensionLabels[component.dimension];
            const conditions = pricingConditionOrder.flatMap((condition) => (component.when?.[condition] ? [`${pricingConditionLabels[condition]} ${component.when[condition]}`] : []));
            return {
                key,
                label: `${component.match ? `${dimension.label} ${component.match}` : dimension.label}${conditions.length ? `（${conditions.join(" · ")}）` : ""}`,
                ...(oldComponent ? { oldValue: oldComponent.unitPrice } : {}),
                ...(newComponent ? { newValue: newComponent.unitPrice } : {}),
                status: !oldComponent ? ("added" as const) : !newComponent ? ("removed" as const) : oldComponent.unitPrice === newComponent.unitPrice ? ("unchanged" as const) : ("changed" as const),
            };
        });
}

function pricingComponentIdentity(component: PricingComponent) {
    return JSON.stringify([component.dimension, component.per || "1", component.match || "", Object.entries(component.when || {}).sort(([left], [right]) => left.localeCompare(right))]);
}

export function matchesPricingModelSearch(model: Pick<LogicalModel, "id" | "name"> & { bindings: Pick<LogicalModelBinding, "upstreamModel">[] }, query: string) {
    const search = query.trim().toLowerCase();
    return !search || [model.name, model.id, ...model.bindings.map((binding) => binding.upstreamModel)].some((value) => value.toLowerCase().includes(search));
}

function suggestedSaleApprovalReady(model: LogicalModel, pricingPolicyVersion?: string) {
    return suggestedSaleApprovalReadiness(model, pricingPolicyVersion).ready;
}

function suggestedSaleApprovalReadiness(model: LogicalModel, pricingPolicyVersion?: string): { ready: boolean; label: string } {
    const suggestion = model.suggestedSaleRateCard;
    if (!suggestion) return { ready: false, label: "无建议售价" };
    if (!suggestion.bindingInputs.length) return { ready: false, label: "无计价 Binding" };
    const currentInputs = suggestion.bindingInputs.flatMap((input) => {
        const binding = model.bindings.find((candidate) => candidate.id === input.bindingId);
        return binding?.enabled ? [{ ...input, pricingStatus: binding.providerPricingProfile?.status || input.pricingStatus }] : [];
    });
    if (!model.enabled || currentInputs.length !== suggestion.bindingInputs.length) return { ready: false, label: "无计价 Binding" };
    const blocked = ["STALE", "PARTIAL", "NEEDS_REVIEW"].find((status) => currentInputs.some((input) => input.pricingStatus === status));
    if (blocked) return { ready: false, label: `跳过 · ${blocked}` };
    if (pricingPolicyVersion && suggestion.pricingPolicyVersion !== pricingPolicyVersion) return { ready: false, label: "跳过 · POLICY_CHANGED" };
    return { ready: true, label: "READY" };
}

function providerUnitText(value: LogicalModel["bindings"][number]["providerCostUnit"]) {
    return formatProviderCostUnitForAdmin(value).conversionLabel;
}
export async function resolveFormValidation<T>(validation: Promise<T>) {
    try {
        return await validation;
    } catch (error) {
        if (error && typeof error === "object" && !Array.isArray(error) && Array.isArray((error as { errorFields?: unknown }).errorFields)) return null;
        throw error;
    }
}
export function adminTopUpProviderLabel(provider: string) {
    if (provider === "zalopay") return "ZaloPay";
    return provider === "manual" ? "人工确认" : provider;
}
export function adminTopUpOrderActions(order: Pick<TopUpOrder, "provider" | "status">): Array<"receive" | "close" | "refund"> {
    if (order.status === "paid") return ["refund"];
    return order.provider === "manual" && order.status === "pending" ? ["receive", "close"] : [];
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
