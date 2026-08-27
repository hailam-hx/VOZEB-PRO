"use client";

import type { Dayjs } from "dayjs";
import { Button, DatePicker, Empty, Form, Input, InputNumber, Modal, Pagination, Segmented, Select, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import { ArrowUpCircle, History, RefreshCw, Sparkles, WalletCards } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AdminUserIdentity, AdminUserSearchSelect, type AdminUserSearchEntry } from "@/components/admin/admin-user-identity";
import { Metric, Panel, PanelHeader } from "@/components/admin/admin-panel";
import { formatCreditAmount } from "@/constant/credits";
import { hasAdminPermission } from "@/lib/admin-permissions";
import type { AdminPointDirection, AdminPointLedgerItem, AdminPointRecordType, AdminPointSummary, AdminPointUserOption } from "@/lib/admin-points-types";
import { adjustAdminPoints, listAdminPoints, searchAdminPointsUsers } from "@/services/api/admin-points";

import { projectAdminPointAdjustment } from "./admin-points-model";
import type { AdminDashboardController } from "./use-admin-dashboard-controller";

const EMPTY_SUMMARY: AdminPointSummary = { settledBalance: "0", heldBalance: "0", availableBalance: "0", recordCount: 0 };
const PAGE_SIZE = 20;

type AdjustmentForm = { userId: string; operation: "increase" | "decrease"; amount: string; reason: string };
type PointSearchEntry = AdminUserSearchEntry & Pick<AdminPointUserOption, "settledBalance" | "heldBalance" | "availableBalance">;

export function AdminPointsSection({ controller }: { controller: AdminDashboardController }) {
    const { activeSection, currentUser, message } = controller;
    const canManage = hasAdminPermission(currentUser, "billing.manage");
    const [form] = Form.useForm<AdjustmentForm>();
    const requestIdRef = useRef(0);
    const adjustmentRequestIdRef = useRef("");
    const [items, setItems] = useState<AdminPointLedgerItem[]>([]);
    const [summary, setSummary] = useState(EMPTY_SUMMARY);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const [userId, setUserId] = useState<string>();
    const [type, setType] = useState<AdminPointRecordType | "">("");
    const [direction, setDirection] = useState<AdminPointDirection | "">("");
    const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
    const [startAt, setStartAt] = useState<string>();
    const [endBefore, setEndBefore] = useState<string>();
    const [adjustmentOpen, setAdjustmentOpen] = useState(false);
    const [adjustmentSaving, setAdjustmentSaving] = useState(false);
    const [adjustmentUser, setAdjustmentUser] = useState<PointSearchEntry>();
    const operation = Form.useWatch("operation", form) || "increase";
    const amount = Form.useWatch("amount", form) || "";
    const projection = adjustmentUser ? projectAdminPointAdjustment({ settledBalance: adjustmentUser.settledBalance, heldBalance: adjustmentUser.heldBalance, operation, amount }) : { valid: false as const };

    const loadLedger = useCallback(async () => {
        const requestId = ++requestIdRef.current;
        setLoading(true);
        try {
            const result = await listAdminPoints({ page, pageSize: PAGE_SIZE, userId, type, direction, startAt, endBefore });
            if (requestId !== requestIdRef.current) return;
            setItems(result.items);
            setSummary(result.summary);
            setTotal(result.total);
            if (result.page !== page) setPage(result.page);
        } catch (error) {
            if (requestId === requestIdRef.current) message.error(error instanceof Error ? error.message : "加载积分流水失败");
        } finally {
            if (requestId === requestIdRef.current) setLoading(false);
        }
    }, [direction, endBefore, message, page, startAt, type, userId]);

    useEffect(() => {
        if (activeSection === "points") void loadLedger();
    }, [activeSection, loadLedger]);

    const loadPointUsers = useCallback(async (keyword: string) => {
        const result = await searchAdminPointsUsers(keyword);
        return result.users.map(toSearchEntry);
    }, []);

    const resetFilters = () => {
        setPage(1);
        setUserId(undefined);
        setType("");
        setDirection("");
        setDateRange(null);
        setStartAt(undefined);
        setEndBefore(undefined);
    };

    const openAdjustment = () => {
        adjustmentRequestIdRef.current = crypto.randomUUID();
        setAdjustmentUser(undefined);
        form.resetFields();
        form.setFieldsValue({ operation: "increase", amount: "", reason: "" });
        setAdjustmentOpen(true);
    };

    const submitAdjustment = async () => {
        const values = await form.validateFields();
        if (!projection.valid) return;
        setAdjustmentSaving(true);
        try {
            await adjustAdminPoints({ ...values, requestId: adjustmentRequestIdRef.current });
            message.success(values.operation === "increase" ? "积分已增加" : "积分已扣减");
            setAdjustmentOpen(false);
            setAdjustmentUser(undefined);
            form.resetFields();
            await loadLedger();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "调整积分失败");
        } finally {
            setAdjustmentSaving(false);
        }
    };

    const columns = useMemo<TableColumnsType<AdminPointLedgerItem>>(
        () => [
            { title: "时间", dataIndex: "createdAt", width: 170, render: (value: string) => <span className="whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">{formatTime(value)}</span> },
            { title: "用户", dataIndex: "user", width: 230, render: (_, record) => <AdminUserIdentity {...record.user} fallback="已删除用户" /> },
            { title: "类型", dataIndex: "type", width: 100, render: (value: AdminPointRecordType) => <Tag color={typeColor(value)}>{typeLabel(value)}</Tag> },
            { title: "变动", dataIndex: "amount", width: 135, align: "right", render: (value: string) => <Amount value={value} /> },
            { title: "变动后余额", dataIndex: "balanceAfter", width: 140, align: "right", render: (value: string) => <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">{formatCreditAmount(value)}</span> },
            { title: "说明", dataIndex: "description", ellipsis: true, render: (value: string) => <span title={value}>{value}</span> },
            { title: "操作人", dataIndex: "operator", width: 210, render: (_, record) => (record.operator ? <AdminUserIdentity {...record.operator} /> : <span className="text-xs text-zinc-400">系统</span>) },
        ],
        [],
    );

    if (activeSection !== "points") return null;
    return (
        <div className="min-w-0 space-y-3 sm:space-y-5">
            <section className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
                <Metric label="结算积分" value={formatCreditAmount(summary.settledBalance)} detail="全部用户当前已结算余额" icon={<WalletCards />} tone="slate" />
                <Metric label="预留积分" value={formatCreditAmount(summary.heldBalance)} detail="生成任务正在占用" icon={<History />} tone="amber" />
                <Metric label="可用积分" value={formatCreditAmount(summary.availableBalance)} detail="结算余额减去有效预留" icon={<Sparkles />} tone="blue" />
                <Metric label="流水总数" value={summary.recordCount} detail="已结算积分流水" icon={<ArrowUpCircle />} tone="emerald" />
            </section>

            <Panel>
                <PanelHeader
                    title="积分账务"
                    description="统一查看积分入账、消费、退款和管理员调整；预留积分仅计入余额摘要。"
                    actions={
                        <>
                            <Button aria-label="刷新积分账务" title="刷新积分账务" loading={loading} icon={<RefreshCw className="size-4" />} onClick={() => void loadLedger()}>
                                <span className="hidden sm:inline">刷新</span>
                            </Button>
                            {canManage ? (
                                <Button type="primary" icon={<Sparkles className="size-4" />} onClick={openAdjustment}>
                                    调整积分
                                </Button>
                            ) : null}
                        </>
                    }
                />

                <div className="grid grid-cols-1 gap-2 border-b border-zinc-200 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-[minmax(220px,1fr)_150px_130px_minmax(260px,auto)_auto] dark:border-zinc-800">
                    <AdminUserSearchSelect
                        value={userId}
                        onChange={(value) => {
                            setPage(1);
                            setUserId(value);
                        }}
                        loadUsers={loadPointUsers}
                        placeholder="按用户或账号 ID 筛选"
                    />
                    <Select
                        value={type}
                        aria-label="流水类型"
                        options={[{ value: "", label: "全部类型" }, ...(["credit", "consume", "refund", "admin-adjust"] as AdminPointRecordType[]).map((value) => ({ value, label: typeLabel(value) }))]}
                        onChange={(value) => {
                            setPage(1);
                            setType(value);
                        }}
                    />
                    <Select
                        value={direction}
                        aria-label="收支方向"
                        options={[
                            { value: "", label: "全部方向" },
                            { value: "credit", label: "收入" },
                            { value: "debit", label: "支出" },
                        ]}
                        onChange={(value) => {
                            setPage(1);
                            setDirection(value);
                        }}
                    />
                    <DatePicker.RangePicker className="w-full" aria-label="流水日期范围" value={dateRange} onChange={changeDateRange} />
                    <Button onClick={resetFilters}>重置</Button>
                </div>

                <div className="hidden min-w-0 md:block">
                    <Table rowKey="id" loading={loading} columns={columns} dataSource={items} pagination={{ current: page, pageSize: PAGE_SIZE, total, showSizeChanger: false, onChange: setPage }} scroll={{ x: 1180 }} />
                </div>
                <div className="min-w-0 p-3 md:hidden">
                    {items.length ? (
                        <div className="space-y-2">
                            {items.map((item) => (
                                <article key={item.id} className="min-w-0 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                                    <div className="flex min-w-0 items-start justify-between gap-3">
                                        <AdminUserIdentity {...item.user} fallback="已删除用户" />
                                        <Amount value={item.amount} />
                                    </div>
                                    <div className="mt-3 flex items-center justify-between gap-2">
                                        <Tag color={typeColor(item.type)}>{typeLabel(item.type)}</Tag>
                                        <span className="text-xs text-zinc-500 dark:text-zinc-400">余额 {formatCreditAmount(item.balanceAfter)}</span>
                                    </div>
                                    <p className="mt-2 break-words text-sm text-zinc-700 dark:text-zinc-300">{item.description}</p>
                                    <div className="mt-2 flex min-w-0 items-center justify-between gap-3 text-[11px] text-zinc-400">
                                        <span>{formatTime(item.createdAt)}</span>
                                        <span className="truncate">{item.operator ? `操作人：${item.operator.displayName || item.operator.username}` : "系统记账"}</span>
                                    </div>
                                </article>
                            ))}
                            <div className="flex justify-center pt-2">
                                <Pagination simple current={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
                            </div>
                        </div>
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? "正在加载积分流水" : "暂无积分流水"} />
                    )}
                </div>
            </Panel>

            <Modal
                title="调整积分"
                open={adjustmentOpen}
                okText={operation === "increase" ? "确认增加" : "确认扣减"}
                cancelText="取消"
                width="min(560px, calc(100vw - 24px))"
                confirmLoading={adjustmentSaving}
                okButtonProps={{ disabled: !projection.valid }}
                onOk={() => void submitAdjustment()}
                onCancel={() => {
                    if (!adjustmentSaving) {
                        setAdjustmentOpen(false);
                        setAdjustmentUser(undefined);
                    }
                }}
            >
                <Form form={form} layout="vertical" requiredMark={false} initialValues={{ operation: "increase" }}>
                    <Form.Item label="用户" name="userId" rules={[{ required: true, message: "请选择用户" }]}>
                        <AdminUserSearchSelect loadUsers={loadPointUsers} placeholder="搜索昵称、用户名或账号 ID" onUserChange={(user) => setAdjustmentUser(user as PointSearchEntry | undefined)} />
                    </Form.Item>
                    <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
                        <Form.Item label="调整方式" name="operation" rules={[{ required: true }]}>
                            <Segmented
                                block
                                options={[
                                    { value: "increase", label: "增加" },
                                    { value: "decrease", label: "扣减" },
                                ]}
                            />
                        </Form.Item>
                        <Form.Item label="积分数量" name="amount" validateStatus={projection.error ? "error" : undefined} help={projection.error} rules={[{ required: true, message: "请输入积分数量" }]}>
                            <InputNumber className="!w-full" stringMode min="0.00000001" precision={8} placeholder="例如 100 或 1.25" />
                        </Form.Item>
                    </div>
                    <Form.Item
                        label="调整原因"
                        name="reason"
                        rules={[
                            { required: true, whitespace: true, message: "请输入调整原因" },
                            { max: 500, message: "调整原因不能超过 500 个字符" },
                        ]}
                    >
                        <Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} placeholder="例如：客服补偿、退款冲正或账务修正" />
                    </Form.Item>
                    {adjustmentUser ? (
                        <div className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/50 sm:grid-cols-4">
                            <BalancePreview label="结算余额" value={adjustmentUser.settledBalance} />
                            <BalancePreview label="预留积分" value={adjustmentUser.heldBalance} />
                            <BalancePreview label="调整后余额" value={projection.balanceAfter} />
                            <BalancePreview label="调整后可用" value={projection.availableAfter} danger={!projection.valid && Boolean(projection.availableAfter)} />
                        </div>
                    ) : null}
                </Form>
            </Modal>
        </div>
    );

    function changeDateRange(value: [Dayjs | null, Dayjs | null] | null) {
        setPage(1);
        setDateRange(value);
        setStartAt(value?.[0]?.startOf("day").toDate().toISOString());
        setEndBefore(value?.[1]?.add(1, "day").startOf("day").toDate().toISOString());
    }
}

function toSearchEntry(user: AdminPointUserOption): PointSearchEntry {
    return {
        id: user.value,
        accountId: user.accountId,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        status: user.status || "active",
        settledBalance: user.settledBalance,
        heldBalance: user.heldBalance,
        availableBalance: user.availableBalance,
    };
}

function Amount({ value }: { value: string }) {
    const positive = !value.startsWith("-");
    return (
        <span className={`whitespace-nowrap font-semibold tabular-nums ${positive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
            {positive ? "+" : ""}
            {formatCreditAmount(value)}
        </span>
    );
}

function BalancePreview({ label, value, danger = false }: { label: string; value?: string; danger?: boolean }) {
    return (
        <div className="min-w-0">
            <div className="text-zinc-500 dark:text-zinc-400">{label}</div>
            <div className={`mt-1 truncate font-semibold tabular-nums ${danger ? "text-rose-600 dark:text-rose-400" : "text-zinc-950 dark:text-zinc-100"}`}>{value === undefined ? "—" : formatCreditAmount(value)}</div>
        </div>
    );
}

function typeLabel(type: AdminPointRecordType) {
    return type === "consume" ? "消费" : type === "refund" ? "退款" : type === "admin-adjust" ? "管理员调整" : "入账";
}

function typeColor(type: AdminPointRecordType) {
    return type === "consume" ? "orange" : type === "refund" ? "blue" : type === "admin-adjust" ? "purple" : "green";
}

function formatTime(value: string) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "medium", hour12: false }).format(date) : "—";
}
