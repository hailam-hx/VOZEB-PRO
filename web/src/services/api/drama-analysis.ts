import { syncUserPointsFromHeaders } from "@/services/api/points";

export async function requestDramaAnalysis<T>(body: Record<string, unknown>) {
    const response = await fetch("/api/drama/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    syncUserPointsFromHeaders(response.headers, "system");
    const payload = (await response.json().catch(() => null)) as { code?: number; data?: T | null; msg?: string } | null;
    if (!response.ok || !payload || payload.code !== 0 || payload.data == null) throw new Error(payload?.msg || "剧本分析失败");
    return payload.data;
}
