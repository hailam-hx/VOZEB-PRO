import { getPaymentConfigSummary } from "@/lib/server/payment-config-status";
import { listTopUpPresets } from "@/lib/server/top-up-commerce-service";
import { commerceError, commerceOk } from "../../commerce-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const [presets, paymentConfig] = await Promise.all([listTopUpPresets(false), getPaymentConfigSummary()]);
        return commerceOk({
            presets,
            paymentProviders: paymentConfig.providers.filter((provider) => provider.enabled && provider.checkoutReady).map((provider) => provider.id),
        });
    } catch (error) {
        return commerceError(error, "获取充值预设失败", "List top-up presets failed");
    }
}
