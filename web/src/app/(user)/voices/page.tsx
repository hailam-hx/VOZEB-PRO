"use client";

import { App, Button, Card, Checkbox, Empty, Input, Modal, Pagination, Popconfirm, Select, Spin, Tag, Upload } from "antd";
import type { UploadFile } from "antd";
import { AudioLines, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { waitForAudioGenerationTask } from "@/services/api/audio";
import { createVoicePreview, createVoiceProfile, deleteVoiceProfile, fetchVoicePreview, fetchVoiceProfiles, renameVoiceProfile, type PublicVoiceProfile } from "@/services/api/voice-profiles";
import { useEffectiveConfig } from "@/stores/use-config-store";

const pageSize = 12;

export default function VoicesPage() {
    const { message } = App.useApp();
    const t = useTranslations("voices");
    const locale = previewLocale(useLocale());
    const effectiveConfig = useEffectiveConfig();
    const voiceCloneModel = effectiveConfig.voiceCloneModel;
    const [profiles, setProfiles] = useState<PublicVoiceProfile[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [status, setStatus] = useState<PublicVoiceProfile["status"] | undefined>();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [cloneOpen, setCloneOpen] = useState(false);
    const [name, setName] = useState("");
    const [file, setFile] = useState<File>();
    const [consent, setConsent] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [clientRequestId, setClientRequestId] = useState("");
    const [sourceAssetToken, setSourceAssetToken] = useState("");
    const [preview, setPreview] = useState<{ profile: PublicVoiceProfile; estimate?: number | null }>();
    const [audioUrl, setAudioUrl] = useState("");
    const [previewGenerating, setPreviewGenerating] = useState(false);
    const refreshTimer = useRef<number | undefined>(undefined);

    const load = useCallback(async () => {
        if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
        setLoading(true);
        setError("");
        try {
            const result = await fetchVoiceProfiles({ page, pageSize, status });
            setProfiles(result.items);
            setTotal(result.total);
            if (result.retryAfterSeconds) refreshTimer.current = window.setTimeout(() => void load(), result.retryAfterSeconds * 1_000);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [page, status, t]);

    useEffect(() => {
        void load();
        return () => {
            if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
        };
    }, [load]);

    async function submitClone() {
        if (!name.trim() || !file || !consent) return;
        setSubmitting(true);
        try {
            const token = sourceAssetToken || (await uploadAudio(file, t("clone.uploadFailed"), t("clone.readFailed"))).token;
            setSourceAssetToken(token);
            await createVoiceProfile({ name: name.trim(), sourceAssetToken: token, clientRequestId, consentConfirmed: true });
            setCloneOpen(false);
            setName("");
            setFile(undefined);
            setConsent(false);
            setClientRequestId("");
            setSourceAssetToken("");
            if (page === 1) await load();
            else setPage(1);
            message.success(t("clone.created"));
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : t("clone.createFailed"));
        } finally {
            setSubmitting(false);
        }
    }

    async function openPreview(profile: PublicVoiceProfile) {
        try {
            const result = await fetchVoicePreview(profile.id, locale);
            if (result.cached && result.url) {
                setAudioUrl(result.url);
                return;
            }
            setPreview({ profile, estimate: result.estimatedPoints });
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : t("preview.loadFailed"));
        }
    }

    async function confirmPreview() {
        if (!preview) return;
        setPreviewGenerating(true);
        try {
            const result = await createVoicePreview(preview.profile.id, locale);
            if (result.url) {
                setPreview(undefined);
                setAudioUrl(result.url);
                return;
            }
            if (!result.task) throw new Error(t("preview.createFailed"));
            message.success(t("preview.generating"));
            const audio = await waitForAudioGenerationTask(effectiveConfig, result.task);
            setPreview(undefined);
            setAudioUrl(audio.url);
            await load();
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : t("preview.createFailed"));
        } finally {
            setPreviewGenerating(false);
        }
    }

    return (
        <main className="hide-scrollbar h-full min-h-0 overflow-y-auto bg-[#f7f8fa] px-4 py-5 text-[#171a1f] dark:bg-[#101215] dark:text-[#f3f5f7] sm:px-6 lg:px-8">
            <div className="mx-auto max-w-6xl">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-semibold">{t("title")}</h1>
                        <p className="mt-1 text-sm text-[#697381] dark:text-[#9aa3af]">{t("description")}</p>
                    </div>
                    <div className="flex gap-2">
                        <Button icon={<RefreshCw className="size-4" />} onClick={() => void load()}>
                            {t("refresh")}
                        </Button>
                        <Button
                            type="primary"
                            icon={<Plus className="size-4" />}
                            disabled={!voiceCloneModel}
                            title={!voiceCloneModel ? t("notConfigured") : undefined}
                            onClick={() => {
                                setClientRequestId((current) => current || crypto.randomUUID());
                                setCloneOpen(true);
                            }}
                        >
                            {t("cloneAction")}
                        </Button>
                    </div>
                </div>
                {!voiceCloneModel ? <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">{t("notConfiguredDescription")}</div> : null}
                <div className="mb-4 w-full sm:w-48">
                    <Select
                        className="w-full"
                        allowClear
                        placeholder={t("allStatuses")}
                        value={status}
                        onChange={(value) => {
                            setStatus(value);
                            setPage(1);
                        }}
                        options={["pending", "ready", "failed", "deleting"].map((value) => ({ value, label: t(`statuses.${value}`) }))}
                    />
                </div>
                {loading ? (
                    <div className="grid min-h-52 place-items-center">
                        <Spin />
                    </div>
                ) : error ? (
                    <Empty description={error}>
                        <Button onClick={() => void load()}>{t("retry")}</Button>
                    </Empty>
                ) : !profiles.length ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("empty")} />
                ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {profiles.map((profile) => (
                            <VoiceCard key={profile.id} profile={profile} onPreview={() => void openPreview(profile)} onChanged={load} />
                        ))}
                    </div>
                )}
                {total > pageSize ? (
                    <div className="mt-6 flex justify-center">
                        <Pagination current={page} pageSize={pageSize} total={total} showSizeChanger={false} onChange={setPage} />
                    </div>
                ) : null}
            </div>

            <Modal
                title={t("clone.title")}
                open={cloneOpen}
                okText={t("clone.confirm")}
                cancelText={t("cancel")}
                okButtonProps={{ disabled: !name.trim() || !file || !consent, loading: submitting }}
                onOk={() => void submitClone()}
                onCancel={() => !submitting && setCloneOpen(false)}
                width="min(520px, calc(100vw - 32px))"
            >
                <div className="space-y-4 pt-2">
                    <label className="grid gap-1.5 text-sm">
                        {t("clone.name")}
                        <Input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder={t("clone.namePlaceholder")} />
                    </label>
                    <div>
                        <div className="mb-1.5 text-sm">{t("clone.sample")}</div>
                        <Upload
                            beforeUpload={(next) => {
                                setFile(next);
                                setSourceAssetToken("");
                                setClientRequestId(crypto.randomUUID());
                                return false;
                            }}
                            fileList={file ? [{ uid: "voice-source", name: file.name, status: "done", originFileObj: file } as UploadFile] : []}
                            onRemove={() => {
                                setFile(undefined);
                                setSourceAssetToken("");
                                setClientRequestId(crypto.randomUUID());
                                return true;
                            }}
                            accept="audio/*"
                            maxCount={1}
                        >
                            <Button icon={<AudioLines className="size-4" />}>{t("clone.selectSample")}</Button>
                        </Upload>
                    </div>
                    <Checkbox checked={consent} onChange={(event) => setConsent(event.target.checked)}>
                        {t("clone.consent")}
                    </Checkbox>
                </div>
            </Modal>
            <Modal
                title={t("preview.confirmTitle")}
                open={Boolean(preview)}
                okText={t("preview.confirm")}
                cancelText={t("cancel")}
                confirmLoading={previewGenerating}
                cancelButtonProps={{ disabled: previewGenerating }}
                closable={!previewGenerating}
                maskClosable={!previewGenerating}
                onOk={() => void confirmPreview()}
                onCancel={() => !previewGenerating && setPreview(undefined)}
            >
                <p className="text-sm text-[#697381] dark:text-[#9aa3af]">{preview?.estimate == null ? t("preview.unknownCost") : t("preview.estimatedCost", { points: preview.estimate })}</p>
            </Modal>
            <Modal title={t("preview.title")} open={Boolean(audioUrl)} footer={null} onCancel={() => setAudioUrl("")}>
                <audio className="w-full" controls autoPlay src={audioUrl} />
            </Modal>
        </main>
    );
}

function VoiceCard({ profile, onPreview, onChanged }: { profile: PublicVoiceProfile; onPreview: () => void; onChanged: () => Promise<void> }) {
    const { message } = App.useApp();
    const t = useTranslations("voices");
    const [renaming, setRenaming] = useState(false);
    const [name, setName] = useState(profile.name);
    return (
        <Card size="small" className="!border-[#e5e8ec] !bg-white dark:!border-[#30353c] dark:!bg-[#181b20]">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    {renaming ? (
                        <Input
                            autoFocus
                            value={name}
                            maxLength={80}
                            onChange={(event) => setName(event.target.value)}
                            onPressEnter={async () => {
                                try {
                                    await renameVoiceProfile(profile.id, name);
                                    setRenaming(false);
                                    await onChanged();
                                } catch (cause) {
                                    message.error(cause instanceof Error ? cause.message : t("renameFailed"));
                                }
                            }}
                            onBlur={() => setRenaming(false)}
                        />
                    ) : (
                        <button type="button" className="max-w-full truncate text-left font-medium" onClick={() => setRenaming(true)} title={t("rename")}>
                            {profile.name}
                        </button>
                    )}
                    <div className="mt-2 text-xs text-[#7b8591] dark:text-[#98a2ae]">
                        {t("duration", { seconds: profile.source.durationSeconds.toFixed(1) })} · {profile.source.mimeType}
                    </div>
                </div>
                <Tag color={statusColor(profile.status)}>{t(`statuses.${profile.status}`)}</Tag>
            </div>
            {profile.error ? <p className="mt-3 rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{profile.error}</p> : null}
            <div className="mt-4 flex items-center justify-between">
                <Button type="text" size="small" icon={<Play className="size-4" />} disabled={profile.status !== "ready"} onClick={onPreview}>
                    {t("preview.action")}
                </Button>
                <Popconfirm
                    title={t("delete.confirmTitle")}
                    description={profile.status === "ready" ? t("delete.readyDescription") : t("delete.localDescription")}
                    okText={t("delete.action")}
                    cancelText={t("cancel")}
                    disabled={profile.status === "pending" || profile.status === "deleting"}
                    onConfirm={async () => {
                        try {
                            await deleteVoiceProfile(profile.id);
                            await onChanged();
                            message.success(t("delete.success"));
                        } catch (cause) {
                            message.error(cause instanceof Error ? cause.message : t("delete.failed"));
                        }
                    }}
                >
                    <Button danger type="text" size="small" icon={<Trash2 className="size-4" />} disabled={profile.status === "pending" || profile.status === "deleting"}>
                        {t("delete.action")}
                    </Button>
                </Popconfirm>
            </div>
        </Card>
    );
}

async function uploadAudio(file: File, uploadFailed: string, readFailed: string) {
    const dataUrl = await fileDataUrl(file, readFailed);
    const response = await fetch("/api/reference-assets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dataUrl, type: "audio", persistent: true, originalName: file.name }) });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.token) throw new Error(payload?.error || uploadFailed);
    return payload as { token: string };
}

function fileDataUrl(file: File, readFailed = "Unable to read the voice sample") {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(readFailed));
        reader.readAsDataURL(file);
    });
}
function previewLocale(locale: string): "zh-CN" | "en" | "vi" {
    return locale.startsWith("en") ? "en" : locale.startsWith("vi") ? "vi" : "zh-CN";
}
function statusColor(status: PublicVoiceProfile["status"]) {
    return status === "ready" ? "green" : status === "failed" ? "red" : status === "pending" || status === "deleting" ? "blue" : "default";
}
