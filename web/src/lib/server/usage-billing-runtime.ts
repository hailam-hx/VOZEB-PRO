import { createHash } from "node:crypto";

import { calculateFinalSaleCharge, calculateNormalizedUsagePrice, calculatePricingReserve, normalizeBillableUsage, validatePricingRateCard, type FinalSaleCharge, type NormalizedUsage, type PricingRateCardV1 } from "@/lib/billing/pricing";
import { validateProviderCostUnit, type ProviderCostUnit } from "@/lib/billing/money";
import type { ProviderUsageAttempt, UsageBillingHoldSnapshot, WalletHold } from "@/lib/auth/store-types";
import { readSystemAiUsageBilling } from "./system-ai-billing";
import { getTextTask } from "./text-task-store";
import { getImageTask } from "./image-task-store";
import { getVideoTask } from "./video-task-store";
import { getAudioTask } from "./audio-task-store";
import { listExpiredActiveWalletHolds, getWalletHoldById, listProviderUsageAttemptsForHold, markWalletHoldNeedsReview, recordProviderUsageAttempt, releaseWalletHold, reserveWalletCredits, settleWalletHold } from "./points-wallet-service";

export type UsageBilling = {
    holdId: string;
    userId: string;
    businessId: string;
    requestFingerprint: string;
    snapshot: UsageBillingHoldSnapshot;
};

export type ReserveUsageBillingInput = {
    userId: string;
    businessId: string;
    requestFingerprint: string;
    logicalModelId: string;
    saleRateSnapshot: PricingRateCardV1;
    requestUsage: NormalizedUsage;
    description: string;
    inputLimits?: UsageBillingHoldSnapshot["inputLimits"];
    providerIdempotency?: UsageBillingHoldSnapshot["providerIdempotency"];
    recovery?: UsageBillingHoldSnapshot["recovery"];
    expiresAt?: Date;
    now?: Date;
};

export type UsageProviderAttemptInput = {
    billing: UsageBilling;
    attemptNumber: number;
    status: "pending" | "succeeded" | "failed" | "canceled";
    provider: string;
    bindingId: string;
    providerIdempotencyKey?: string;
    upstreamTaskId?: string;
    nativeCostAmount: string;
    nativeCostUnit: ProviderCostUnit;
    costRateSnapshot?: PricingRateCardV1;
    normalizedUsage?: NormalizedUsage;
    now?: Date;
};

export async function reserveUsageBilling(input: ReserveUsageBillingInput): Promise<UsageBilling> {
    const saleRateSnapshot = validatePricingRateCard(input.saleRateSnapshot);
    const reserve = calculatePricingReserve({ rateCard: saleRateSnapshot, usage: input.requestUsage });
    const snapshot: UsageBillingHoldSnapshot = {
        version: 1,
        logicalModelId: requiredText(input.logicalModelId, "用量预留缺少逻辑模型"),
        capability: input.requestUsage.capability,
        saleRateSnapshot,
        requestUsage: input.requestUsage,
        reserve,
        reservedCredits: reserve.credits,
        ...(input.inputLimits ? { inputLimits: input.inputLimits } : {}),
        ...(input.providerIdempotency ? { providerIdempotency: input.providerIdempotency } : {}),
        ...(input.recovery ? { recovery: input.recovery } : {}),
    };
    const result = await reserveWalletCredits({
        userId: input.userId,
        businessId: input.businessId,
        requestFingerprint: input.requestFingerprint,
        amount: reserve.credits,
        description: input.description,
        runtimeSnapshot: snapshot,
        expiresAt: input.expiresAt,
        now: input.now,
    });
    return billingFromHold(result.hold);
}

export function recordUsageProviderAttempt(input: UsageProviderAttemptInput) {
    const nativeCostUnit = validateProviderCostUnit(input.nativeCostUnit);
    return recordProviderUsageAttempt({
        id: stableId("provider-attempt", input.billing.businessId, String(input.attemptNumber)),
        holdId: input.billing.holdId,
        attemptNumber: input.attemptNumber,
        status: input.status,
        provider: input.provider,
        bindingId: input.bindingId,
        requestFingerprint: stableFingerprint(input.billing.requestFingerprint, "attempt", String(input.attemptNumber), input.provider, input.bindingId),
        providerIdempotencyKey: input.providerIdempotencyKey,
        upstreamTaskId: input.upstreamTaskId,
        nativeCostAmount: input.nativeCostAmount,
        nativeCostUnit,
        costRateSnapshot: input.costRateSnapshot,
        normalizedUsage: input.normalizedUsage,
        now: input.now,
    });
}

export async function loadUsageBilling(holdId: string) {
    const hold = await getWalletHoldById(holdId);
    if (!hold || hold.status !== "active") throw new Error("用量预留不存在或已经关闭");
    return billingFromHold(hold);
}

export async function finishUsageProviderAttempt(input: { billing: UsageBilling; attemptNumber: number; status: "succeeded" | "failed" | "canceled"; normalizedUsage?: NormalizedUsage; upstreamTaskId?: string; now?: Date }) {
    const attempts = await listProviderUsageAttemptsForHold(input.billing.holdId);
    const attempt = attempts.find((item) => item.attemptNumber === input.attemptNumber);
    if (!attempt) throw new Error("供应商尝试不存在");
    const usage = input.normalizedUsage || attempt.normalizedUsage;
    const nativeCostAmount = attempt.costRateSnapshot && usage ? calculateNormalizedUsagePrice({ rateCard: attempt.costRateSnapshot, usage }) : attempt.nativeCostAmount;
    return recordUsageProviderAttempt({
        billing: input.billing,
        attemptNumber: attempt.attemptNumber,
        status: input.status,
        provider: attempt.provider,
        bindingId: attempt.bindingId,
        providerIdempotencyKey: attempt.providerIdempotencyKey,
        upstreamTaskId: input.upstreamTaskId || attempt.upstreamTaskId,
        nativeCostAmount,
        nativeCostUnit: attempt.nativeCostUnit,
        costRateSnapshot: attempt.costRateSnapshot,
        normalizedUsage: usage,
        now: input.now,
    });
}

export async function attachUsageProviderUpstreamTaskId(input: { holdId: string; attemptNumber: number; upstreamTaskId: string; now?: Date }) {
    const billing = await loadUsageBilling(input.holdId);
    const attempts = await listProviderUsageAttemptsForHold(billing.holdId);
    const attempt = attempts.find((item) => item.attemptNumber === input.attemptNumber);
    if (!attempt || attempt.status !== "pending") throw new Error("待绑定的供应商尝试不存在");
    return recordUsageProviderAttempt({
        billing,
        attemptNumber: attempt.attemptNumber,
        status: "pending",
        provider: attempt.provider,
        bindingId: attempt.bindingId,
        providerIdempotencyKey: attempt.providerIdempotencyKey,
        upstreamTaskId: requiredText(input.upstreamTaskId, "供应商任务 ID 不能为空"),
        nativeCostAmount: attempt.nativeCostAmount,
        nativeCostUnit: attempt.nativeCostUnit,
        costRateSnapshot: attempt.costRateSnapshot,
        normalizedUsage: attempt.normalizedUsage,
        now: input.now,
    });
}

export async function attachSystemAiUsageUpstreamTask(headers: Headers, upstreamTaskId: string) {
    const usage = readSystemAiUsageBilling(headers);
    if (!usage) return;
    await attachUsageProviderUpstreamTaskId({ holdId: usage.holdId, attemptNumber: usage.attemptNumber, upstreamTaskId });
}

export async function settleUsageBilling(input: { billing: UsageBilling; actualUsage?: NormalizedUsage; derivedUsage?: NormalizedUsage; description: string; now?: Date }) {
    assertUsageCapability(input.billing.snapshot, input.actualUsage, input.derivedUsage);
    const finalCharge = calculateFinalSaleCharge({
        rateCard: input.billing.snapshot.saleRateSnapshot,
        reserve: input.billing.snapshot.reserve,
        actualUsage: input.actualUsage,
        derivedUsage: input.derivedUsage,
    });
    return settleWalletHold({
        holdId: input.billing.holdId,
        usageChargeId: stableId("usage-charge", input.billing.businessId),
        requestFingerprint: stableFingerprint(input.billing.requestFingerprint, "settlement"),
        finalCharge,
        saleRateSnapshot: input.billing.snapshot.saleRateSnapshot,
        description: input.description,
        now: input.now,
    });
}

export function settleCancelledUsageBilling(input: { billing: UsageBilling; actualUsage?: NormalizedUsage; derivedUsage?: NormalizedUsage; description: string; now?: Date }) {
    return settleUsageBilling(input);
}

export function releaseUsageBilling(input: { billing: UsageBilling; reason: string; now?: Date }) {
    return releaseWalletHold({
        holdId: input.billing.holdId,
        businessId: stableId("usage-release", input.billing.businessId),
        requestFingerprint: stableFingerprint(input.billing.requestFingerprint, "release"),
        reason: input.reason,
        now: input.now,
    });
}

export type OrphanUsageEvidence =
    | { state: "succeeded"; actualUsage?: NormalizedUsage; derivedUsage?: NormalizedUsage; description?: string }
    | { state: "canceled"; actualUsage?: NormalizedUsage; derivedUsage?: NormalizedUsage; description?: string }
    | { state: "failed" | "not_received"; reason: string }
    | { state: "pending"; upstreamTaskId?: string }
    | { state: "unknown"; reason: string };

export async function recoverOrphanUsageHolds(input: { limit: number; now?: Date; inspect: (hold: WalletHold) => Promise<OrphanUsageEvidence> }) {
    const now = input.now || new Date();
    const holds = await listExpiredActiveWalletHolds({ now, limit: input.limit });
    const result = { inspected: 0, retained: 0, settled: 0, released: 0, needsReview: 0 };
    for (const hold of holds) {
        if (!hold.runtimeSnapshot) {
            await markWalletHoldNeedsReview({ holdId: hold.id, reason: "预留缺少运行时计费快照", now });
            result.inspected += 1;
            result.needsReview += 1;
            continue;
        }
        const evidence = await input.inspect(hold);
        const billing = billingFromHold(hold);
        result.inspected += 1;
        if (evidence.state === "unknown") {
            await markWalletHoldNeedsReview({ holdId: hold.id, reason: evidence.reason, now });
            result.needsReview += 1;
            continue;
        }
        if (evidence.state === "pending") {
            result.retained += 1;
            continue;
        }
        await finishPendingAttempts(billing, evidence.state === "succeeded" ? "succeeded" : evidence.state === "canceled" ? "canceled" : "failed", now, "actualUsage" in evidence ? evidence.actualUsage || evidence.derivedUsage : undefined);
        if (evidence.state === "succeeded" || evidence.state === "canceled") {
            const settlement = { billing, actualUsage: evidence.actualUsage, derivedUsage: evidence.derivedUsage, description: evidence.description || hold.description, now };
            if (evidence.state === "canceled") await settleCancelledUsageBilling(settlement);
            else await settleUsageBilling(settlement);
            result.settled += 1;
        } else {
            await releaseUsageBilling({ billing, reason: evidence.reason, now });
            result.released += 1;
        }
    }
    return result;
}

export async function inspectPersistedUsageHold(hold: WalletHold): Promise<OrphanUsageEvidence> {
    const snapshot = hold.runtimeSnapshot;
    const recovery = snapshot?.recovery;
    if (!snapshot || !recovery) return { state: "unknown", reason: "预留缺少稳定任务身份" };
    const task =
        recovery.taskType === "text" ? await getTextTask(recovery.taskId) : recovery.taskType === "image" ? await getImageTask(recovery.taskId) : recovery.taskType === "video" ? await getVideoTask(recovery.taskId) : await getAudioTask(recovery.taskId);
    if (!task) return { state: "unknown", reason: "本地任务不存在，无法确认上游是否接收" };
    if (task.status === "success") return { state: "succeeded", derivedUsage: persistedDerivedUsage(recovery.taskType, task, snapshot), description: hold.description };
    if (task.status === "error") return { state: "failed", reason: task.error || "任务确认失败" };
    if (task.status === "cancelled") return task.upstream?.id ? { state: "canceled", description: "用户取消已被上游接受的任务" } : { state: "not_received", reason: "任务在上游接收前取消" };
    if (task.upstream?.id) return { state: "pending", upstreamTaskId: task.upstream.id };
    return { state: "unknown", reason: "任务尚无稳定上游任务 ID" };
}

export function readUsageBillingSnapshot(hold: WalletHold) {
    return hold.runtimeSnapshot ? billingFromHold(hold) : undefined;
}

function billingFromHold(hold: WalletHold): UsageBilling {
    if (!hold.runtimeSnapshot) throw new Error("钱包预留缺少运行时计费快照");
    return { holdId: hold.id, userId: hold.userId, businessId: hold.businessId, requestFingerprint: hold.requestFingerprint, snapshot: hold.runtimeSnapshot };
}

async function finishPendingAttempts(billing: UsageBilling, status: "succeeded" | "failed" | "canceled", now: Date, usage?: NormalizedUsage) {
    const attempts = await listProviderUsageAttemptsForHold(billing.holdId);
    for (const attempt of attempts.filter((item) => item.status === "pending")) {
        await finishUsageProviderAttempt({ billing, attemptNumber: attempt.attemptNumber, status, normalizedUsage: usage, upstreamTaskId: attempt.upstreamTaskId, now });
    }
}

function assertUsageCapability(snapshot: UsageBillingHoldSnapshot, ...usageValues: Array<NormalizedUsage | undefined>) {
    for (const usage of usageValues) if (usage && usage.capability !== snapshot.capability) throw new Error("结算用量能力与预留不一致");
}

function persistedDerivedUsage(taskType: "text" | "image" | "video" | "audio", task: unknown, snapshot: UsageBillingHoldSnapshot) {
    const record = task && typeof task === "object" ? (task as Record<string, unknown>) : {};
    if (taskType === "text") {
        const content = record.result && typeof record.result === "object" ? String((record.result as Record<string, unknown>).content || "") : "";
        if (content) return normalizeBillableUsage({ capability: "text", source: "derived", inputTokens: snapshot.requestUsage.inputTokens || "0", outputTokens: Buffer.byteLength(content, "utf8") });
    }
    if (taskType === "image") {
        const result = record.result && typeof record.result === "object" ? (record.result as Record<string, unknown>) : undefined;
        if (result) return normalizeBillableUsage({ ...snapshot.requestUsage, capability: "image", source: "derived", count: Array.isArray(result.results) && result.results.length ? String(result.results.length) : "1" });
    }
    if (taskType === "video") {
        const result = record.result && typeof record.result === "object" ? (record.result as Record<string, unknown>) : undefined;
        const durationMs = Number(result?.durationMs);
        if (Number.isFinite(durationMs) && durationMs > 0) return normalizeBillableUsage({ ...snapshot.requestUsage, capability: "video", source: "derived", count: "1", durationSeconds: String(durationMs / 1000) });
    }
    return undefined;
}

function stableFingerprint(...parts: string[]) {
    return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function stableId(prefix: string, ...parts: string[]) {
    return `${prefix}:${stableFingerprint(...parts)}`;
}

function requiredText(value: string, message: string) {
    const normalized = value.trim();
    if (!normalized) throw new Error(message);
    return normalized;
}

export function finalChargeFromSnapshot(snapshot: UsageBillingHoldSnapshot, actualUsage?: NormalizedUsage, derivedUsage?: NormalizedUsage): FinalSaleCharge {
    return calculateFinalSaleCharge({ rateCard: snapshot.saleRateSnapshot, reserve: snapshot.reserve, actualUsage, derivedUsage });
}

export function providerAttemptBilling(attempt: ProviderUsageAttempt) {
    return { nativeCostAmount: attempt.nativeCostAmount, nativeCostUnit: attempt.nativeCostUnit, costUsd: attempt.costUsd };
}
