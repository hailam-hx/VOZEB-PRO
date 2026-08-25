"use client";

import Link from "next/link";
import { Button } from "antd";
import { ArrowRight } from "lucide-react";

import { Panel, PanelHeader } from "@/components/admin/admin-panel";
import type { AdminDashboardController } from "./use-admin-dashboard-controller";

export function AdminPointsSection({ controller }: { controller: AdminDashboardController }) {
    const { activeSection } = controller;
    if (activeSection !== "points") return null;

    return (
        <Panel>
            <PanelHeader
                title="积分账务"
                description="套餐与参数倍率计费已移除。模型售价、供应商成本和汇率统一使用版本化价格卡。"
                actions={
                    <Link href="/admin/billing?tab=pricing">
                        <Button type="primary" icon={<ArrowRight className="size-4" />}>
                            前往定价与汇率
                        </Button>
                    </Link>
                }
            />
            <div className="min-w-0 p-3 text-sm text-stone-500 sm:p-5">用户预估与服务端结算共用逻辑模型销售价格卡；供应商成本仅用于管理员毛利审计。</div>
        </Panel>
    );
}
