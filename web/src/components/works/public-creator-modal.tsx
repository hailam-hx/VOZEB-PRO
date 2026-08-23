"use client";

import { useQuery } from "@tanstack/react-query";
import { Button, Modal } from "antd";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { getPublicCreatorPage } from "@/services/api/work-community";
import { PublicCreatorProfile } from "./public-creator-profile";
import { PublicWorkPreviewModal } from "./public-work-preview-modal";

export function PublicCreatorModal({ username, nextPath, onClose }: { username?: string; nextPath: string; onClose: () => void }) {
    const t = useTranslations("public.creatorProfile");
    const [activeUsername, setActiveUsername] = useState(username || "");
    const [previewSlug, setPreviewSlug] = useState("");

    useEffect(() => {
        setActiveUsername(username || "");
        setPreviewSlug("");
    }, [username]);

    const query = useQuery({
        queryKey: ["public-creator", activeUsername],
        queryFn: () => getPublicCreatorPage(activeUsername, { limit: 18 }),
        enabled: Boolean(activeUsername),
        staleTime: 30_000,
    });

    return (
        <>
            <Modal centered open={Boolean(username)} width="min(1080px, calc(100vw - 16px))" footer={null} destroyOnHidden title={null} onCancel={onClose} styles={{ container: { padding: 0, overflow: "hidden" }, body: { padding: 0 } }}>
                <div className="max-h-[92dvh] min-w-0 overflow-y-auto bg-background text-foreground">
                    {query.isLoading ? (
                        <div className="flex min-h-[420px] items-center justify-center gap-2 text-sm text-muted-foreground">
                            <LoaderCircle className="size-4 animate-spin" /> {t("loading")}
                        </div>
                    ) : query.error || !query.data ? (
                        <div className="grid min-h-[360px] place-items-center px-5 text-center">
                            <div>
                                <p className="text-sm font-semibold">{t("unavailable")}</p>
                                <p className="mt-2 text-xs text-muted-foreground">{t("notFound")}</p>
                                <Button className="mt-4" onClick={() => void query.refetch()}>
                                    {t("reload")}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <PublicCreatorProfile key={activeUsername} initialData={query.data} nextPath={nextPath} compact onOpenWork={setPreviewSlug} onOpenAuthor={(nextUsername) => setActiveUsername(nextUsername)} />
                    )}
                </div>
            </Modal>
            <PublicWorkPreviewModal
                slug={previewSlug || undefined}
                onClose={() => setPreviewSlug("")}
                onOpenCreator={(nextUsername) => {
                    setPreviewSlug("");
                    setActiveUsername(nextUsername);
                }}
            />
        </>
    );
}
