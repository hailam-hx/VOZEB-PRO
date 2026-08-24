import { expect, test, type Page } from "@playwright/test";

import { expectNoHorizontalOverflow, expectVisibleControlsWithinViewport } from "./responsive-helpers";

const TIMESTAMP = "2026-08-24T00:00:00.000Z";
const PAGE_SIZE = 8;
const preset = { id: "preset-growth", name: "创作成长充值", description: "服务器报价演示预设", nominalNativeAmount: "100000", enabled: true, sortOrder: 1 };

function quote(custom = false) {
    const nominal = custom ? "250000" : "100000";
    const payable = custom ? "225000" : "90000";
    return {
        presetId: custom ? undefined : preset.id,
        currency: "VND",
        currencyExponent: 0,
        nominalNativeAmount: nominal,
        promotionDiscountNativeAmount: custom ? "15000" : "5000",
        couponDiscountNativeAmount: custom ? "10000" : "5000",
        payableNativeAmount: payable,
        nominalUsdValue: custom ? "10" : "4",
        paidUsdValue: custom ? "9" : "3.6",
        creditAmount: custom ? "2500" : "1000",
        pricingVersion: "payg-v3",
        customerFx: { version: "fx-v7", usdPerVnd: "0.00004" },
        paymentAmount: { kind: "fiat", currency: "VND", amountMinor: payable, minorUnitExponent: 0 },
        promotion: { id: "promo-summer", label: "夏日充值优惠" },
        coupon: { userCouponId: "coupon-credit", templateId: "coupon-template", type: "fixed", value: "10000", currency: "VND" },
    } as const;
}

function paidOrder() {
    const current = quote(true);
    return {
        id: "e2e-top-up-order",
        orderNo: "VZ-E2E-TOP-UP-001",
        status: "paid",
        paymentState: "paid",
        creditGrantState: "granted",
        providerRefundState: "none",
        creditRecoveryState: "none",
        subject: "积分充值 250000 VND",
        provider: "manual",
        customerFxVersion: current.customerFx.version,
        customerFxRate: current.customerFx.usdPerVnd,
        currency: current.currency,
        currencyExponent: current.currencyExponent,
        nominalNativeAmount: current.nominalNativeAmount,
        promotionDiscountNativeAmount: current.promotionDiscountNativeAmount,
        couponDiscountNativeAmount: current.couponDiscountNativeAmount,
        payableNativeAmount: current.payableNativeAmount,
        nominalUsdValue: current.nominalUsdValue,
        paidUsdValue: current.paidUsdValue,
        creditAmount: current.creditAmount,
        pricingVersion: current.pricingVersion,
        paymentAmount: current.paymentAmount,
        createdAt: TIMESTAMP,
        updatedAt: "2026-08-24T00:00:01.000Z",
        paidAt: "2026-08-24T00:00:01.000Z",
    } as const;
}

test("preset or custom top-up uses a server quote, checks out, receives paid SSE, and refreshes wallet and ledger", async ({ page }, testInfo) => {
    await setProjectTheme(page, testInfo.project.name === "mobile-430" ? "dark" : "light");
    const quoteBodies: Record<string, unknown>[] = [];
    const orderBodies: Record<string, unknown>[] = [];
    let walletRefreshes = 0;
    let ledgerRefreshes = 0;
    let eventRequests = 0;

    await page.route(/\/api\/billing\/top-ups\/presets$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: { presets: [preset], paymentProviders: ["manual"] }, msg: "OK" }) }));
    await page.route(/\/api\/billing\/top-ups\/quotes$/, async (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        quoteBodies.push(body);
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: { quote: quote("customAmountVnd" in body) }, msg: "OK" }) });
    });
    await page.route(/\/api\/billing\/top-ups\/orders$/, async (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        orderBodies.push(body);
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: { order: { ...paidOrder(), status: "pending", paymentState: "pending", creditGrantState: "pending" } }, msg: "OK" }) });
    });
    await page.route(/\/api\/billing\/top-ups\/orders\/e2e-top-up-order\/checkout$/, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: { checkout: { provider: "manual", orderId: "e2e-top-up-order", orderNo: "VZ-E2E-TOP-UP-001", kind: "manual" } }, msg: "OK" }) }),
    );
    await page.route(/\/api\/billing\/top-ups\/orders\/e2e-top-up-order\/events$/, async (route) => {
        eventRequests += 1;
        await route.fulfill({
            status: 200,
            headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
            body: `data: ${JSON.stringify({ code: 0, data: { order: paidOrder() }, msg: "OK" })}\n\n`,
        });
    });
    await page.route(/\/api\/auth\/session$/, (route) => {
        walletRefreshes += 1;
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                user: {
                    id: "e2e-user",
                    accountId: "0001",
                    username: "e2e_admin",
                    displayName: "E2E 管理员",
                    bio: "",
                    role: "admin",
                    adminPermissions: [],
                    status: "active",
                    settledBalance: "2500",
                    heldBalance: "0",
                    availableBalance: "2500",
                    mfaEnabled: false,
                },
            }),
        });
    });
    await page.route(/\/api\/points(?:\?.*)?$/, (route) => {
        ledgerRefreshes += 1;
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ records: [{ id: "top-up-ledger", type: "top_up", amount: "2500", balanceAfter: "2500", description: "充值入账", createdAt: TIMESTAMP }], total: 1, page: 1, pageSize: 1 }),
        });
    });

    await page.goto("/billing/checkout?promotion=promo-summer&coupon=coupon-credit", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "充值积分" })).toBeVisible();
    await expect(page.getByText("创作成长充值", { exact: true })).toBeVisible();
    await expect(page.getByText("夏日充值优惠", { exact: true })).toBeVisible();
    await expect(page.getByText("已应用优惠券", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /自定义金额/ }).click();
    await page.getByRole("textbox", { name: "自定义充值金额" }).fill("250000");
    await expect.poll(() => quoteBodies.at(-1)).toEqual({ customAmountVnd: "250000", promotionId: "promo-summer", userCouponId: "coupon-credit" });
    await expect(page.getByText("2,500 积分", { exact: true })).toBeVisible();
    await expect(page.getByText(/payg-v3/)).toBeVisible();
    await page.getByRole("button", { name: /确认并支付/ }).click();
    await expect.poll(() => orderBodies.at(-1)).toEqual({ customAmountVnd: "250000", promotionId: "promo-summer", userCouponId: "coupon-credit", provider: "manual" });
    expect(Object.keys(orderBodies.at(-1) || {}).sort()).toEqual(["customAmountVnd", "promotionId", "provider", "userCouponId"]);
    await expect(page.getByRole("heading", { name: "订单已创建" })).toBeVisible();
    const walletBeforePaid = walletRefreshes;
    await page.getByRole("button", { name: "查看说明" }).click();
    await expect(page.getByRole("heading", { name: "支付成功" })).toBeVisible();
    await expect(page.getByText("VZ-E2E-TOP-UP-001", { exact: true })).toBeVisible();
    await expect(page.getByText("已支付", { exact: true })).toBeVisible();
    await expect.poll(() => eventRequests).toBe(1);
    await expect.poll(() => walletRefreshes).toBeGreaterThan(walletBeforePaid);
    await expect.poll(() => ledgerRefreshes).toBeGreaterThan(0);
    await expectNoHorizontalOverflow(page, `top-up paid ${testInfo.project.name}`);
    await expectVisibleControlsWithinViewport(page, `top-up paid controls ${testInfo.project.name}`);
});

test("admin pricing, provider-unit conversion, usage anomaly, and orphan recovery remain responsive", async ({ page }, testInfo) => {
    await setProjectTheme(page, testInfo.project.name === "mobile-390" ? "light" : "dark");
    let recoveryRuns = 0;
    await page.route(/\/api\/admin\/billing\/top-up-config$/, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: { config: { pricingVersion: "payg-v3", customerFxVersion: "fx-v7", usdPerVnd: "0.00004" } }, msg: "OK" }) }),
    );
    await page.route(/\/api\/admin\/settings$/, (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                settings: {
                    logicalModels: [
                        {
                            id: "logical-image",
                            name: "商业图片模型",
                            capability: "image",
                            enabled: true,
                            saleRateCard: { version: "sale-v4", components: [{ dimension: "output_image", unitPrice: "12", per: "image" }] },
                            bindings: [
                                {
                                    id: "binding-fal",
                                    channelId: "fal-channel",
                                    upstreamModel: "fal-image-v2",
                                    enabled: true,
                                    priority: 1,
                                    weight: 1,
                                    costRateCard: { version: "cost-v9", components: [{ dimension: "megapixel", unitPrice: "0.03", per: "megapixel" }] },
                                    providerCostUnit: { kind: "provider-native", provider: "fal", unit: "megapixel", usdConversion: { version: "provider-fx-v2", usdPerUnit: "0.03" } },
                                },
                            ],
                        },
                    ],
                },
            }),
        }),
    );
    await page.route(/\/api\/admin\/billing\/usage(?:\?.*)?$/, (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                code: 0,
                data: {
                    items: [
                        {
                            id: "usage-negative",
                            userId: "user-one",
                            holdId: "hold-one",
                            capability: "image",
                            usageSource: "provider_reported",
                            settledCredits: "12",
                            providerCostUsd: "0.75",
                            marginUsd: "-0.25",
                            estimated: false,
                            anomaly: "negative_margin",
                            createdAt: TIMESTAMP,
                        },
                    ],
                    recovery: [{ id: "hold-orphan", userId: "user-one", businessId: "generation:orphan", amount: "12", reviewReason: "任务终态待复核", createdAt: TIMESTAMP }],
                    total: 1,
                    page: 1,
                    pageSize: 20,
                    zeroUsage: 0,
                    negativeMargin: 1,
                },
                msg: "OK",
            }),
        }),
    );
    await page.route(/\/api\/admin\/billing\/usage\/recovery$/, async (route) => {
        recoveryRuns += 1;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: { inspected: 1, retained: 0, settled: 0, released: 1, needsReview: 0 }, msg: "OK" }) });
    });

    await page.goto("/admin/billing?tab=pricing", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "客户汇率与模型计价" })).toBeVisible();
    await expect(page.getByText("商业图片模型", { exact: true })).toBeVisible();
    await expect(page.getByText(/fal:megapixel × 0.03 USD \(provider-fx-v2\)/)).toBeVisible();
    await page.getByText("用量毛利", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "用量、成本与毛利" })).toBeVisible();
    await expect(page.getByText("负毛利", { exact: true }).last()).toBeVisible();
    await page.getByText("异常恢复", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "孤儿预留恢复" })).toBeVisible();
    await expect(page.getByText("任务终态待复核", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "立即检查" }).click();
    await expect.poll(() => recoveryRuns).toBe(1);
    await expectNoHorizontalOverflow(page, `admin PAYG ${testInfo.project.name}`);
    await expectVisibleControlsWithinViewport(page, `admin PAYG controls ${testInfo.project.name}`);
});

test("referral progress and credit rewards retain separate server pages", async ({ page }) => {
    const requests: Array<{ referralsPage: number; rewardsPage: number }> = [];
    await page.route(/\/api\/referrals(?:\?.*)?$/, async (route) => {
        const query = new URL(route.request().url()).searchParams;
        const referralsPage = Number(query.get("referralsPage") || "1");
        const rewardsPage = Number(query.get("rewardsPage") || "1");
        requests.push({ referralsPage, rewardsPage });
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: referralCenter(referralsPage, rewardsPage), msg: "OK" }) });
    });
    await page.goto("/profile?section=referrals", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("受邀用户页 1", { exact: true })).toBeVisible();
    await expect(page.getByText(/积分奖励页 1/)).toBeVisible();
    const paginations = page.locator(".ant-pagination");
    await expect(paginations).toHaveCount(2);
    await paginations.nth(0).locator(".ant-pagination-next button").click();
    await expect(page.getByText("受邀用户页 2", { exact: true })).toBeVisible();
    expect(requests).toContainEqual({ referralsPage: 2, rewardsPage: 1 });
    await paginations.nth(1).locator(".ant-pagination-next button").click();
    await expect(page.getByText(/积分奖励页 2/)).toBeVisible();
    expect(requests).toContainEqual({ referralsPage: 2, rewardsPage: 2 });
    await expectNoHorizontalOverflow(page, "credit referral pagination");
});

function referralCenter(referralsPage: number, rewardsPage: number) {
    return {
        program: { enabled: true, inviterPoints: 100, inviteePoints: 50, minimumPaidUsd: "4", coolingOffDays: 7 },
        code: "E2E-REFERRAL",
        link: "http://127.0.0.1/register?ref=E2E-REFERRAL",
        stats: { clicks: 20, registrations: 16, qualified: 8, pending: 2, settled: 6, revoked: 0 },
        referrals: [{ id: `referral-${referralsPage}`, inviteeName: `受邀用户页 ${referralsPage}`, riskStatus: "clear", registeredAt: TIMESTAMP }],
        referralsTotal: PAGE_SIZE * 2,
        referralsPage,
        referralsPageSize: PAGE_SIZE,
        rewards: [
            {
                id: `reward-${rewardsPage}`,
                relationshipId: `relationship-${rewardsPage}`,
                beneficiaryUserId: "e2e-user",
                beneficiaryRole: "inviter",
                pointsAmount: String(rewardsPage * 100),
                triggerOrderId: `order-${rewardsPage}`,
                status: "settled",
                settleAfter: TIMESTAMP,
                reason: `积分奖励页 ${rewardsPage}`,
                createdAt: TIMESTAMP,
            },
        ],
        rewardsTotal: PAGE_SIZE * 2,
        rewardsPage,
        rewardsPageSize: PAGE_SIZE,
    };
}

async function setProjectTheme(page: Page, theme: "light" | "dark") {
    await page.addInitScript((nextTheme) => localStorage.setItem("vozeb-pro:theme_store", JSON.stringify({ state: { theme: nextTheme }, version: 0 })), theme);
}
