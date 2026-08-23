import { randomUUID } from "node:crypto";

import type { BillingReconciliationIssue, BillingReconciliationIssueCode, BillingReconciliationResult, BillingReconciliationRow, BillingStatementStatus } from "@/lib/admin-billing-types";
import { normalizePaymentProvider } from "@/lib/payment-provider";
import { BillingInputError } from "@/lib/server/billing-errors";
import { decimal } from "@/lib/billing/decimal";
import { validatePaymentAmount, type PaymentAmount } from "@/lib/billing/money";
import type { JsonValue, TopUpReconciliationRowRecord, TopUpReconciliationRunRecord } from "@/lib/server/database";
import type { TopUpOrder } from "@/lib/server/top-up-payment";

export type BillingReconciliationActor = {
    userId?: string;
    username?: string;
};

export type PaymentStatementRow = {
    rowNumber: number;
    provider: string;
    orderNo?: string;
    providerOrderId?: string;
    providerPaymentId?: string;
    status: BillingStatementStatus;
    amountMinor?: string;
    currency?: string;
    raw: Record<string, string>;
};

export type LocalBillingReconciliationRecord = {
    order: TopUpOrder;
    payments: Array<{ provider: string; status: "pending" | "succeeded" | "failed" | "refunded"; amountMinor: string; currency: string; providerTradeId?: string; providerPaymentId?: string }>;
};

const MAX_STATEMENT_ROWS = 500;
const HEADER_ALIASES = {
    orderNo: ["orderNo", "order_no", "订单号", "商户订单号", "商户订单ID", "商户订单id", "out_trade_no", "outTradeNo", "merchant_order_no"],
    providerOrderId: ["providerOrderId", "provider_order_id", "支付商订单号", "交易号", "trade_no", "tradeNo", "providerTradeId", "provider_trade_id"],
    providerPaymentId: ["providerPaymentId", "provider_payment_id", "支付单号", "支付流水号", "流水号", "payment_id", "paymentId", "transaction_id", "transactionId", "微信支付订单号", "支付宝交易号"],
    status: ["status", "trade_status", "tradeStatus", "状态", "交易状态", "支付状态", "退款状态", "refund_status"],
    amountMinor: ["amountMinor", "amount_minor", "金额最小单位", "总金额", "total_fee", "payer_total", "refund_fee"],
    amount: ["amount", "total_amount", "金额", "实收金额", "支付金额", "退款金额", "totalAmount", "refund_amount"],
    currency: ["currency", "币种", "currency_code"],
    provider: ["provider", "渠道", "支付渠道"],
};

export { MAX_STATEMENT_ROWS };

export function createBillingReconciliationPersistenceRecords(result: BillingReconciliationResult, input: { actor?: BillingReconciliationActor; fileName?: unknown; fileHash?: string; note?: unknown } = {}) {
    const runId = randomUUID();
    const nowIso = new Date().toISOString();
    const fileName = normalizeText(input.fileName, "", 180);
    const note = normalizeText(input.note, "", 300);
    const run: TopUpReconciliationRunRecord = {
        id: runId,
        provider: result.provider,
        source: "csv",
        status: "completed",
        totalRows: result.totalRows,
        matchedRows: result.matchedRows,
        okRows: result.okRows,
        issueRows: result.issueRows,
        statementPaidAmount: result.totals.statementPaidAmount,
        statementRefundedAmount: result.totals.statementRefundedAmount,
        localMatchedAmount: result.totals.localMatchedAmount,
        differenceAmount: result.totals.differenceAmount,
        differenceDirection: result.totals.differenceDirection,
        localNominalUsdValue: result.totals.localNominalUsdValue,
        localPaidUsdValue: result.totals.localPaidUsdValue,
        importedByUserId: normalizeText(input.actor?.userId, "", 120) || undefined,
        importedByUsername: normalizeText(input.actor?.username, "", 120) || undefined,
        fileName: fileName || undefined,
        fileHash: normalizeText(input.fileHash, "", 64) || undefined,
        note: note || undefined,
        metadata: {
            generatedAt: result.generatedAt,
            rowLimit: MAX_STATEMENT_ROWS,
        },
        createdAt: nowIso,
        updatedAt: nowIso,
    };
    return {
        run,
        rows: result.rows.map((row) => toReconciliationRowRecord(runId, row, nowIso)),
    };
}

export function parsePaymentStatementCsv(csvText: string, defaultProvider = ""): PaymentStatementRow[] {
    const text = csvText.trim();
    if (!text) throw new BillingInputError("请粘贴支付商账单 CSV 内容", 400);
    const table = parseCsv(text);
    if (table.length < 2) throw new BillingInputError("支付商账单至少需要表头和一行数据", 400);
    const headers = table[0].map(normalizeHeader);
    const rows = table.slice(1).filter((row) => row.some((cell) => cell.trim()));
    if (!rows.length) throw new BillingInputError("支付商账单没有可对账的数据行", 400);
    if (rows.length > MAX_STATEMENT_ROWS) throw new BillingInputError(`单次最多导入 ${MAX_STATEMENT_ROWS} 行账单`, 400);
    return rows.map((cells, index) => normalizeStatementRow(headers, cells, index + 2, defaultProvider));
}

export function reconcilePaymentStatementRows(provider: string, rows: PaymentStatementRow[], localRecords: LocalBillingReconciliationRecord[]): BillingReconciliationResult {
    const localIndex = buildLocalRecordIndex(localRecords);
    const seenStatementKeys = new Set<string>();
    const resultRows = rows.map((row) => {
        const duplicateKey = statementDuplicateKey(row);
        const duplicate = duplicateKey ? seenStatementKeys.has(duplicateKey) : false;
        if (duplicateKey) seenStatementKeys.add(duplicateKey);
        return reconcileStatementRow(row, findLocalRecordInIndex(row, localIndex), duplicate);
    });
    const statementPaidMinor = rows.reduce((sum, row) => sum + (row.status === "paid" ? BigInt(row.amountMinor || "0") : BigInt(0)), BigInt(0));
    const statementRefundedMinor = rows.reduce((sum, row) => sum + (row.status === "refunded" ? BigInt(row.amountMinor || "0") : BigInt(0)), BigInt(0));
    const localMatchedMinor = resultRows.reduce((sum, row) => {
        if (!row.localOrderId) return sum;
        const amount = row.localPaymentAmount?.kind === "fiat" ? BigInt(row.localPaymentAmount.amountMinor) : BigInt(0);
        if (row.statementStatus === "paid") return sum + amount;
        if (row.statementStatus === "refunded") return sum - amount;
        return sum;
    }, BigInt(0));
    const statementNetMinor = statementPaidMinor - statementRefundedMinor;
    const signedDifference = statementNetMinor - localMatchedMinor;
    const absoluteDifference = signedDifference < BigInt(0) ? -signedDifference : signedDifference;
    const fiat = (amountMinor: bigint): PaymentAmount => ({ kind: "fiat", currency: "VND", amountMinor: amountMinor.toString(), minorUnitExponent: 0 });
    const localNominalUsdValue = sumDecimalStrings(resultRows.map((row) => row.localNominalUsdValue));
    const localPaidUsdValue = sumDecimalStrings(resultRows.map((row) => row.localPaidUsdValue));
    return {
        provider: normalizeProvider(provider),
        totalRows: rows.length,
        matchedRows: resultRows.filter((row) => row.localOrderId).length,
        okRows: resultRows.filter((row) => !row.issueCodes.length).length,
        issueRows: resultRows.filter((row) => row.issueCodes.length).length,
        totals: {
            statementPaidAmount: fiat(statementPaidMinor),
            statementRefundedAmount: fiat(statementRefundedMinor),
            localMatchedAmount: fiat(localMatchedMinor),
            differenceAmount: fiat(absoluteDifference),
            differenceDirection: signedDifference > BigInt(0) ? "statement_over" : signedDifference < BigInt(0) ? "local_over" : "balanced",
            localNominalUsdValue,
            localPaidUsdValue,
        },
        rows: resultRows,
        generatedAt: new Date().toISOString(),
    };
}

function reconcileStatementRow(row: PaymentStatementRow, local: LocalBillingReconciliationRecord | undefined, duplicate: boolean): BillingReconciliationRow {
    const issues: BillingReconciliationIssue[] = [];
    if (duplicate) issues.push(issue("duplicate_statement_record", "账单中存在重复记录", "warning"));
    if (!statementIdentifiers(row).length) issues.push(issue("invalid_statement_row", "账单行缺少订单号或支付流水号", "error"));
    if (row.status === "unknown") issues.push(issue("invalid_statement_row", "账单行状态无法识别", "warning", undefined, "unknown"));
    if (row.amountMinor === undefined) issues.push(issue("invalid_statement_row", "账单行缺少有效金额", "error"));
    if (!row.currency) issues.push(issue("invalid_statement_row", "账单行缺少币种", "error"));
    if (!local) {
        issues.push(issue("missing_local_order", "本地没有匹配的订单", "error"));
        return buildResultRow(row, undefined, issues);
    }

    if (row.orderNo && local.order.orderNo && keyValue(row.orderNo) !== keyValue(local.order.orderNo)) {
        issues.push(issue("identifier_mismatch", "账单订单号与本地订单号不一致", "error", local.order.orderNo, row.orderNo));
    }
    if (row.provider && local.order.provider && normalizeProvider(row.provider) !== normalizeProvider(local.order.provider)) {
        issues.push(issue("provider_mismatch", "支付渠道不一致", "error", local.order.provider, row.provider));
    }
    if (row.amountMinor !== undefined && BigInt(row.amountMinor) !== BigInt(localAmountMinor(local.order))) {
        issues.push(issue("amount_mismatch", "支付商金额与本地订单金额不一致", "error", localAmountMinor(local.order), row.amountMinor));
    }
    if (row.currency && local.order.currency && row.currency !== normalizeCurrency(local.order.currency)) {
        issues.push(issue("currency_mismatch", "支付商币种与本地订单币种不一致", "error", normalizeCurrency(local.order.currency), row.currency));
    }

    if (row.status === "paid") {
        if (local.order.status !== "paid" && local.order.status !== "refunded") issues.push(issue("status_mismatch", "支付商已支付，但本地订单不是已支付/已退款", "error", local.order.status, row.status));
        if (!local.payments.some((payment) => payment.status === "succeeded" || payment.status === "refunded")) issues.push(issue("missing_local_payment", "本地订单缺少成功支付流水", "error"));
    }
    if (row.status === "refunded") {
        if (local.order.status !== "refunded") issues.push(issue("status_mismatch", "支付商已退款，但本地订单未标记退款", "error", local.order.status, row.status));
        if (!local.payments.some((payment) => payment.status === "refunded")) issues.push(issue("missing_local_payment", "本地订单缺少退款流水", "error"));
    }
    if ((row.status === "failed" || row.status === "pending") && (local.order.status === "paid" || local.order.status === "refunded")) {
        issues.push(issue("status_mismatch", "支付商未成功，但本地订单已生效", "warning", local.order.status, row.status));
    }
    return buildResultRow(row, local, issues);
}

function buildResultRow(row: PaymentStatementRow, local: LocalBillingReconciliationRecord | undefined, issues: BillingReconciliationIssue[]): BillingReconciliationRow {
    return {
        rowNumber: row.rowNumber,
        key: reconciliationLookupKey(row),
        provider: row.provider,
        orderNo: row.orderNo,
        providerOrderId: row.providerOrderId,
        providerPaymentId: row.providerPaymentId,
        statementStatus: row.status,
        statementPaymentAmount: row.amountMinor === undefined ? undefined : { kind: "fiat", currency: "VND", amountMinor: row.amountMinor, minorUnitExponent: 0 },
        localOrderId: local?.order.id,
        localOrderNo: local?.order.orderNo,
        localOrderStatus: local?.order.status,
        localPaymentAmount: local?.order.paymentAmount,
        localNominalNativeAmount: local?.order.nominalNativeAmount,
        localPayableNativeAmount: local?.order.payableNativeAmount,
        localNominalUsdValue: local?.order.nominalUsdValue,
        localPaidUsdValue: local?.order.paidUsdValue,
        issueCodes: issues.map((item) => item.code),
        issues,
    };
}

function toReconciliationRowRecord(runId: string, row: BillingReconciliationRow, nowIso: string): TopUpReconciliationRowRecord {
    return {
        id: randomUUID(),
        runId,
        rowNumber: row.rowNumber,
        rowKey: row.key,
        provider: row.provider,
        orderNo: row.orderNo,
        providerOrderId: row.providerOrderId,
        providerPaymentId: row.providerPaymentId,
        statementStatus: row.statementStatus,
        statementPaymentAmount: row.statementPaymentAmount,
        localOrderId: row.localOrderId,
        localOrderNo: row.localOrderNo,
        localOrderStatus: row.localOrderStatus,
        localPaymentAmount: row.localPaymentAmount,
        localNominalNativeAmount: row.localNominalNativeAmount,
        localPayableNativeAmount: row.localPayableNativeAmount,
        localNominalUsdValue: row.localNominalUsdValue,
        localPaidUsdValue: row.localPaidUsdValue,
        issueCodes: row.issueCodes,
        issues: row.issues.map((item) => ({
            code: item.code,
            severity: item.severity,
            message: item.message,
            ...(item.localValue ? { localValue: item.localValue } : {}),
            ...(item.statementValue ? { statementValue: item.statementValue } : {}),
        })),
        createdAt: nowIso,
        updatedAt: nowIso,
    };
}

export function buildStoredReconciliationResult(run: TopUpReconciliationRunRecord, rows: TopUpReconciliationRowRecord[]): BillingReconciliationResult {
    return {
        runId: run.id,
        provider: run.provider,
        source: run.source,
        fileName: run.fileName,
        importedByUsername: run.importedByUsername,
        totalRows: run.totalRows,
        matchedRows: run.matchedRows,
        okRows: run.okRows,
        issueRows: run.issueRows,
        totals: {
            statementPaidAmount: validatePaymentAmount(run.statementPaidAmount),
            statementRefundedAmount: validatePaymentAmount(run.statementRefundedAmount),
            localMatchedAmount: validatePaymentAmount(run.localMatchedAmount),
            differenceAmount: validatePaymentAmount(run.differenceAmount),
            differenceDirection: run.differenceDirection,
            localNominalUsdValue: run.localNominalUsdValue,
            localPaidUsdValue: run.localPaidUsdValue,
        },
        rows: rows.map(fromReconciliationRowRecord),
        generatedAt: run.createdAt,
    };
}

function fromReconciliationRowRecord(row: TopUpReconciliationRowRecord): BillingReconciliationRow {
    const issues = normalizeStoredIssues(row.issues);
    return {
        rowNumber: row.rowNumber,
        key: row.rowKey,
        provider: row.provider,
        orderNo: row.orderNo,
        providerOrderId: row.providerOrderId,
        providerPaymentId: row.providerPaymentId,
        statementStatus: row.statementStatus,
        statementPaymentAmount: row.statementPaymentAmount ? validatePaymentAmount(row.statementPaymentAmount) : undefined,
        localOrderId: row.localOrderId,
        localOrderStatus: row.localOrderStatus,
        localPaymentAmount: row.localPaymentAmount ? validatePaymentAmount(row.localPaymentAmount) : undefined,
        localNominalNativeAmount: row.localNominalNativeAmount,
        localPayableNativeAmount: row.localPayableNativeAmount,
        localNominalUsdValue: row.localNominalUsdValue,
        localPaidUsdValue: row.localPaidUsdValue,
        issueCodes: normalizeStoredIssueCodes(row.issueCodes, issues),
        issues,
    };
}

function normalizeStoredIssueCodes(value: JsonValue, issues: BillingReconciliationIssue[]) {
    if (Array.isArray(value)) return value.filter(isBillingReconciliationIssueCode);
    return issues.map((item) => item.code);
}

function normalizeStoredIssues(value: JsonValue): BillingReconciliationIssue[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
            const record = item as Record<string, unknown>;
            const code = record.code;
            const severity = record.severity;
            const message = normalizeText(record.message, "", 200);
            if (!isBillingReconciliationIssueCode(code) || !message) return undefined;
            return {
                code,
                severity: severity === "warning" ? "warning" : "error",
                message,
                localValue: normalizeText(record.localValue, "", 200) || undefined,
                statementValue: normalizeText(record.statementValue, "", 200) || undefined,
            };
        })
        .filter(Boolean) as BillingReconciliationIssue[];
}

function normalizeStatementRow(headers: string[], cells: string[], rowNumber: number, defaultProvider: string): PaymentStatementRow {
    const raw = Object.fromEntries(headers.map((header, index) => [header || `column_${index + 1}`, normalizeText(cells[index], "", 500)]));
    const provider = normalizeProvider(readAliased(raw, HEADER_ALIASES.provider) || defaultProvider);
    const currency = normalizeCurrency(readAliased(raw, HEADER_ALIASES.currency));
    const amountMinorValue = readAliased(raw, HEADER_ALIASES.amountMinor);
    const amountValue = readAliased(raw, HEADER_ALIASES.amount);
    return {
        rowNumber,
        provider,
        orderNo: normalizeOptionalId(readAliased(raw, HEADER_ALIASES.orderNo)),
        providerOrderId: normalizeOptionalId(readAliased(raw, HEADER_ALIASES.providerOrderId)),
        providerPaymentId: normalizeOptionalId(readAliased(raw, HEADER_ALIASES.providerPaymentId)),
        status: normalizeStatementStatus(readAliased(raw, HEADER_ALIASES.status)),
        amountMinor: amountMinorValue ? parseMinor(amountMinorValue) : amountValue ? parseMoneyToMinor(amountValue, currency || "") : undefined,
        currency,
        raw,
    };
}

function parseCsv(text: string) {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = text[index + 1];
        if (char === '"') {
            if (quoted && next === '"') {
                cell += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
            continue;
        }
        if (char === "," && !quoted) {
            row.push(cell);
            cell = "";
            continue;
        }
        if ((char === "\n" || char === "\r") && !quoted) {
            if (char === "\r" && next === "\n") index += 1;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
            continue;
        }
        cell += char;
    }
    row.push(cell);
    rows.push(row);
    return rows.map((items) => items.map((item) => item.trim()));
}

function buildLocalRecordIndex(localRecords: LocalBillingReconciliationRecord[]) {
    const index = new Map<string, LocalBillingReconciliationRecord>();
    for (const record of localRecords) {
        for (const key of localRecordKeys(record)) {
            if (!index.has(key)) index.set(key, record);
        }
    }
    return index;
}

export function findLocalRecordInIndex(row: PaymentStatementRow, localIndex: Map<string, LocalBillingReconciliationRecord>) {
    for (const identifier of statementIdentifiers(row)) {
        const record = localIndex.get(providerIdentifierKey(row.provider, identifier));
        if (record) return record;
    }
    return undefined;
}

function localRecordKeys(record: LocalBillingReconciliationRecord) {
    const entries = [
        ...[record.order.orderNo, record.order.providerOrderId, record.order.providerPaymentId].map((value) => [record.order.provider, value] as const),
        ...record.payments.flatMap((payment) => [[payment.provider, payment.providerTradeId] as const, [payment.provider, payment.providerPaymentId] as const]),
    ];
    return entries.flatMap(([provider, value]) => {
        const normalized = normalizeOptionalId(value);
        return normalized ? [providerIdentifierKey(provider, normalized)] : [];
    });
}

function reconciliationLookupKey(row: PaymentStatementRow) {
    return providerIdentifierKey(row.provider, statementIdentifiers(row)[0] || `row-${row.rowNumber}`);
}

export function reconciliationLookupCacheKey(row: PaymentStatementRow) {
    const identifiers = statementIdentifiers(row);
    return identifiers.length ? identifiers.map((identifier) => providerIdentifierKey(row.provider, identifier)).join("|") : `${normalizeProvider(row.provider)}:row-${row.rowNumber}`;
}

function statementDuplicateKey(row: PaymentStatementRow) {
    const identifiers = statementIdentifiers(row);
    if (!identifiers.length) return undefined;
    return `${normalizeProvider(row.provider)}:${identifiers.map(keyValue).join("|")}:${row.status}:${row.amountMinor ?? ""}`;
}

export function statementIdentifiers(row: PaymentStatementRow) {
    return [row.orderNo, row.providerOrderId, row.providerPaymentId].filter(Boolean) as string[];
}

export function localOrderMatchesStatement(order: TopUpOrder, row: PaymentStatementRow) {
    if (normalizeProvider(order.provider) !== normalizeProvider(row.provider)) return false;
    const keys = new Set(
        [order.orderNo, order.providerOrderId, order.providerPaymentId]
            .map((value) => normalizeOptionalId(value))
            .filter(Boolean)
            .map((value) => keyValue(value)),
    );
    return statementIdentifiers(row).some((identifier) => keys.has(keyValue(identifier)));
}

function localAmountMinor(order: TopUpOrder) {
    return order.paymentAmount.kind === "fiat" ? order.paymentAmount.amountMinor : "";
}

function providerIdentifierKey(provider: string, identifier: string) {
    return `${normalizeProvider(provider)}:${keyValue(identifier)}`;
}

function readAliased(source: Record<string, string>, aliases: string[]) {
    const normalized = new Map(Object.entries(source).map(([key, value]) => [normalizeHeader(key), value]));
    for (const alias of aliases) {
        const value = normalized.get(normalizeHeader(alias));
        if (value) return value;
    }
    return "";
}

function issue(code: BillingReconciliationIssueCode, message: string, severity: "error" | "warning", localValue?: string, statementValue?: string): BillingReconciliationIssue {
    return { code, message, severity, localValue, statementValue };
}

function isBillingReconciliationIssueCode(value: unknown): value is BillingReconciliationIssueCode {
    return (
        value === "invalid_statement_row" ||
        value === "duplicate_statement_record" ||
        value === "identifier_mismatch" ||
        value === "missing_local_order" ||
        value === "missing_local_payment" ||
        value === "provider_mismatch" ||
        value === "amount_mismatch" ||
        value === "currency_mismatch" ||
        value === "status_mismatch"
    );
}

function normalizeStatementStatus(value: unknown): BillingStatementStatus {
    const status = normalizeText(value, "", 80)
        .toLowerCase()
        .replace(/[\s_-]+/g, "");
    if (["paid", "success", "succeeded", "completed", "complete", "tradesuccess", "tradefinished", "finished"].includes(status)) return "paid";
    if (["refund", "refunded", "refundsuccess", "refundsucceeded", "successrefund"].includes(status)) return "refunded";
    if (["pending", "processing", "waitbuyerpay", "notpay"].includes(status)) return "pending";
    if (["failed", "fail", "closed", "canceled", "cancelled", "tradeclosed"].includes(status)) return "failed";
    return "unknown";
}

function parseMinor(value: string) {
    const normalized = value.replace(/[^\d-]/g, "");
    if (!/^-?\d+$/.test(normalized)) return undefined;
    return BigInt(normalized).toString().replace(/^-/, "");
}

function parseMoneyToMinor(value: string, currency: string) {
    const text = value.replace(/[¥￥$,，\sA-Za-z]/g, "");
    try {
        const parsed = decimal(text.replace(/[()]/g, ""));
        const absolute = parsed.isNegative() ? decimal(0).minus(parsed) : parsed;
        return absolute.times(decimal(currency === "VND" ? 1 : 100)).roundHalfUp(0).toString();
    } catch {
        return undefined;
    }
}

function sumDecimalStrings(values: Array<string | undefined>) {
    return values.reduce((sum, value) => sum.plus(decimal(value || "0")), decimal(0)).toString();
}

function normalizeHeader(value: unknown) {
    return normalizeText(value, "", 80)
        .replace(/^\uFEFF/, "")
        .toLowerCase()
        .replace(/[\s_-]+/g, "");
}

function normalizeOptionalId(value: unknown) {
    const id = normalizeText(value, "", 160).replace(/[^a-zA-Z0-9_.:-]/g, "");
    return id || undefined;
}

function keyValue(value: string | undefined) {
    return (value || "").trim().toLowerCase();
}

export function normalizeProvider(value: unknown) {
    return normalizePaymentProvider(value);
}

export function normalizeOptionalProvider(value: unknown) {
    const provider = normalizeText(value, "", 60);
    return provider ? normalizeProvider(provider) : undefined;
}

function normalizeCurrency(value: unknown) {
    const currency = normalizeText(value, "", 12).toUpperCase();
    return currency || undefined;
}

export function normalizeText(value: unknown, fallback: string, maxLength: number) {
    const text = typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
    return (text || fallback).slice(0, maxLength);
}

export function normalizeInteger(value: unknown, fallback: number, min: number, max: number) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
}
