import { randomUUID } from "node:crypto";

import { AuthInputError, getPublicUsersByIds, listPublicUsersPage, type AuthDatabase, type PublicUser, type StoredPointRecord } from "@/lib/auth/store";
import { mutateAuthDb, readAuthDb } from "@/lib/auth/store-repository";
import { decimal, type ExactDecimal } from "@/lib/billing/decimal";
import type { AdminPointDirection, AdminPointLedgerItem, AdminPointLedgerResult, AdminPointRecordType, AdminPointSummary, AdminPointUserOption } from "@/lib/admin-points-types";
import { createPostgresRepositories, ensurePostgresSchema, isPostgresDatabaseEnabled, withPostgresTransaction } from "@/lib/server/database";
import { adjustWalletBalanceInPostgresTransaction, WalletConflictError } from "@/lib/server/points-wallet-service";

export type AdminPointLedgerInput = {
    page?: number;
    pageSize?: number;
    userId?: string;
    type?: AdminPointRecordType;
    direction?: AdminPointDirection;
    startAt?: string;
    endBefore?: string;
};

export type AdminPointAdjustmentInput = {
    actorUserId: string;
    targetUserId: string;
    operation: "increase" | "decrease";
    amount: string;
    reason: string;
    requestId: string;
};

export async function listAdminPointLedger(input: AdminPointLedgerInput = {}): Promise<AdminPointLedgerResult> {
    const filters = normalizeLedgerInput(input);
    let records: StoredPointRecord[];
    let total: number;
    let page: number;
    let summary: AdminPointSummary;
    if (isPostgresDatabaseEnabled()) {
        await ensurePostgresSchema();
        const repository = createPostgresRepositories().points;
        const [result, aggregate] = await Promise.all([repository.listAdminRecords(filters), repository.getAdminSummary()]);
        records = result.items;
        total = result.total;
        page = result.page;
        summary = aggregate;
    } else {
        const db = await readAuthDb();
        const result = listFileRecords(db, filters);
        records = result.records;
        total = result.total;
        page = result.page;
        summary = fileSummary(db);
    }
    const users = await getPublicUsersByIds(records.flatMap((record) => [record.userId, record.operatorUserId || ""]));
    const usersById = new Map(users.map((user) => [user.id, user]));
    return { items: records.map((record) => presentRecord(record, usersById)), total, page, pageSize: filters.pageSize, summary };
}

export async function searchAdminPointUsers(input: { keyword?: string; page?: number; pageSize?: number } = {}) {
    const page = positiveInteger(input.page, 1);
    const pageSize = Math.min(50, positiveInteger(input.pageSize, 20));
    const result = await listPublicUsersPage({ page, pageSize, keyword: input.keyword?.trim() || "" });
    return { users: result.users.map(presentUserOption), total: result.total, page: result.page, pageSize: result.pageSize };
}

export async function adjustAdminPointBalance(input: AdminPointAdjustmentInput) {
    const normalized = normalizeAdjustment(input);
    const signedAmount = normalized.operation === "decrease" ? decimal(0).minus(normalized.amount) : normalized.amount;
    const idempotencyKey = `admin-adjust:${normalized.requestId}`;
    if (isPostgresDatabaseEnabled()) {
        await ensurePostgresSchema();
        return withPostgresTransaction(async (client) => {
            const result = await adjustWalletBalanceInPostgresTransaction(client, {
                userId: normalized.targetUserId,
                operatorUserId: normalized.actorUserId,
                amount: signedAmount.toString(),
                description: normalized.reason,
                idempotencyKey,
                type: "admin-adjust",
            });
            const heldBalance = await createPostgresRepositories(client).pointsWallet.getActiveHeldBalance(normalized.targetUserId);
            if (decimal(result.settledBalance).minus(decimal(heldBalance)).isNegative()) throw new AuthInputError("扣减后结算余额不能低于当前预留积分", 409);
            return { ...result, snapshot: walletSnapshot(result.settledBalance, heldBalance) };
        });
    }
    return mutateAuthDb((db) => adjustFileBalance(db, normalized, signedAmount, idempotencyKey));
}

function adjustFileBalance(db: AuthDatabase, input: ReturnType<typeof normalizeAdjustment>, signedAmount: ExactDecimal, idempotencyKey: string) {
    const existing = db.pointRecords.find((record) => record.idempotencyKey === idempotencyKey);
    if (existing) {
        assertMatchingAdjustment(existing, input, signedAmount);
        const user = db.users.find((item) => item.id === input.targetUserId);
        if (!user) throw new AuthInputError("用户不存在", 404);
        return { record: existing, snapshot: walletSnapshot(user.settledBalance, activeHeldBalance(db, input.targetUserId).toString()), applied: false };
    }
    const user = db.users.find((item) => item.id === input.targetUserId);
    if (!user) throw new AuthInputError("用户不存在", 404);
    const held = activeHeldBalance(db, user.id);
    const next = decimal(user.settledBalance).plus(signedAmount);
    if (next.isNegative() || next.minus(held).isNegative()) throw new AuthInputError("扣减后结算余额不能低于当前预留积分", 409);
    const record: StoredPointRecord = {
        id: randomUUID(),
        userId: user.id,
        operatorUserId: input.actorUserId,
        type: "admin-adjust",
        amount: signedAmount.toString(),
        balanceAfter: next.toString(),
        description: input.reason,
        idempotencyKey,
        createdAt: new Date().toISOString(),
    };
    user.settledBalance = next.toString();
    user.updatedAt = record.createdAt;
    db.pointRecords.push(record);
    return { record, snapshot: walletSnapshot(record.balanceAfter, held.toString()), applied: true };
}

function assertMatchingAdjustment(record: StoredPointRecord, input: ReturnType<typeof normalizeAdjustment>, signedAmount: ExactDecimal) {
    if (record.userId !== input.targetUserId || record.operatorUserId !== input.actorUserId || record.type !== "admin-adjust" || decimal(record.amount).toString() !== signedAmount.toString() || record.description !== input.reason) {
        throw new WalletConflictError("钱包调整业务 ID 对应的请求参数不一致");
    }
}

function normalizeAdjustment(input: AdminPointAdjustmentInput) {
    const actorUserId = requiredText(input.actorUserId, "管理员不能为空", 120);
    const targetUserId = requiredText(input.targetUserId, "用户不能为空", 120);
    const operation = input.operation === "increase" || input.operation === "decrease" ? input.operation : undefined;
    if (!operation) throw new AuthInputError("调整方式无效");
    let amount: ExactDecimal;
    try {
        amount = decimal(input.amount, "调整积分");
    } catch (error) {
        throw new AuthInputError(error instanceof Error ? error.message : "调整积分无效");
    }
    if (amount.isNegative() || amount.isZero()) throw new AuthInputError("调整积分必须大于零");
    if (!amount.hasAtMostDecimalPlaces(8)) throw new AuthInputError("调整积分最多保留 8 位小数");
    return { actorUserId, targetUserId, operation, amount, reason: requiredText(input.reason, "调整原因不能为空", 500), requestId: requiredText(input.requestId, "调整请求 ID 不能为空", 120) };
}

function normalizeLedgerInput(input: AdminPointLedgerInput) {
    const page = positiveInteger(input.page, 1);
    const pageSize = Math.min(100, positiveInteger(input.pageSize, 20));
    const type = input.type === "consume" || input.type === "refund" || input.type === "credit" || input.type === "admin-adjust" ? input.type : undefined;
    const direction = input.direction === "credit" || input.direction === "debit" ? input.direction : undefined;
    return { page, pageSize, userId: input.userId?.trim() || undefined, type, direction, startAt: optionalIso(input.startAt, "开始时间无效"), endBefore: optionalIso(input.endBefore, "结束时间无效") };
}

function listFileRecords(db: AuthDatabase, input: ReturnType<typeof normalizeLedgerInput>) {
    const all = db.pointRecords
        .filter((record) => !input.userId || record.userId === input.userId)
        .filter((record) => !input.type || record.type === input.type)
        .filter((record) => !input.direction || (input.direction === "credit" ? decimal(record.amount).greaterThan(decimal(0)) : decimal(record.amount).isNegative()))
        .filter((record) => !input.startAt || record.createdAt >= input.startAt)
        .filter((record) => !input.endBefore || record.createdAt < input.endBefore)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
    const page = Math.min(input.page, Math.max(1, Math.ceil(all.length / input.pageSize)));
    return { records: all.slice((page - 1) * input.pageSize, page * input.pageSize), total: all.length, page };
}

function fileSummary(db: AuthDatabase): AdminPointSummary {
    const settled = db.users.reduce((sum, user) => sum.plus(decimal(user.settledBalance)), decimal(0));
    const held = db.walletHolds.filter((hold) => hold.status === "active").reduce((sum, hold) => sum.plus(decimal(hold.amount)), decimal(0));
    return { settledBalance: settled.toString(), heldBalance: held.toString(), availableBalance: settled.minus(held).toString(), recordCount: db.pointRecords.length };
}

function presentRecord(record: StoredPointRecord, usersById: Map<string, PublicUser>): AdminPointLedgerItem {
    return {
        id: record.id,
        type: record.type,
        amount: record.amount,
        balanceAfter: record.balanceAfter,
        description: record.description,
        model: record.model,
        sourceRecordId: record.sourceRecordId,
        createdAt: record.createdAt,
        user: presentIdentity(usersById.get(record.userId)),
        operator: record.operatorUserId ? presentIdentity(usersById.get(record.operatorUserId)) : undefined,
    };
}

function presentIdentity(user?: PublicUser) {
    if (!user) return undefined;
    return { accountId: user.accountId, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl, status: user.status };
}

function presentUserOption(user: PublicUser): AdminPointUserOption {
    return { value: user.id, ...presentIdentity(user)!, settledBalance: user.settledBalance, heldBalance: user.heldBalance, availableBalance: user.availableBalance };
}

function activeHeldBalance(db: AuthDatabase, userId: string) {
    return db.walletHolds.filter((hold) => hold.userId === userId && hold.status === "active").reduce((sum, hold) => sum.plus(decimal(hold.amount)), decimal(0));
}

function walletSnapshot(settledBalance: string, heldBalance: string) {
    return { settledBalance: decimal(settledBalance).toString(), heldBalance: decimal(heldBalance).toString(), availableBalance: decimal(settledBalance).minus(decimal(heldBalance)).toString() };
}

function requiredText(value: unknown, message: string, maxLength: number) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) throw new AuthInputError(message);
    return text.slice(0, maxLength);
}

function positiveInteger(value: unknown, fallback: number) {
    const number = Math.floor(Number(value));
    return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function optionalIso(value: unknown, message: string) {
    if (typeof value !== "string" || !value.trim()) return undefined;
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw new AuthInputError(message);
    return parsed.toISOString();
}
