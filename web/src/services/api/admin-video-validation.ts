import type { StartVideoValidationRunRequest, VideoValidationItem, VideoValidationPreview, VideoValidationPreviewRequest, VideoValidationRun } from "@/lib/video-validation";

async function json<T>(response: Response): Promise<T> {
    const payload = (await response.json().catch(() => ({}))) as { data?: T; msg?: string };
    if (!response.ok || payload.data === undefined) throw new Error(payload.msg || "视频验收请求失败");
    return payload.data;
}

export async function previewAdminVideoValidation(input: VideoValidationPreviewRequest) {
    return json<VideoValidationPreview>(await fetch("/api/admin/video-validation/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }));
}

export async function startAdminVideoValidation(input: StartVideoValidationRunRequest) {
    return json<{ run: VideoValidationRun }>(await fetch("/api/admin/video-validation/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }));
}

export async function listAdminVideoValidationRuns(page = 1, pageSize = 10) {
    return json<{ items: VideoValidationRun[]; total: number; unavailableReason?: "POSTGRES_REQUIRED" }>(await fetch(`/api/admin/video-validation/runs?page=${page}&pageSize=${pageSize}`, { cache: "no-store" }));
}

export async function getAdminVideoValidationRun(runId: string) {
    return json<{ run: VideoValidationRun; items: VideoValidationItem[] }>(await fetch(`/api/admin/video-validation/runs/${encodeURIComponent(runId)}`, { cache: "no-store" }));
}

export async function cancelAdminVideoValidationRun(runId: string) {
    return json<{ run: VideoValidationRun; items: VideoValidationItem[] }>(await fetch(`/api/admin/video-validation/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }));
}
