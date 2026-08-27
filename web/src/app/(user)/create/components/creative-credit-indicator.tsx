"use client";

import { useTranslations } from "next-intl";

import { CreditSymbol, formatCreditAmount } from "@/constant/credits";

import type { CreativeCreditEstimate } from "./creative-credit-estimate";

export function CreativeCreditIndicator({ estimate }: { estimate: CreativeCreditEstimate }) {
    const t = useTranslations("create");
    const credits = estimate.status === "ready" ? formatCreditAmount(estimate.credits) : "";
    const label = estimate.status === "ready" ? t("estimatedCreditCost", { credits }) : estimate.status === "planning" ? t("creditAfterPlanning") : t("creditUnavailable");
    const compactLabel = estimate.status === "ready" ? t("estimatedCreditAmount", { credits }) : estimate.status === "planning" ? t("creditAfterPlanningCompact") : t("creditUnavailableCompact");
    return (
        <div
            data-testid="creative-credit-estimate"
            className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-[#e1e5e9] bg-[#f7f8f9] px-2 text-xs font-medium text-[#687481] dark:border-[#343a42] dark:bg-[#24282e] dark:text-[#a6afb9]"
            aria-label={label}
            title={t("creditSettlementHint")}
        >
            <CreditSymbol className="text-[#6c75d8] dark:text-[#aaa6ff]" aria-hidden="true" />
            <span className="sm:hidden">{compactLabel}</span>
            <span className="hidden whitespace-nowrap sm:inline">{label}</span>
        </div>
    );
}
