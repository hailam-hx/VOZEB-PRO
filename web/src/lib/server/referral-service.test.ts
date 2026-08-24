import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ makeRepositories: vi.fn(), transaction: vi.fn(), adjustWallet: vi.fn() }));
vi.mock("@/lib/server/database", () => ({
    createPostgresRepositories: mocks.makeRepositories,
    ensurePostgresSchema: vi.fn(),
    isPostgresDatabaseEnabled: () => true,
    withPostgresTransaction: mocks.transaction,
}));
vi.mock("@/lib/server/points-wallet-service", () => ({ adjustWalletBalanceInPostgresTransaction: mocks.adjustWallet }));

import { QuotaExceededError } from "@/lib/auth/store-foundation";
import { prepareReferralRewardsForPaidOrder, reverseReferralRewardsForRefundedOrder, settleDueReferralRewards } from "./referral-service";

describe("referral qualification", () => {
    it("uses the verified nominal USD snapshot and the top-up order history", async () => {
        const createReward = vi.fn(async (reward) => reward);
        mocks.makeRepositories.mockReturnValue({
            referrals: {
                getRelationshipByInviteeUserId: vi.fn(async () => ({ id: "rel", inviterUserId: "inviter", inviteeUserId: "invitee", riskStatus: "clear", riskSignals: {} })),
                getRewardsByRelationship: vi.fn(async () => []),
                getProgram: vi.fn(async () => ({ enabled: true, minimumPaidUsd: "10", coolingOffDays: 7, inviterPoints: 2, inviteeRewardType: "points", inviteePoints: 1 })),
                hasPriorPaidOrder: vi.fn(async () => false),
                createReward,
            },
        });
        const order = {
            id: "topup",
            userId: "invitee",
            nominalUsdValue: "10",
            paidUsdValue: "8",
            creditAmount: "10",
            provider: "stripe",
            paymentState: "paid",
            creditGrantState: "granted",
        } as Parameters<typeof prepareReferralRewardsForPaidOrder>[1]["order"];

        const rewards = await prepareReferralRewardsForPaidOrder({ query: vi.fn() }, { order, provider: "stripe", paidAt: "2026-08-23T00:00:00.000Z" });

        expect(rewards).toHaveLength(2);
        expect(createReward).toHaveBeenCalledWith(expect.objectContaining({ triggerOrderId: "topup", status: "pending" }));
    });

    it("contains no legacy billing or coupon subsystem imports", async () => {
        const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./referral-service.ts", import.meta.url), "utf8"));
        expect(source).not.toContain("billing-service-helpers");
        expect(source).not.toContain("coupon-service");
        expect(source).not.toContain("issueReferralCoupon");
    });

    it("rejects an invalid zero-credit V1 referral reward", async () => {
        const now = "2026-08-23T00:00:00.000Z";
        const reward = {
            id: "reward",
            relationshipId: "rel",
            beneficiaryUserId: "invitee",
            beneficiaryRole: "invitee",
            rewardType: "points",
            pointsAmount: 0,
            triggerOrderId: "topup",
            status: "pending",
            settleAfter: now,
            createdAt: now,
            updatedAt: now,
        };
        const updateReward = vi.fn(async (_id, patch) => ({ ...reward, ...patch }));
        const referrals = {
            getProgram: vi.fn(async () => ({ enabled: true, inviterMonthlyLimit: 0, campaignTotalLimit: 0 })),
            lockDueRewards: vi.fn(async () => [reward]),
            getRelationshipById: vi.fn(async () => ({ id: "rel", inviterUserId: "inviter", riskStatus: "clear" })),
            getRewardsByRelationship: vi.fn(async () => [reward]),
            countSettledInviterRewards: vi.fn(async () => ({ monthly: 0 })),
            countAllSettledInviterRewards: vi.fn(async () => 0),
            updateReward,
        };
        mocks.makeRepositories.mockReturnValue({ referrals, users: { getById: vi.fn() } });
        mocks.transaction.mockImplementation(async (handler) => handler({ query: vi.fn(async () => ({ rows: [] })) }));

        await settleDueReferralRewards({ now: new Date(now) });

        expect(updateReward).toHaveBeenCalledWith("reward", expect.objectContaining({ status: "rejected", reason: "奖励发放失败：邀请积分奖励金额无效" }));
    });

    it("marks an unrecoverable settled referral reward for manual review during full refund", async () => {
        const reward = {
            id: "reward",
            relationshipId: "rel",
            beneficiaryUserId: "inviter",
            beneficiaryRole: "inviter",
            rewardType: "points",
            pointsAmount: 2,
            triggerOrderId: "topup",
            status: "settled",
            settleAfter: "2026-08-23T00:00:00.000Z",
            createdAt: "2026-08-23T00:00:00.000Z",
            updatedAt: "2026-08-23T00:00:00.000Z",
        };
        const updateReward = vi.fn(async (_id, patch) => ({ ...reward, ...patch }));
        const updateRelationship = vi.fn();
        mocks.makeRepositories.mockReturnValue({ referrals: { getRewardsByTriggerOrder: vi.fn(async () => [reward]), updateReward, getRelationshipById: vi.fn(async () => ({ id: "rel", riskSignals: {} })), updateRelationship } });
        mocks.adjustWallet.mockRejectedValue(new QuotaExceededError("钱包余额不足"));

        await reverseReferralRewardsForRefundedOrder({ query: vi.fn() }, { orderId: "topup", refundedAt: "2026-08-24T00:00:00.000Z" });

        expect(updateReward).toHaveBeenCalledWith("reward", expect.objectContaining({ status: "manual_review" }));
        expect(updateRelationship).toHaveBeenCalledWith("rel", expect.objectContaining({ riskStatus: "frozen" }));
    });
});
