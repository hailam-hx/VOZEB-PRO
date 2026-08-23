"use client";

import { App, Button } from "antd";
import { Camera } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { userAvatarFallback } from "@/lib/user-avatar";
import { type LocalUser, useUserStore } from "@/stores/use-user-store";

export function ProfileAvatarUploader({ onUpdated }: { onUpdated?: (user: LocalUser) => void }) {
    const t = useTranslations("profile.avatarUploader");
    const { message } = App.useApp();
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const user = useUserStore((state) => state.user);
    const setUser = useUserStore((state) => state.setUser);
    const fallback = userAvatarFallback(user?.displayName || user?.username || t("userFallback"));

    const upload = async (file: File) => {
        if (!/^image\/(?:png|jpe?g|webp)$/i.test(file.type)) return message.warning(t("invalidFormat"));
        if (file.size > 5 * 1024 * 1024) return message.warning(t("tooLarge"));
        setUploading(true);
        try {
            const body = new FormData();
            body.set("avatar", file);
            const response = await fetch("/api/auth/avatar", { method: "POST", body });
            const payload = (await response.json().catch(() => null)) as { code?: number; data?: { user?: LocalUser }; msg?: string } | null;
            if (!response.ok || payload?.code !== 0 || !payload.data?.user) throw new Error(payload?.msg || t("updateFailed"));
            setUser(payload.data.user);
            onUpdated?.(payload.data.user);
            message.success(t("updated"));
        } catch {
            message.error(t("updateFailed"));
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="flex min-w-0 items-center gap-3 border-b border-border pb-4 sm:gap-4">
            <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full bg-foreground text-sm font-semibold text-background ring-1 ring-border">
                {user?.avatarUrl ? <img src={user.avatarUrl} alt={t("currentAvatar")} className="size-full object-cover" /> : fallback}
            </span>
            <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground">{t("title")}</div>
                <div className="mt-1 text-xs text-muted-foreground">{t("description")}</div>
            </div>
            <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                aria-label={t("selectAria")}
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void upload(file);
                }}
            />
            <Button className="shrink-0" icon={<Camera className="size-4" />} loading={uploading} onClick={() => inputRef.current?.click()}>
                {t("change")}
            </Button>
        </div>
    );
}
