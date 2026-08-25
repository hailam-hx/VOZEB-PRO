"use client";

import { Metric, Panel, PanelHeader } from "@/components/admin/admin-panel";
import { formatCreditAmount } from "@/constant/credits";
import { Button } from "antd";
import { CircleDollarSign, CreditCard, PlugZap, ReceiptText, RefreshCw, WalletCards } from "lucide-react";

import type { AdminDashboardController } from "./use-admin-dashboard-controller";
import { FinanceFlowItem, FinanceMiniRow } from "./admin-dashboard-elements";

export function AdminWalletSection({ controller }: { controller: AdminDashboardController }) {
    const { billingSummary, billingSummaryLoading, activeSection, setActiveSection, walletSummary, loadBillingSummary } = controller;
    if (activeSection !== "wallet") return null;
    const vnd = billingSummary?.currencies.find((item) => item.currency === "VND");
    return (
        <div className="space-y-3 sm:space-y-5">
            <section className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Metric label="VND 实收" value={formatVnd(vnd?.paidNativeAmount)} detail={`${vnd?.paidOrders || 0} 笔已支付充值`} icon={<CircleDollarSign className="size-5" />} tone="emerald" />
                <Metric label="实收 USD 快照" value={`$${billingSummary?.paidUsdValue || "0"}`} detail="按订单冻结客户汇率换算" icon={<ReceiptText className="size-5" />} tone="amber" />
                <Metric label="退款支出" value={formatVnd(vnd?.refundedNativeAmount)} detail={`${vnd?.refundedOrders || 0} 笔退款`} icon={<RefreshCw className="size-5" />} tone="blue" />
                <Metric label="用户积分余额" value={formatCreditAmount(walletSummary.totalBalance)} detail="所有用户当前积分合计" icon={<WalletCards className="size-5" />} tone="slate" />
            </section>
            <Panel>
                <PanelHeader
                    title="财务流水"
                    description="查看原生收款、USD 快照、退款、积分负债和对账口径。"
                    actions={
                        <Button aria-label="刷新财务" title="刷新财务" loading={billingSummaryLoading} icon={<RefreshCw className="size-4" />} onClick={() => void loadBillingSummary()}>
                            <span className="hidden sm:inline">刷新财务</span>
                        </Button>
                    }
                />
                <div className="grid gap-3 p-3 sm:gap-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_340px]">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-1 sm:gap-3">
                        <FinanceFlowItem title="充值收入" amount={formatVnd(vnd?.paidNativeAmount)} description={`来自 ${vnd?.paidOrders || 0} 笔已支付充值和成功支付流水。`} icon={<CircleDollarSign className="size-4" />} />
                        <FinanceFlowItem title="退款支出" amount={formatVnd(vnd?.refundedNativeAmount)} description={`来自 ${vnd?.refundedOrders || 0} 笔退款，用于核对净收入。`} icon={<ReceiptText className="size-4" />} />
                        <FinanceFlowItem title="名义 USD 价值" amount={`$${billingSummary?.nominalUsdValue || "0"}`} description="订单创建时冻结的名义 USD 价值，用于和实收 USD 快照比较。" icon={<CircleDollarSign className="size-4" />} />
                        <FinanceFlowItem title="积分负债" amount={`${formatCreditAmount(walletSummary.totalBalance)} 积分`} description="所有用户当前积分余额，代表平台仍需履约的生成额度。" icon={<WalletCards className="size-4" />} />
                    </div>
                    <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-3 sm:p-4 dark:border-stone-800 dark:bg-stone-900/40">
                        <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">财务口径说明</div>
                        <div className="mt-2 line-clamp-2 text-xs leading-5 text-stone-500 sm:line-clamp-none sm:text-sm sm:leading-6 dark:text-stone-400">
                            财务流水保留原生支付金额与不可变 USD 快照。充值与定价负责预设、客户汇率、逻辑售价和绑定成本；订单负责收款与退款状态。
                        </div>
                        <div className="mt-4 grid gap-2 rounded-lg border border-stone-200 bg-white p-3 text-sm dark:border-stone-800 dark:bg-stone-950">
                            <FinanceMiniRow label="VND 支付订单" value={`${vnd?.paidOrders || 0} 笔`} />
                            <FinanceMiniRow label="退款 USD 快照" value={`$${billingSummary?.refundedUsdValue || "0"}`} />
                            <FinanceMiniRow label="充值预设" value={`${walletSummary.enabledTopUpPresets} 个启用`} />
                            <FinanceMiniRow label="积分负债" value={`${formatCreditAmount(walletSummary.totalBalance)} 积分`} />
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-1.5 sm:mt-4 sm:grid-cols-1 sm:gap-2">
                            <Button className="px-2 text-xs sm:px-3 sm:text-sm" onClick={() => setActiveSection("top-ups")} icon={<CreditCard className="size-3.5 sm:size-4" />}>
                                充值与定价
                            </Button>
                            <Button className="px-2 text-xs sm:px-3 sm:text-sm" onClick={() => setActiveSection("orders")} icon={<ReceiptText className="size-3.5 sm:size-4" />}>
                                订单管理
                            </Button>
                            <Button className="px-2 text-xs sm:px-3 sm:text-sm" onClick={() => setActiveSection("payments")} icon={<PlugZap className="size-3.5 sm:size-4" />}>
                                支付渠道
                            </Button>
                        </div>
                    </div>
                </div>
            </Panel>
        </div>
    );
}

function formatVnd(value?: string) {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(Number(value || 0));
}
