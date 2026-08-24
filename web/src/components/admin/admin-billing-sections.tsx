"use client";

import { BillingOperations } from "@/app/admin/billing/components/billing-operations";
import type { AdminDashboardController } from "./use-admin-dashboard-controller";

export function AdminOrdersSection({ controller }: { controller: AdminDashboardController }) {
    const { activeSection } = controller;
    if (activeSection !== "orders") return null;
    return <BillingOperations initialTab="orders" embedded hideTabs />;
}

export function AdminTopUpsSection({ controller }: { controller: AdminDashboardController }) {
    const { activeSection } = controller;
    if (activeSection !== "top-ups") return null;
    return <BillingOperations initialTab="presets" embedded />;
}

export function AdminPaymentsSection({ controller }: { controller: AdminDashboardController }) {
    const { paymentConfig, activeSection } = controller;
    if (activeSection !== "payments") return null;
    return <BillingOperations initialTab="payments" initialPaymentConfig={paymentConfig || undefined} embedded hideTabs />;
}
