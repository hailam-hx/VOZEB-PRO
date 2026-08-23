"use client";

import { FileAudio, FileDown, FileUp, Film, Plus, Search, Upload } from "lucide-react";
import { useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { App, Button, Form, Input, Modal, Pagination, Segmented, Select, Space, Spin, Tag, Tooltip, Typography } from "antd";
import { saveAs } from "file-saver";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { useCopyText } from "@/hooks/use-copy-text";
import { CompactEmptyState } from "@/components/compact-empty-state";
import { droppedFiles, leftDropTarget, preventFileDragEvent } from "@/lib/file-drop";
import { formatBytes } from "@/lib/image-utils";
import { mediaDownloadFileName } from "@/lib/media-file";
import { imagePreviewUrl, originalImageDownloadUrl, originalImageExtension, originalMediaDownloadUrl } from "@/lib/media-image-url";
import { uploadImage } from "@/services/image-storage";
import { uploadMediaFile } from "@/services/file-storage";
import { isPermanentServerMedia, serverMediaUrl } from "@/services/server-media-storage";
import { listAllLibraryAssets } from "@/services/api/library-assets";
import { cn } from "@/lib/utils";
import { useAssetStore, type Asset, type AssetKind, type AudioAsset, type ImageAsset, type VideoAsset } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";
import { exportAssets, readAssetPackage } from "./asset-transfer";

type AssetFormValues = {
    kind: AssetKind;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    content?: string;
};

type MediaDraft = ImageAsset["data"] | VideoAsset["data"] | AudioAsset["data"] | null;

import { AssetCard, AssetPreviewModal } from "./asset-elements";
import { useAssetPage } from "./use-asset-page";

export default function AssetsPage() {
    const t = useTranslations("media.assetsPage");
    const { message } = App.useApp();
    const router = useRouter();
    const copyText = useCopyText();
    const [form] = Form.useForm<AssetFormValues>();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const assetInputRef = useRef<HTMLInputElement>(null);
    const userId = useUserStore((state) => state.user?.id || "");
    const addAsset = useAssetStore((state) => state.addAsset);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [isAssetOpen, setIsAssetOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<Asset | null>(null);
    const [isCoverDragActive, setIsCoverDragActive] = useState(false);
    const [isImageDragActive, setIsImageDragActive] = useState(false);
    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [mediaDraft, setMediaDraft] = useState<MediaDraft>(null);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [importing, setImporting] = useState(false);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const title = Form.useWatch("title", form) || "";
    const tags = Form.useWatch("tags", form) || [];
    const content = Form.useWatch("content", form) || "";
    const { assets, total, loading, error, reload } = useAssetPage({ userId, page, pageSize, kind: kindFilter, keyword });
    const ready = Boolean(userId);

    const openCreate = () => {
        setEditingAsset(null);
        setMediaDraft(null);
        setFormKind("text");
        form.setFieldsValue({ kind: "text", title: "", coverUrl: "", tags: [], source: t("manualSource"), note: "", content: "" });
        setIsAssetOpen(true);
    };

    const openEdit = (asset: Asset) => {
        setEditingAsset(asset);
        setFormKind(asset.kind);
        setMediaDraft(asset.kind === "text" ? null : asset.data);
        form.setFieldsValue({
            kind: asset.kind,
            title: asset.title,
            coverUrl: asset.coverUrl,
            tags: asset.tags || [],
            source: asset.source,
            note: asset.note,
            content: asset.kind === "text" ? asset.data.content : "",
        });
        setIsAssetOpen(true);
    };

    const saveAsset = async () => {
        setSaving(true);
        try {
            const values = await form.validateFields();
            let nextCover = values.coverUrl?.trim() || (values.kind === "image" && mediaDraft && "dataUrl" in mediaDraft ? mediaDraft.dataUrl : "");
            if (nextCover && !isPermanentServerMedia(undefined, nextCover)) nextCover = (await uploadImage(nextCover)).url;
            else nextCover = serverMediaUrl(undefined, nextCover);
            const base = {
                title: values.title.trim(),
                coverUrl: nextCover,
                tags: values.tags || [],
                source: values.source?.trim(),
                note: values.note?.trim(),
                metadata: editingAsset?.metadata || { source: "manual" },
            };

            if (values.kind === "text") {
                const asset = { ...base, kind: "text" as const, data: { content: (values.content || "").trim() } };
                await (editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset));
            } else {
                if (!mediaDraft) throw new Error(t("selectKindFile", { kind: t(`kinds.${values.kind}`) }));
                const asset = { ...base, kind: values.kind, data: mediaDraft } as Parameters<typeof addAsset>[0];
                await (editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset));
            }

            message.success(editingAsset ? t("updated") : t("saved"));
            setIsAssetOpen(false);
            reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    const readCoverFile = async (file?: File) => {
        if (!file) return;
        const image = await uploadImage(file);
        form.setFieldValue("coverUrl", image.url);
    };

    const readMediaFile = async (file?: File) => {
        if (!file || formKind === "text" || !file.type.startsWith(`${formKind}/`)) return message.warning(t("selectFormatFile", { kind: t(`kinds.${formKind}`) }));
        const media = formKind === "image" ? await uploadImage(file) : await uploadMediaFile(file, formKind);
        const draft: MediaDraft =
            formKind === "image"
                ? { dataUrl: media.url, storageKey: media.storageKey, serverUrl: media.url, width: media.width || 0, height: media.height || 0, bytes: media.bytes, mimeType: media.mimeType }
                : formKind === "video"
                  ? { url: media.url, storageKey: media.storageKey, serverUrl: media.url, width: media.width || 0, height: media.height || 0, bytes: media.bytes, mimeType: media.mimeType }
                  : { url: media.url, storageKey: media.storageKey, serverUrl: media.url, durationMs: "durationMs" in media ? media.durationMs : undefined, bytes: media.bytes, mimeType: media.mimeType };
        setMediaDraft(draft);
        if (formKind === "image" && !form.getFieldValue("coverUrl") && "dataUrl" in draft) form.setFieldValue("coverUrl", draft.dataUrl);
        if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
    };

    const handleCoverDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
        if (!preventFileDragEvent(event)) return;
        setIsCoverDragActive(true);
    };

    const handleCoverDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
        if (!preventFileDragEvent(event) || !leftDropTarget(event)) return;
        setIsCoverDragActive(false);
    };

    const handleCoverDrop = (event: ReactDragEvent<HTMLDivElement>) => {
        if (!preventFileDragEvent(event)) return;
        setIsCoverDragActive(false);
        const [file] = droppedFiles(event, (item) => item.type.startsWith("image/"));
        if (file) void readCoverFile(file);
    };

    const handleImageDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
        if (!preventFileDragEvent(event)) return;
        setIsImageDragActive(true);
    };

    const handleImageDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
        if (!preventFileDragEvent(event) || !leftDropTarget(event)) return;
        setIsImageDragActive(false);
    };

    const handleImageDrop = (event: ReactDragEvent<HTMLDivElement>) => {
        if (!preventFileDragEvent(event)) return;
        setIsImageDragActive(false);
        const [file] = droppedFiles(event, (item) => formKind !== "text" && item.type.startsWith(`${formKind}/`));
        if (file) void readMediaFile(file);
    };

    const copyAssetText = async (asset: Asset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, t("textCopied"));
    };

    const downloadImage = (asset: Asset) => {
        if (asset.kind === "text") return;
        const url = asset.kind === "image" ? originalImageDownloadUrl(asset.data.dataUrl) : originalMediaDownloadUrl(asset.data.url);
        const mediaUrl = asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
        const media = asset.data;
        saveAs(url, mediaDownloadFileName(asset.id, media.mimeType, media.storageKey || media.serverUrl || mediaUrl));
    };

    const exportAllAssets = async () => {
        try {
            const exportable = await listAllLibraryAssets();
            if (!exportable.length) {
                message.warning(t("nothingToExport"));
                return;
            }
            await exportAssets(exportable);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("exportFailed"));
        }
    };

    const importAssetZip = async (file?: File) => {
        if (!file) return;
        setImporting(true);
        try {
            const importedAssets = await readAssetPackage(file);
            await Promise.all(
                importedAssets.map((asset) => {
                    const payload = { ...asset } as Record<string, unknown>;
                    delete payload.id;
                    delete payload.createdAt;
                    delete payload.updatedAt;
                    return addAsset(payload as Parameters<typeof addAsset>[0]);
                }),
            );
            message.success(t("importSuccess", { count: importedAssets.length }));
            reload();
        } catch {
            message.error(t("importFailed"));
        } finally {
            setImporting(false);
            if (assetInputRef.current) assetInputRef.current.value = "";
        }
    };

    const confirmDelete = async () => {
        if (!deletingAsset) return;
        setDeleting(true);
        try {
            await removeAsset(deletingAsset.id);
            message.success(t("deleted"));
            setDeletingAsset(null);
            if (assets.length === 1 && page > 1) setPage((value) => Math.max(1, value - 1));
            else reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("deleteFailed"));
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="h-full min-h-0 overflow-hidden bg-background text-foreground">
            <main className="h-full min-h-0 overflow-y-auto px-3 py-3 sm:px-6 sm:py-6">
                <div className="mx-auto max-w-[1560px]">
                    <header className="border-b border-border pb-3 sm:pb-4">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <h1 className="text-lg font-semibold sm:text-xl">{t("title")}</h1>
                                <p className="mt-0.5 text-xs text-muted-foreground">{total ? t("count", { count: total }) : t("description")}</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                <Tooltip title={t("export")}>
                                    <Button type="text" shape="circle" icon={<FileDown className="size-4" />} aria-label={t("export")} onClick={() => void exportAllAssets()} />
                                </Tooltip>
                                <Tooltip title={importing ? t("importing") : t("import")}>
                                    <Button type="text" shape="circle" icon={<FileUp className="size-4" />} aria-label={t("import")} disabled={!ready || importing} loading={importing} onClick={() => assetInputRef.current?.click()} />
                                </Tooltip>
                                <Tooltip title={t("add")}>
                                    <Button type="primary" shape="circle" icon={<Plus className="size-4" />} aria-label={t("add")} disabled={!ready} onClick={openCreate} />
                                </Tooltip>
                            </div>
                        </div>

                        <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(260px,520px)_auto] lg:items-center lg:justify-between">
                            <Input.Search
                                className="w-full"
                                size="middle"
                                allowClear
                                prefix={<Search className="size-4 text-stone-400" />}
                                value={keyword}
                                placeholder={t("searchPlaceholder")}
                                onChange={(event) => {
                                    setPage(1);
                                    setKeyword(event.target.value);
                                }}
                                onSearch={(value) => {
                                    setPage(1);
                                    setKeyword(value);
                                }}
                            />
                            <div className="min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                <Segmented
                                    block
                                    value={kindFilter}
                                    options={["all", "text", "image", "video", "audio"].map((value) => ({ label: t(`kinds.${value}`), value }))}
                                    onChange={(value) => {
                                        setPage(1);
                                        setKindFilter(value as AssetKind | "all");
                                    }}
                                />
                            </div>
                        </div>
                    </header>

                    <div className="flex flex-col gap-3 pt-3 sm:gap-5 sm:pt-5">
                        <div className={cn("grid grid-cols-1 gap-3 transition-opacity sm:grid-cols-[repeat(auto-fill,minmax(240px,280px))] sm:justify-start", loading && assets.length && "opacity-60")} aria-busy={loading}>
                            {assets.map((asset) => (
                                <AssetCard
                                    key={asset.id}
                                    asset={asset}
                                    onOpen={() => setPreviewAsset(asset)}
                                    onEdit={() => openEdit(asset)}
                                    onCopy={copyAssetText}
                                    onDownload={downloadImage}
                                    onDelete={() => setDeletingAsset(asset)}
                                    onPublish={asset.kind === "text" ? undefined : () => router.push(`/works?sourceType=media&sourceId=${encodeURIComponent(asset.id)}`)}
                                />
                            ))}
                        </div>

                        {loading && !assets.length ? (
                            <section className="flex min-h-32 items-center justify-center sm:min-h-56">
                                <Spin description={t("loading")} />
                            </section>
                        ) : error ? (
                            <section className="flex min-h-32 flex-col items-center justify-center gap-3 border-y border-border px-4 text-center sm:min-h-56">
                                <p className="text-sm text-stone-500 dark:text-stone-400">{error}</p>
                                <Button size="small" onClick={reload}>
                                    {t("reload")}
                                </Button>
                            </section>
                        ) : !assets.length ? (
                            <CompactEmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
                        ) : null}

                        <div className="flex justify-center overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                            <Pagination
                                current={page}
                                pageSize={pageSize}
                                total={total}
                                showSizeChanger
                                pageSizeOptions={[10, 20, 50, 100]}
                                onChange={(nextPage, nextPageSize) => {
                                    setPage(nextPage);
                                    setPageSize(nextPageSize);
                                }}
                            />
                        </div>
                    </div>
                </div>
            </main>

            <Modal title={editingAsset ? t("edit") : t("add")} open={isAssetOpen} width={980} onCancel={() => setIsAssetOpen(false)} onOk={() => void saveAsset()} confirmLoading={saving} okText={t("save")} cancelText={t("cancel")} destroyOnHidden>
                <div className="grid gap-3 pt-1 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "text", tags: [] }}>
                        <Form.Item name="kind" label={t("type")}>
                            <Select
                                options={[
                                    { label: t("kinds.text"), value: "text" },
                                    { label: t("kinds.image"), value: "image" },
                                    { label: t("kinds.video"), value: "video" },
                                    { label: t("kinds.audio"), value: "audio" },
                                ]}
                                onChange={(value) => {
                                    setFormKind(value);
                                    setMediaDraft(null);
                                }}
                            />
                        </Form.Item>
                        <Form.Item name="title" label={t("assetTitle")} rules={[{ required: true, message: t("titleRequired") }]}>
                            <Input size="large" placeholder={t("titlePlaceholder")} />
                        </Form.Item>
                        <Form.Item label={t("coverUrl")}>
                            <div
                                className={cn("rounded-md transition", isCoverDragActive && "ring-2 ring-cyan-300 ring-offset-2 ring-offset-white dark:ring-cyan-500 dark:ring-offset-stone-950")}
                                onDragEnter={handleCoverDragOver}
                                onDragOver={handleCoverDragOver}
                                onDragLeave={handleCoverDragLeave}
                                onDrop={handleCoverDrop}
                            >
                                <Space.Compact className="w-full">
                                    <Form.Item name="coverUrl" noStyle>
                                        <Input placeholder={t("coverPlaceholder")} />
                                    </Form.Item>
                                    <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>
                                        {t("upload")}
                                    </Button>
                                </Space.Compact>
                            </div>
                        </Form.Item>
                        <Form.Item name="tags" label={t("tags")}>
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder={t("tagsPlaceholder")} />
                        </Form.Item>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="source" label={t("source")}>
                                <Input placeholder={t("sourcePlaceholder")} />
                            </Form.Item>
                            <Form.Item name="note" label={t("note")}>
                                <Input placeholder={t("optional")} />
                            </Form.Item>
                        </div>
                        {formKind === "text" ? (
                            <Form.Item name="content" label={t("textContent")} rules={[{ required: true, message: t("textRequired") }]}>
                                <Input.TextArea rows={8} placeholder={t("textPlaceholder")} />
                            </Form.Item>
                        ) : (
                            <Form.Item label={t("kindContent", { kind: t(`kinds.${formKind}`) })} required>
                                <div
                                    className={cn(
                                        "rounded-lg border border-dashed border-stone-300 p-4 transition dark:border-stone-700",
                                        isImageDragActive && "border-cyan-400 bg-cyan-50/60 ring-1 ring-cyan-200 dark:border-cyan-400 dark:bg-cyan-500/10 dark:ring-cyan-400/25",
                                    )}
                                    onDragEnter={handleImageDragOver}
                                    onDragOver={handleImageDragOver}
                                    onDragLeave={handleImageDragLeave}
                                    onDrop={handleImageDrop}
                                >
                                    <Button icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>
                                        {t("selectKindFile", { kind: t(`kinds.${formKind}`) })}
                                    </Button>
                                    {mediaDraft ? (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {"width" in mediaDraft ? `${mediaDraft.width}x${mediaDraft.height} · ` : ""}
                                            {formatBytes(mediaDraft.bytes)}
                                        </Typography.Text>
                                    ) : (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {t("noFileSelected")}
                                        </Typography.Text>
                                    )}
                                </div>
                            </Form.Item>
                        )}
                    </Form>
                    <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-950">
                        <Typography.Text strong>{t("preview")}</Typography.Text>
                        <div className="mt-3 overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
                            {coverUrl || (mediaDraft && "dataUrl" in mediaDraft ? mediaDraft.dataUrl : "") ? (
                                <img src={imagePreviewUrl(coverUrl || (mediaDraft && "dataUrl" in mediaDraft ? mediaDraft.dataUrl : ""), 960)} alt="" className="aspect-[4/3] w-full object-cover" />
                            ) : formKind === "video" && mediaDraft && "url" in mediaDraft ? (
                                <div className="flex aspect-[4/3] items-center justify-center bg-stone-900 text-white">
                                    <Film className="size-10" />
                                </div>
                            ) : formKind === "audio" && mediaDraft && "url" in mediaDraft ? (
                                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 text-stone-500 dark:bg-stone-900">
                                    <FileAudio className="size-10" />
                                </div>
                            ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm text-stone-500 dark:bg-stone-900">{content || t("noCover")}</div>
                            )}
                            <div className="p-4">
                                <Typography.Text strong ellipsis className="block">
                                    {title || t("untitled")}
                                </Typography.Text>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {tags.length ? (
                                        tags.map((tag) => (
                                            <Tag key={tag} className="m-0">
                                                {tag}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag className="m-0">{t("untagged")}</Tag>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readCoverFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
                <input
                    ref={imageInputRef}
                    type="file"
                    accept={formKind === "image" ? "image/*" : formKind === "video" ? "video/*" : "audio/*"}
                    className="hidden"
                    onChange={(event) => {
                        void readMediaFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
            </Modal>

            <AssetPreviewModal asset={previewAsset} onClose={() => setPreviewAsset(null)} onCopy={copyAssetText} onDownload={downloadImage} />

            <input ref={assetInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importAssetZip(event.target.files?.[0])} />

            <Modal title={t("deleteTitle")} open={Boolean(deletingAsset)} onCancel={() => setDeletingAsset(null)} onOk={() => void confirmDelete()} confirmLoading={deleting} okText={t("delete")} okButtonProps={{ danger: true }} cancelText={t("cancel")}>
                {t("deleteDescription", { title: deletingAsset?.title || "" })}
            </Modal>
        </div>
    );
}
