"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button } from "antd";
import { UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { getWorkCommunity, setWorkAuthorFollow, type WorkCommunitySummary } from "@/services/api/work-community";
import { useUserStore } from "@/stores/use-user-store";
import { PublicWorkLikeButton } from "./public-work-like-button";

export function PublicWorkCommunityActions({ slug, className, compact = false, compactFollowIcon = false }: { slug: string; className?: string; compact?: boolean; compactFollowIcon?: boolean }) {
    const t = useTranslations("public.work.community");
    const router = useRouter();
    const queryClient = useQueryClient();
    const user = useUserStore((state) => state.user);
    const { message } = App.useApp();
    const [busy, setBusy] = useState(false);
    const summaryQuery = useQuery({ queryKey: ["work-community", slug], queryFn: () => getWorkCommunity(slug), staleTime: 15_000 });
    const summary = summaryQuery.data;

    const requireLogin = () => {
        if (user) return true;
        message.info(t("loginRequired"));
        router.push(`/login?next=${encodeURIComponent(`/share/${slug}`)}`);
        return false;
    };

    const updateSummary = (patch: Partial<WorkCommunitySummary>) => queryClient.setQueryData<WorkCommunitySummary>(["work-community", slug], (current) => (current ? { ...current, ...patch } : current));

    const toggleFollow = async () => {
        if (!requireLogin() || !summary || busy) return;
        setBusy(true);
        try {
            const result = await setWorkAuthorFollow(slug, !summary.followingAuthor);
            updateSummary({ followingAuthor: result.active, followerCount: result.followerCount });
            message.success(result.active ? t("followed") : t("unfollowed"));
        } catch {
            message.error(t("followFailed"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)} aria-label={t("aria")}>
            <PublicWorkLikeButton slug={slug} initialCount={summary?.likeCount} compact={compact} />
            {summary?.canFollow ? (
                <Button
                    size={compact ? "small" : "middle"}
                    type={summary.followingAuthor ? "default" : "primary"}
                    shape={compact && compactFollowIcon ? "circle" : "default"}
                    icon={<UserPlus className="size-4" />}
                    loading={busy}
                    disabled={busy}
                    aria-label={summary.followingAuthor ? t("unfollowAuthor") : t("followAuthor")}
                    title={t("followCount", { state: summary.followingAuthor ? t("following") : t("followAuthor"), count: summary.followerCount })}
                    onClick={() => void toggleFollow()}
                >
                    {compact && compactFollowIcon ? null : t("followCount", { state: summary.followingAuthor ? t("following") : t("followAuthor"), count: summary.followerCount })}
                </Button>
            ) : null}
        </div>
    );
}
