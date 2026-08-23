import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ makeRepositories: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/server/database", () => ({
    createPostgresRepositories: mocks.makeRepositories,
    ensurePostgresSchema: vi.fn(),
    isPostgresDatabaseEnabled: () => true,
    withPostgresTransaction: mocks.transaction,
}));

import { prepareReferralRewardsForPaidOrder, settleDueReferralRewards } from "./referral-service";

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
            id: "topup", userId: "invitee", nominalUsdValue: "10", paidUsdValue: "8", creditAmount: "10", provider: "stripe", paymentState: "paid", creditGrantState: "granted",
        } as Parameters<typeof prepareReferralRewardsForPaidOrder>[1]["order"];

        const rewards = await prepareReferralRewardsForPaidOrder({ query: vi.fn() }, { order, provider: "stripe", paidAt: "2026-08-23T00:00:00.000Z" });

        expect(rewards).toHaveLength(2);
        expect(createReward).toHaveBeenCalledWith(expect.objectContaining({ triggerOrderId: "topup", status: "pending" }));
    });

    it("contains no legacy billing or coupon subsystem imports", async () => {
        const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./referral-service.ts", import.meta.url), "utf8"));
        expect(source).not.toContain("billing-service-helpers");
        expect(source).not.toContain("coupon-service");
        expect(source).toContain("issueReferralCoupon");
    });

    it("sends an invalid V1 top-up coupon mapping to manual review", async () => {
        const now = "2026-08-23T00:00:00.000Z";
        const reward = { id: "reward", relationshipId: "rel", beneficiaryUserId: "invitee", beneficiaryRole: "invitee", rewardType: "coupon", pointsAmount: 0, topUpCouponTemplateId: "missing", triggerOrderId: "topup", status: "pending", settleAfter: now, createdAt: now, updatedAt: now };
        const updateReward = vi.fn(async (_id, patch) => ({ ...reward, ...patch }));
        const referrals = { getProgram: vi.fn(async () => ({ enabled: true, inviterMonthlyLimit: 0, campaignTotalLimit: 0 })), lockDueRewards: vi.fn(async () => [reward]), getRelationshipById: vi.fn(async () => ({ id: "rel", inviterUserId: "inviter", riskStatus: "clear" })), getRewardsByRelationship: vi.fn(async () => [reward]), countSettledInviterRewards: vi.fn(async () => ({ monthly: 0 })), countAllSettledInviterRewards: vi.fn(async () => 0), updateReward };
        mocks.makeRepositories.mockReturnValue({ referrals, users: { getById: vi.fn() }, topUps: { issueReferralCoupon: vi.fn(async () => null) } });
        mocks.transaction.mockImplementation(async (handler) => handler({ query: vi.fn(async () => ({ rows: [] })) }));

        await settleDueReferralRewards({ now: new Date(now) });

        expect(updateReward).toHaveBeenCalledWith("reward", expect.objectContaining({ status: "manual_review" }));
    });
});
