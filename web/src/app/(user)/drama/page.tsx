"use client";

import { useEffect, useState } from "react";
import { App, Button, Input, InputNumber, Modal, Segmented } from "antd";
import { Clapperboard, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useUserStore } from "@/stores/use-user-store";
import { CompactEmptyState } from "@/components/compact-empty-state";
import { normalizeDramaImageSize } from "@/lib/drama-image-size";

import { DramaProjectCard } from "./components/drama-project-card";
import { useDramaStore } from "./stores/use-drama-store";

export default function DramaPage() {
    const t = useTranslations("drama.list");
    const router = useRouter();
    const { message } = App.useApp();
    const hydrated = useDramaStore((state) => state.hydrated);
    const hydrate = useDramaStore((state) => state.hydrate);
    const syncError = useDramaStore((state) => state.syncError);
    const projects = useDramaStore((state) => state.summaries);
    const projectTotal = useDramaStore((state) => state.summaryTotal);
    const loadingMore = useDramaStore((state) => state.summaryLoadingMore);
    const loadMore = useDramaStore((state) => state.loadMore);
    const createProject = useDramaStore((state) => state.createProject);
    const userId = useUserStore((state) => state.user?.id || "");
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState("");
    const [summary, setSummary] = useState("");
    const [style, setStyle] = useState(() => t("defaultStyle"));
    const [ratio, setRatio] = useState("9:16");
    const [customWidth, setCustomWidth] = useState(1080);
    const [customHeight, setCustomHeight] = useState(1920);
    const [creating, setCreating] = useState(false);
    const episodeCount = projects.reduce((total, project) => total + project.episodeCount, 0);
    const pendingCount = projects.reduce((total, project) => total + project.pendingTaskCount, 0);
    useEffect(() => {
        void hydrate();
    }, [hydrate, userId]);
    const create = async () => {
        if (!title.trim()) return message.warning(t("errors.titleRequired"));
        const normalizedSize = normalizeDramaImageSize(ratio);
        if (!normalizedSize) return message.warning(t("errors.invalidSize"));
        setCreating(true);
        try {
            const id = await createProject({ title: title.trim(), summary: summary.trim(), style: style.trim(), ratio: normalizedSize });
            setOpen(false);
            setTitle("");
            setSummary("");
            router.push(`/drama/${id}`);
        } catch {
            message.error(t("errors.createFailed"));
        } finally {
            setCreating(false);
        }
    };
    return (
        <main className="h-full overflow-y-auto bg-background text-foreground">
            <div className="mx-auto w-full max-w-7xl px-2 py-2 sm:px-6 sm:py-8">
                <header className="flex items-end justify-between gap-3 border-b border-border pb-3 sm:gap-5 sm:pb-6">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Clapperboard className="size-4" />
                            {t("pipeline")}
                        </div>
                        <h1 className="mt-1.5 text-xl font-semibold sm:mt-2 sm:text-2xl">{t("title")}</h1>
                        <p className="mt-1.5 text-xs leading-5 text-muted-foreground sm:mt-2 sm:text-sm">{t("summary", { total: projectTotal, loaded: projects.length, episodes: episodeCount, pending: pendingCount })}</p>
                    </div>
                    <Button type="primary" className="!h-9 !shrink-0 !px-3 sm:!px-4" icon={<Plus className="size-4" />} disabled={!hydrated} onClick={() => setOpen(true)}>
                        {t("newDrama")}
                    </Button>
                </header>
                {syncError ? <div className="mt-4 border-l-2 border-amber-400 pl-3 text-sm text-amber-700 dark:text-amber-200">{t("serviceUnavailable")}</div> : null}
                {!hydrated ? (
                    <div className="grid min-h-16 place-items-center text-sm text-muted-foreground sm:min-h-32">{t("loading")}</div>
                ) : projects.length ? (
                    <>
                        <section className="grid gap-1.5 py-1 sm:grid-cols-2 sm:gap-4 sm:py-6 xl:grid-cols-3">
                            {projects.map((project) => (
                                <DramaProjectCard key={project.id} project={project} />
                            ))}
                        </section>
                        {projects.length < projectTotal ? (
                            <div className="flex justify-center pb-4 sm:pb-8">
                                <Button loading={loadingMore} onClick={() => void loadMore()}>
                                    {t("loadMore")}
                                </Button>
                            </div>
                        ) : null}
                    </>
                ) : (
                    <CompactEmptyState
                        title={t("emptyTitle")}
                        description={t("emptyDescription")}
                        icon={<Clapperboard className="size-4" />}
                        className="mt-3 min-h-24 sm:mt-6 sm:min-h-40"
                        action={
                            <Button type="primary" onClick={() => setOpen(true)}>
                                {t("createFirst")}
                            </Button>
                        }
                    />
                )}
            </div>
            <Modal
                title={t("modalTitle")}
                open={open}
                width={520}
                destroyOnHidden
                style={{ maxWidth: "calc(100vw - 24px)" }}
                styles={{ body: { paddingTop: 4 } }}
                confirmLoading={creating}
                onCancel={() => setOpen(false)}
                onOk={() => void create()}
                okText={t("createAndOpen")}
                cancelText={t("cancel")}
                okButtonProps={{ className: "!h-9" }}
                cancelButtonProps={{ className: "!h-9" }}
            >
                <div className="grid gap-3 pt-1">
                    <div className="grid gap-1.5">
                        <label htmlFor="drama-project-title" className="text-sm font-medium leading-5">
                            {t("projectName")}
                        </label>
                        <Input id="drama-project-title" className="!h-9" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("projectNamePlaceholder")} />
                    </div>
                    <div className="grid gap-1.5">
                        <label htmlFor="drama-project-summary" className="text-sm font-medium leading-5">
                            {t("storySummary")}
                        </label>
                        <Input.TextArea id="drama-project-summary" value={summary} onChange={(event) => setSummary(event.target.value)} autoSize={{ minRows: 2, maxRows: 3 }} placeholder={t("storySummaryPlaceholder")} />
                    </div>
                    <div className="grid gap-1.5">
                        <label htmlFor="drama-project-style" className="text-sm font-medium leading-5">
                            {t("visualStyle")}
                        </label>
                        <Input id="drama-project-style" className="!h-9" value={style} onChange={(event) => setStyle(event.target.value)} />
                    </div>
                    <div className="grid min-w-0 gap-1.5">
                        <span className="text-sm font-medium leading-5">{t("generationSize")}</span>
                        <div className="min-w-0">
                            <Segmented
                                block
                                className="!w-full"
                                value={ratio.includes("x") ? "custom" : ratio}
                                options={[
                                    { label: "9:16", value: "9:16" },
                                    { label: "16:9", value: "16:9" },
                                    { label: t("custom"), value: "custom" },
                                ]}
                                onChange={(value) => setRatio(value === "custom" ? `${customWidth}x${customHeight}` : String(value))}
                            />
                        </div>
                        {ratio.includes("x") ? (
                            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                                <InputNumber
                                    className="!w-full"
                                    min={256}
                                    value={customWidth}
                                    prefix="W"
                                    onChange={(value) => {
                                        const width = Number(value) || 256;
                                        setCustomWidth(width);
                                        setRatio(`${width}x${customHeight}`);
                                    }}
                                />
                                <span className="text-muted-foreground">×</span>
                                <InputNumber
                                    className="!w-full"
                                    min={256}
                                    value={customHeight}
                                    prefix="H"
                                    onChange={(value) => {
                                        const height = Number(value) || 256;
                                        setCustomHeight(height);
                                        setRatio(`${customWidth}x${height}`);
                                    }}
                                />
                            </div>
                        ) : null}
                    </div>
                </div>
            </Modal>
        </main>
    );
}
