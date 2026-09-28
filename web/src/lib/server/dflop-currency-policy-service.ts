import type { SystemModelChannel } from "@/lib/auth/store";
import { normalizeSystemPricingPolicy, parseDflopCurrencyConfig, type SystemPricingPolicy } from "@/lib/billing/pricing-policy";
import { fetchSafeOutbound } from "@/lib/server/safe-outbound-fetch";
import { isSafeOutboundUrl } from "@/lib/server/security";
import { AuthInputError } from "@/lib/auth/store-foundation";
import { buildAdminPricingPolicy } from "@/lib/server/admin-pricing-policy-service";

const MANAGED_FIELDS = ["dflopCreditsPerCny", "dflopCreditsPerCnySource", "dflopCurrencyConfigVersion"] as const;

export async function verifyDflopPricingPolicyDraft(current: SystemPricingPolicy, requested: unknown, channels: SystemModelChannel[]) {
    if (!requested || typeof requested !== "object" || Array.isArray(requested)) throw new AuthInputError("定价策略无效");
    const requestedFields = requested as Record<string, unknown>;
    let submitted: SystemPricingPolicy;
    try {
        submitted = normalizeSystemPricingPolicy({ ...current, ...requestedFields });
    } catch (error) {
        throw new AuthInputError(error instanceof Error ? error.message : "定价策略无效");
    }
    const managedChanged = MANAGED_FIELDS.some((field) => field in requestedFields && submitted[field] !== current[field]);
    if (!managedChanged) return buildAdminPricingPolicy(current, requested);

    const editable = buildAdminPricingPolicy(current, {
        ...requestedFields,
        version: current.version,
        dflopCreditsPerCny: current.dflopCreditsPerCny,
        dflopCreditsPerCnySource: current.dflopCreditsPerCnySource,
        dflopCurrencyConfigVersion: current.dflopCurrencyConfigVersion,
    });
    const dflopChannels = channels.filter((channel) => channel.advancedConfig?.protocol === "dflop" && channel.baseUrl.trim());
    for (const channel of dflopChannels) {
        try {
            const url = new URL("/api/v1/config/currency", channel.baseUrl).toString();
            if (!(await isSafeOutboundUrl(url))) continue;
            const response = await fetchSafeOutbound(url, { headers: { accept: "application/json", "user-agent": "HOTX-AI-DFLOP-Pricing" }, cache: "no-store" });
            if (!response.ok) continue;
            const currency = parseDflopCurrencyConfig(await response.json().catch(() => undefined));
            if (!currency) continue;
            const verified = normalizeSystemPricingPolicy({
                ...editable,
                dflopCreditsPerCny: currency.creditsPerCny,
                dflopCreditsPerCnySource: "upstream",
                dflopCurrencyConfigVersion: currency.version,
            });
            if (MANAGED_FIELDS.some((field) => field in requestedFields && verified[field] !== submitted[field]) || ("version" in requestedFields && verified.version !== submitted.version)) break;
            return verified;
        } catch {
            // Try another configured DFLOP channel before rejecting the draft.
        }
    }
    throw new AuthInputError("DFLOP 服务端管理汇率不允许由客户端修改，且当前无法从上游验证该草稿");
}
