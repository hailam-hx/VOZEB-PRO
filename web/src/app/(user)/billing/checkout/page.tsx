import { BillingCheckoutPage } from "./checkout-client";

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const params = await searchParams;
    const value = (key: string) => {
        const candidate = params[key];
        return (Array.isArray(candidate) ? candidate[0] : candidate)?.trim() || undefined;
    };
    return <BillingCheckoutPage initialPresetId={value("preset")} initialAmountVnd={value("amount")} promotionId={value("promotion")} userCouponId={value("coupon")} />;
}
