import type { WorkPublicationModerationStatus } from "@/services/api/work-publications";

export { WORK_CATEGORY_OPTIONS } from "@/lib/work-publication-options";

export const WORK_STATUSES: Array<WorkPublicationModerationStatus | "all"> = ["all", "draft", "pending", "approved", "rejected", "taken_down"];

export function workSharePath(slug: string) {
    return `/share/${encodeURIComponent(slug)}`;
}
