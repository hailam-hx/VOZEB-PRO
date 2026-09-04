import { transitionAudioTask, type AudioTask, type AudioTaskConfig } from "@/lib/server/audio-task-store";

const CAPABILITY_ERROR_PREFIX = "没有兼容当前生成参数的音频渠道";

export async function retryAudioTaskAfterCapabilityChange(task: AudioTask, config: AudioTaskConfig, candidateConfigs: AudioTaskConfig[]) {
    if (task.status !== "error" || !task.error?.startsWith(CAPABILITY_ERROR_PREFIX) || task.upstream?.id || (task.billing?.pointsRecordId && !task.billing.refunded)) return null;
    return transitionAudioTask(task, ["error"], { status: "pending", config, candidateConfigs, error: "" }, { executionPhase: "created", nextPollAt: Date.now(), lastUpstreamStatus: "capability_retry" });
}
