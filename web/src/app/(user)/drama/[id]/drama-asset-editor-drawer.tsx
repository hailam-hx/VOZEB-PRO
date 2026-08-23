"use client";

import { App, Button, Drawer, Image, Input, InputNumber, Modal, Popconfirm, Popover, Space, Tooltip } from "antd";
import { Check, FolderInput, ImagePlus, Sparkles, Trash2, Upload } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { compileDramaAssetReferencePrompt } from "@/lib/drama-prompt-compiler";
import type { DramaAssetProfile, DramaAssetReference, DramaCharacter, DramaNamedAsset, DramaProject, DramaVoiceProfile } from "@/lib/drama-project-contract";
import { imagePreviewUrl } from "@/lib/media-image-url";
import { createImageGenerationTask, waitForImageGenerationTask } from "@/services/api/image";
import { uploadImage } from "@/services/image-storage";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useDramaStore } from "../stores/use-drama-store";
import type { DramaAssetKind } from "./drama-asset-definitions";
import { dramaAssetReferences, imageResultsToReferences } from "./drama-asset-reference-utils";
import { dramaGenerationSize } from "./drama-shot-generation-utils";

type AssetDraft = {
    name: string;
    description: string;
    payoff: string;
    profile: DramaAssetProfile;
    voiceProfile: DramaVoiceProfile;
};

const emptyProfile = (): DramaAssetProfile => ({ visualIdentity: "", styling: "", colorPalette: "", consistencyRules: "" });
const emptyVoiceProfile = (): DramaVoiceProfile => ({ voice: "", speed: 1, instructions: "" });
const emptyDraft = (): AssetDraft => ({ name: "", description: "", payoff: "", profile: emptyProfile(), voiceProfile: emptyVoiceProfile() });

export function DramaAssetEditorDrawer({ project, kind, assetId, open, onClose }: { project: DramaProject; kind: DramaAssetKind; assetId?: string; open: boolean; onClose: () => void }) {
    const t = useTranslations("drama.assets");
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const addCharacter = useDramaStore((state) => state.addCharacter);
    const addScene = useDramaStore((state) => state.addScene);
    const addProp = useDramaStore((state) => state.addProp);
    const addClue = useDramaStore((state) => state.addClue);
    const updateAsset = useDramaStore((state) => state.updateAsset);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const editorKeyRef = useRef("");
    const [draft, setDraft] = useState<AssetDraft>(emptyDraft);
    const [uploading, setUploading] = useState(false);
    const [generating, setGenerating] = useState(false);
    const kindTitle = t(`kinds.${kind}.title`);
    const kindLabel = t(`kinds.${kind}.label`);
    const asset = project[kind].find((item) => item.id === assetId);
    const character = kind === "characters" ? (asset as DramaCharacter | undefined) : undefined;
    const references = asset ? dramaAssetReferences(asset) : [];
    const primary = references.find((reference) => reference.id === asset?.primaryReferenceId) || references[0];

    useEffect(() => {
        if (!open) {
            editorKeyRef.current = "";
            return;
        }
        const editorKey = `${kind}:${assetId || "new"}`;
        if (editorKeyRef.current === editorKey) return;
        editorKeyRef.current = editorKey;
        if (!asset) {
            setDraft(emptyDraft());
            return;
        }
        setDraft({
            name: asset.name,
            description: asset.description,
            payoff: kind === "clues" && "payoff" in asset && typeof asset.payoff === "string" ? asset.payoff : "",
            profile: asset.profile || emptyProfile(),
            voiceProfile: character?.voiceProfile || emptyVoiceProfile(),
        });
    }, [asset, character?.voiceProfile, kind, open]);

    const save = () => {
        const name = draft.name.trim();
        if (!name) return message.warning(t("nameRequired", { kind: kindLabel }));
        const base = { name, description: draft.description.trim(), profile: draft.profile };
        if (asset) {
            updateAsset(project.id, kind, asset.id, {
                ...base,
                ...(kind === "characters" ? { voiceProfile: draft.voiceProfile } : {}),
                ...(kind === "clues" ? { payoff: draft.payoff.trim() } : {}),
            });
            message.success(t("settingsSaved", { kind: kindTitle }));
        } else if (kind === "characters") {
            addCharacter(project.id, { ...base, voiceProfile: draft.voiceProfile, references: [] });
            message.success(t("created", { kind: kindTitle }));
        } else if (kind === "scenes") {
            addScene(project.id, { ...base, references: [] });
            message.success(t("created", { kind: kindTitle }));
        } else if (kind === "props") {
            addProp(project.id, { ...base, references: [] });
            message.success(t("created", { kind: kindTitle }));
        } else {
            addClue(project.id, { ...base, payoff: draft.payoff.trim(), references: [] });
            message.success(t("created", { kind: kindTitle }));
        }
        onClose();
    };

    const setPrimaryReference = (reference: DramaAssetReference) => {
        if (!asset) return;
        updateAsset(project.id, kind, asset.id, {
            primaryReferenceId: reference.id,
            referenceImageUrl: reference.url,
            referenceStorageKey: reference.storageKey,
        });
    };

    const appendReferences = (item: DramaNamedAsset, added: DramaAssetReference[]) => {
        const nextPrimary = added[0];
        if (!nextPrimary) return;
        updateAsset(project.id, kind, item.id, {
            references: [...dramaAssetReferences(item), ...added],
            primaryReferenceId: nextPrimary.id,
            referenceImageUrl: nextPrimary.url,
            referenceStorageKey: nextPrimary.storageKey,
        });
    };

    const appendSourceReference = (source: NonNullable<DramaProject["sourceAssets"]>[number]) => {
        if (!asset) return;
        const url = source.serverUrl || source.remoteUrl;
        if (!url) return;
        if (references.some((reference) => reference.url === url || (source.storageKey && reference.storageKey === source.storageKey))) {
            message.info(t("sourceAlreadyAdded"));
            return;
        }
        appendReferences(asset, [
            {
                id: `reference-${nanoid()}`,
                url,
                storageKey: source.storageKey,
                source: "library",
                label: source.title || t("projectSourceImage"),
                width: source.width,
                height: source.height,
                createdAt: new Date().toISOString(),
            },
        ]);
        message.success(t("sourceAdded"));
    };

    const removeReference = (referenceId: string) => {
        if (!asset) return;
        const nextReferences = references.filter((reference) => reference.id !== referenceId);
        const nextPrimary = asset.primaryReferenceId === referenceId ? nextReferences[0] : nextReferences.find((reference) => reference.id === asset.primaryReferenceId);
        updateAsset(project.id, kind, asset.id, {
            references: nextReferences,
            primaryReferenceId: nextPrimary?.id,
            referenceImageUrl: nextPrimary?.url,
            referenceStorageKey: nextPrimary?.storageKey,
        });
    };

    const uploadReference = async (file?: File) => {
        if (!file || !asset) return;
        setUploading(true);
        try {
            const stored = await uploadImage(file);
            appendReferences(asset, [
                {
                    id: `reference-${nanoid()}`,
                    url: stored.serverUrl || stored.url,
                    storageKey: stored.storageKey,
                    source: "upload",
                    label: file.name,
                    width: stored.width,
                    height: stored.height,
                    createdAt: new Date().toISOString(),
                },
            ]);
            message.success(t("referenceUploaded"));
        } catch {
            message.error(t("referenceUploadFailed"));
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const generateReference = async () => {
        if (!asset || kind === "clues") return;
        setGenerating(true);
        try {
            const prompt = compileDramaAssetReferencePrompt(project, asset, kind === "characters" ? "角色" : kind === "scenes" ? "场景" : "道具");
            const imageConfig = { ...config, model: config.imageModel || config.model, imageModel: config.imageModel || config.model, size: dramaGenerationSize(project, prompt), count: "1" };
            const task = await createImageGenerationTask(imageConfig, prompt, [], undefined, {
                logSource: "drama",
                logTitle: t("referenceLogTitle", { project: project.title, asset: asset.name }),
                conversationId: project.creativeConversationId,
                surface: "drama",
                projectId: project.id,
                clientRequestId: `drama-reference:${project.id}:${asset.id}:${nanoid()}`,
            });
            const nextReferences = imageResultsToReferences(await waitForImageGenerationTask(imageConfig, task), (index, total) => t("generatedCandidate", { index, total }));
            if (!nextReferences.length) throw new Error("missing-reference-url");
            appendReferences(asset, nextReferences);
            message.success(nextReferences.length > 1 ? t("referencesGenerated", { count: nextReferences.length }) : t("referenceGenerated"));
        } catch {
            message.error(t("referenceGenerationFailed"));
        } finally {
            setGenerating(false);
        }
    };

    const actions = (
        <div className="flex items-center justify-end gap-2">
            <Button onClick={onClose}>{t("cancel")}</Button>
            <Button type="primary" onClick={save}>
                {asset ? t("saveSettings") : t("createKind", { kind: kindTitle })}
            </Button>
        </div>
    );
    const editorContent = (
        <div className={`grid p-4 ${asset ? "gap-6 sm:p-5" : "gap-4"}`} data-drama-asset-editor-content>
            <section className={`grid min-w-0 gap-3 ${asset ? "sm:grid-cols-[136px_minmax(0,1fr)]" : ""}`}>
                {asset ? (
                    <div className="grid aspect-[4/5] w-full place-items-center overflow-hidden rounded-lg border border-border bg-muted/50">
                        {primary?.url ? (
                            <Image
                                src={imagePreviewUrl(primary.url, 384)}
                                alt={t("referenceAlt", { name: draft.name || kindTitle })}
                                rootClassName="!block !size-full"
                                className="!size-full !object-cover"
                                preview={{ src: imagePreviewUrl(primary.url, 1920) }}
                            />
                        ) : (
                            <div className="grid gap-2 text-center text-muted-foreground">
                                <ImagePlus className="mx-auto size-6" />
                                <span className="text-xs">{t("missingReference")}</span>
                            </div>
                        )}
                    </div>
                ) : null}
                <div className="grid min-w-0 content-start gap-3">
                    <label className="grid gap-1.5 text-sm">
                        <span className="font-medium">{t("kindName", { kind: kindLabel })}</span>
                        <Input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder={t(`kinds.${kind}.placeholder`)} />
                    </label>
                    <label className="grid gap-1.5 text-sm">
                        <span className="font-medium">{t("storyRole")}</span>
                        <Input.TextArea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} autoSize={{ minRows: asset ? 3 : 2, maxRows: 5 }} placeholder={t("storyRolePlaceholder")} />
                    </label>
                    {kind === "clues" ? (
                        <label className="grid gap-1.5 text-sm">
                            <span className="font-medium">{t("cluePayoff")}</span>
                            <Input value={draft.payoff} onChange={(event) => setDraft((current) => ({ ...current, payoff: event.target.value }))} placeholder={t("cluePayoffPlaceholder")} />
                        </label>
                    ) : null}
                </div>
            </section>

            <section className="border-t border-border pt-3.5">
                <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <h3 className="text-sm font-semibold">{t("visualProfile")}</h3>
                    <p className="text-xs text-muted-foreground">{t("visualProfileDescription")}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    {(["visualIdentity", "styling", "colorPalette", "consistencyRules"] as const).map((key) => (
                        <label key={key} className="grid gap-1.5 text-sm">
                            <span className="font-medium">{t(`kinds.${kind}.profile.${key}`)}</span>
                            <Input.TextArea value={draft.profile[key]} onChange={(event) => setDraft((current) => ({ ...current, profile: { ...current.profile, [key]: event.target.value } }))} autoSize={{ minRows: asset ? 2 : 1, maxRows: 4 }} />
                        </label>
                    ))}
                </div>
            </section>

            {kind === "characters" ? (
                <section className="border-t border-border pt-3.5">
                    <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <h3 className="text-sm font-semibold">{t("characterVoice")}</h3>
                        <p className="text-xs text-muted-foreground">{t("characterVoiceDescription")}</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[minmax(140px,0.8fr)_110px_minmax(220px,1.2fr)]">
                        <Input value={draft.voiceProfile.voice} onChange={(event) => setDraft((current) => ({ ...current, voiceProfile: { ...current.voiceProfile, voice: event.target.value } }))} placeholder={t("voiceId")} />
                        <Space.Compact className="w-full">
                            <InputNumber
                                className="!min-w-0 !flex-1"
                                min={0.25}
                                max={4}
                                step={0.05}
                                value={draft.voiceProfile.speed}
                                onChange={(value) => setDraft((current) => ({ ...current, voiceProfile: { ...current.voiceProfile, speed: Number(value) || 1 } }))}
                            />
                            <span className="inline-flex h-8 shrink-0 items-center rounded-r-md border border-l-0 border-border bg-muted/45 px-2 text-xs text-muted-foreground">{t("speed")}</span>
                        </Space.Compact>
                        <Input value={draft.voiceProfile.instructions} onChange={(event) => setDraft((current) => ({ ...current, voiceProfile: { ...current.voiceProfile, instructions: event.target.value } }))} placeholder={t("voiceInstructions")} />
                    </div>
                </section>
            ) : null}

            {asset ? (
                <section className="border-t border-border pt-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h3 className="text-sm font-semibold">{t("referenceCandidates")}</h3>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("referenceCandidatesDescription")}</p>
                        </div>
                        {asset ? (
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                <DramaSourceImagePicker project={project} onSelect={appendSourceReference} />
                                <Button icon={<Upload className="size-3.5" />} loading={uploading} onClick={() => fileInputRef.current?.click()}>
                                    {t("uploadCandidate")}
                                </Button>
                                {kind !== "clues" ? (
                                    <Button icon={<Sparkles className="size-3.5" />} loading={generating} onClick={() => void generateReference()}>
                                        {t("generateCandidate")}
                                    </Button>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                    {!references.length ? <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/25 px-4 py-4 text-center text-sm text-muted-foreground">{t("noReferences")}</div> : null}
                    {references.length ? (
                        <Image.PreviewGroup>
                            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                                {references.map((reference) => {
                                    const isPrimary = reference.id === primary?.id;
                                    return (
                                        <article key={reference.id} className={`min-w-0 overflow-hidden rounded-xl border bg-background ${isPrimary ? "border-foreground ring-2 ring-foreground/10" : "border-border"}`}>
                                            <Image src={imagePreviewUrl(reference.url, 384)} alt={reference.label} rootClassName="!block !aspect-[4/5] !w-full" className="!size-full !object-cover" preview={{ src: imagePreviewUrl(reference.url, 1920) }} />
                                            <div className="flex min-h-10 items-stretch border-t border-border">
                                                <button
                                                    type="button"
                                                    className={`flex min-w-0 flex-1 items-center justify-center gap-1 px-2 text-xs font-medium transition ${isPrimary ? "bg-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                                                    style={isPrimary ? { color: "var(--background)" } : undefined}
                                                    onClick={() => setPrimaryReference(reference)}
                                                    aria-pressed={isPrimary}
                                                >
                                                    {isPrimary ? <Check className="size-3.5" style={{ color: "var(--background)" }} /> : null}
                                                    <span className="truncate" style={isPrimary ? { color: "var(--background)" } : undefined}>
                                                        {isPrimary ? t("currentReference") : t("setAsReference")}
                                                    </span>
                                                </button>
                                                <Popconfirm
                                                    title={t("deleteReferenceConfirm")}
                                                    description={isPrimary ? t("deletePrimaryDescription") : undefined}
                                                    okText={t("delete")}
                                                    cancelText={t("cancel")}
                                                    onConfirm={() => removeReference(reference.id)}
                                                >
                                                    <Tooltip title={t("deleteReference")}>
                                                        <button
                                                            type="button"
                                                            className="grid w-10 shrink-0 place-items-center border-l border-border text-muted-foreground transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30 dark:hover:text-rose-300"
                                                            aria-label={t("deleteReferenceNamed", { name: reference.label })}
                                                        >
                                                            <Trash2 className="size-3.5" />
                                                        </button>
                                                    </Tooltip>
                                                </Popconfirm>
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        </Image.PreviewGroup>
                    ) : null}
                </section>
            ) : null}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                    void uploadReference(event.target.files?.[0]);
                    event.target.value = "";
                }}
            />
        </div>
    );

    if (!asset) {
        return (
            <Modal
                title={t("newKind", { kind: kindTitle })}
                open={open}
                width={640}
                centered
                destroyOnHidden
                mask={{ closable: false }}
                onCancel={onClose}
                footer={actions}
                styles={{ container: { maxWidth: "calc(100vw - 24px)" }, body: { maxHeight: "calc(100vh - 150px)", overflowY: "auto", padding: 0 } }}
            >
                {editorContent}
            </Modal>
        );
    }

    return (
        <Drawer title={t("editKind", { kind: kindTitle })} placement="right" size={620} open={open} destroyOnHidden mask={{ closable: false }} onClose={onClose} styles={{ wrapper: { maxWidth: "100vw" }, body: { padding: 0 } }} footer={actions}>
            {editorContent}
        </Drawer>
    );
}

function DramaSourceImagePicker({ project, onSelect }: { project: DramaProject; onSelect: (source: NonNullable<DramaProject["sourceAssets"]>[number]) => void }) {
    const t = useTranslations("drama.assets");
    const [open, setOpen] = useState(false);
    const sources = project.sourceAssets?.filter((source) => source.type === "image" && (source.serverUrl || source.remoteUrl)) || [];

    if (!sources.length) return null;
    return (
        <Popover
            trigger="click"
            open={open}
            onOpenChange={setOpen}
            placement="bottomRight"
            content={
                <div className="w-64 max-w-[calc(100vw-32px)]">
                    <div className="mb-2 text-xs text-muted-foreground">{t("sourcePickerDescription")}</div>
                    <div className="hide-scrollbar grid max-h-64 grid-cols-3 gap-2 overflow-y-auto">
                        {sources.map((source) => {
                            const url = source.serverUrl || source.remoteUrl || "";
                            return (
                                <button
                                    key={source.id}
                                    type="button"
                                    className="group min-w-0 overflow-hidden rounded-md border border-border text-left transition hover:border-foreground/40"
                                    onClick={() => {
                                        onSelect(source);
                                        setOpen(false);
                                    }}
                                    title={source.title || t("projectSourceImage")}
                                >
                                    <Image src={imagePreviewUrl(url, 192)} alt={source.title || t("projectSourceImage")} rootClassName="!block !aspect-square !w-full" className="!size-full !object-cover" preview={false} />
                                    <span className="block truncate px-1.5 py-1 text-[10px]">{source.title || t("untitledImage")}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            }
        >
            <Button icon={<FolderInput className="size-3.5" />} aria-label={t("selectFromSources")}>
                {t("selectFromSources")}
            </Button>
        </Popover>
    );
}
