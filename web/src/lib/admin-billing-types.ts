import type { PaymentAmount } from "@/lib/billing/money";

export type AdminBillingSummary = {
    currencies: Array<{ currency: string; paidNativeAmount: string; refundedNativeAmount: string; paidOrders: number; refundedOrders: number }>;
    paidUsdValue: string;
    refundedUsdValue: string;
    nominalUsdValue: string;
};

export type AdminTopUpConfig = { pricingVersion: string; customerFxVersion: string; usdPerVnd: string };
export type AdminUsageAuditItem = {
    id: string;
    userId: string;
    holdId: string;
    capability: string;
    usageSource: string;
    settledCredits: string;
    providerCostUsd: string;
    marginUsd: string;
    estimated: boolean;
    anomaly: "none" | "zero_usage_cost" | "negative_margin";
    createdAt: string;
};
export type AdminRecoveryItem = { id: string; userId: string; businessId: string; amount: string; reviewReason?: string; expiresAt?: string; createdAt: string };

export type BillingStatementStatus = "paid" | "refunded" | "pending" | "failed" | "unknown";
export type BillingReconciliationSource = "csv" | "provider-api" | "manual";

export type BillingReconciliationIssueCode =
    "invalid_statement_row" | "duplicate_statement_record" | "identifier_mismatch" | "missing_local_order" | "missing_local_payment" | "provider_mismatch" | "amount_mismatch" | "currency_mismatch" | "status_mismatch";

export type BillingReconciliationIssue = {
    code: BillingReconciliationIssueCode;
    severity: "error" | "warning";
    message: string;
    statementValue?: string;
    localValue?: string;
};

export type BillingReconciliationRow = {
    rowNumber: number;
    key: string;
    provider: string;
    orderNo?: string;
    providerOrderId?: string;
    providerPaymentId?: string;
    statementStatus: BillingStatementStatus;
    statementPaymentAmount?: PaymentAmount;
    localOrderId?: string;
    localOrderNo?: string;
    localOrderStatus?: string;
    localPaymentAmount?: PaymentAmount;
    localNominalNativeAmount?: string;
    localPayableNativeAmount?: string;
    localNominalUsdValue?: string;
    localPaidUsdValue?: string;
    issueCodes: BillingReconciliationIssueCode[];
    issues: BillingReconciliationIssue[];
};

export type BillingReconciliationResult = {
    runId?: string;
    provider: string;
    source?: BillingReconciliationSource;
    fileName?: string;
    importedByUsername?: string;
    totalRows: number;
    matchedRows: number;
    okRows: number;
    issueRows: number;
    totals: {
        statementPaidAmount: PaymentAmount;
        statementRefundedAmount: PaymentAmount;
        localPaidAmount: PaymentAmount;
        localRefundedAmount: PaymentAmount;
        differenceAmount: PaymentAmount;
        differenceDirection: "statement_over" | "local_over" | "balanced";
        localNominalUsdValue: string;
        localPaidUsdValue: string;
    };
    rows: BillingReconciliationRow[];
    generatedAt: string;
};

export type BillingReconciliationRun = {
    id: string;
    provider: string;
    source: BillingReconciliationSource;
    status: "completed" | "failed";
    totalRows: number;
    matchedRows: number;
    okRows: number;
    issueRows: number;
    statementPaidAmount: PaymentAmount;
    statementRefundedAmount: PaymentAmount;
    localPaidAmount: PaymentAmount;
    localRefundedAmount: PaymentAmount;
    differenceAmount: PaymentAmount;
    differenceDirection: "statement_over" | "local_over" | "balanced";
    localNominalUsdValue: string;
    localPaidUsdValue: string;
    importedByUserId?: string;
    importedByUsername?: string;
    fileName?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
};
