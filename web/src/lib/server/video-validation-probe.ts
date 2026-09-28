import type { LogicalModelBinding, SystemChannelModelConfig, SystemModelChannel } from "@/lib/auth/store-types";
import type { VideoValidationProbeResult } from "@/lib/video-validation";
import { validateStaticVideoContract } from "./video-validation-contract";

type ProbeInput = {
    binding: LogicalModelBinding;
    channel: SystemModelChannel;
    operation: Partial<SystemChannelModelConfig>;
    credentialAvailable: boolean;
    eligible: boolean;
};

export function probeVideoBinding(input: ProbeInput): VideoValidationProbeResult {
    if (!input.channel.enabled || !input.binding.enabled || !input.eligible) return result("CAPABILITY_INCOMPLETE", "BINDING_INELIGIBLE", "模型绑定当前未启用或不可路由");
    if (!input.credentialAvailable) return result("AUTH_UNAVAILABLE", "CREDENTIAL_UNAVAILABLE", "渠道没有可用的认证凭据");
    if (!input.binding.generationParameters) return result("CAPABILITY_INCOMPLETE", "GENERATION_PARAMETERS_MISSING", "管理员尚未为该模型配置视频生成能力");
    const contract = validateStaticVideoContract({ operation: input.operation, generationParameters: input.binding.generationParameters });
    if (contract.status === "FAILED") return result("CAPABILITY_INCOMPLETE", contract.reasons[0] || "CONTRACT_INCOMPLETE", "视频协议合同不完整");
    const profile = input.binding.providerPricingProfile;
    if (profile?.status === "NEEDS_REVIEW" || profile?.unknownFields.length) return result("NEEDS_REVIEW", "PRICING_NEEDS_REVIEW", "上游计价字段需要管理员复核");
    if (!profile || profile.status !== "READY" || !input.binding.costRateCard) return result("PRICING_INCOMPLETE", "PRICING_NOT_READY", "模型成本价格尚未达到可执行状态");
    return result("CONTRACT_READY", "READY", "合同、能力和计价均可执行");
}

function result(status: VideoValidationProbeResult["status"], reasonCode: string, message: string): VideoValidationProbeResult {
    return { status, reasonCode, message };
}
