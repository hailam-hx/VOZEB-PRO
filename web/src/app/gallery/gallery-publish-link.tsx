"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { usePublicSessionStore } from "@/stores/use-public-session-store";

export function GalleryPublishLink({ className, label }: { className: string; label?: string }) {
    const t = useTranslations("public");
    const ready = usePublicSessionStore((state) => state.ready);
    const user = usePublicSessionStore((state) => state.payload?.user);

    if (!ready || !user) return null;

    return (
        <Link href="/works" className={className}>
            <Plus className="size-4" />
            {label || t("publishWork")}
        </Link>
    );
}
