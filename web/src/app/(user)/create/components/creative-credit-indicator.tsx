"use client";

import { useTranslations } from "next-intl";

import { CreditSymbol, formatCreditAmount } from "@/constant/credits";
import { decimal } from "@/lib/billing/decimal";

import type { CreativeCreditEstimate } from "./creative-credit-estimate";

export function CreativeCreditIndicator({ estimate }: { estimate: CreativeCreditEstimate }) {
    const t = useTranslations("create");
    const exact = estimate.status === "ESTIMATED";
    const conservative = estimate.status === "CONSERVATIVE_ESTIMATE";
    const credits = exact ? estimatedAmount(estimate.credits) : conservative ? conservativeAmount(estimate.upperBoundCredits) : "";
    const label = conservative
        ? t("estimatedCreditCostConservative", { credits })
        : exact
          ? t("estimatedCreditCost", { credits })
          : estimate.status === "PLANNING"
            ? t("creditAfterPlanning")
            : estimate.status === "OFFICIAL_SALE_PRICE_MISSING"
              ? t("creditSalePriceMissing")
              : estimate.status === "USAGE_INPUT_MISSING" || estimate.status === "NOT_ESTIMATABLE"
                ? t("creditReferenceDurationUnknown")
                : t("creditPricingDimensionMissing");
    const compactLabel = conservative
        ? t("estimatedCreditAmountConservative", { credits })
        : exact
          ? t("estimatedCreditAmount", { credits })
          : estimate.status === "PLANNING"
            ? t("creditAfterPlanningCompact")
            : estimate.status === "OFFICIAL_SALE_PRICE_MISSING"
              ? t("creditSalePriceMissingCompact")
              : estimate.status === "USAGE_INPUT_MISSING" || estimate.status === "NOT_ESTIMATABLE"
                ? t("creditReferenceDurationUnknownCompact")
                : t("creditPricingDimensionMissingCompact");
    const title =
        estimate.status === "OFFICIAL_SALE_PRICE_MISSING"
            ? t("creditSalePriceMissingHint")
            : conservative
              ? `${t("creditSettlementHint")} ${t("creditConservativeEstimateHint")}`
              : estimate.status === "USAGE_INPUT_MISSING" || estimate.status === "NOT_ESTIMATABLE"
                ? t("creditReferenceDurationUnknownHint")
                : t("creditSettlementHint");
    return (
        <div
            data-testid="creative-credit-estimate"
            data-estimate-status={estimate.status}
            className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-[#e1e5e9] bg-[#f7f8f9] px-2 text-xs font-medium text-[#687481] dark:border-[#343a42] dark:bg-[#24282e] dark:text-[#a6afb9]"
            aria-label={label}
            title={title}
        >
            <CreditSymbol className="text-[#6c75d8] dark:text-[#aaa6ff]" aria-hidden="true" />
            {estimate.status !== "PLANNING" ? (
                <>
                    <span className="sm:hidden">{compactLabel}</span>
                    <span className="hidden whitespace-nowrap sm:inline">{compactLabel}</span>
                </>
            ) : null}
        </div>
    );
}

function estimatedAmount(value: string) {
    return formatCreditAmount(decimal(value).roundHalfUp(4).toString());
}

function conservativeAmount(value: string) {
    return formatCreditAmount(decimal(value).ceilToDecimalPlaces(4).toString());
}
