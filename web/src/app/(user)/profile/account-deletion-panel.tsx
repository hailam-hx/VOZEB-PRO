"use client";

import { useEffect, useState } from "react";
import { App, Button, Input, Modal, Popconfirm, Tag } from "antd";
import { RotateCcw, UserRoundX } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import type { AccountDeletionRequestStatus, AccountDeletionRequestView } from "@/lib/account-deletion-contract";
import { getOwnAccountDeletionRequest, submitOwnAccountDeletionRequest, withdrawOwnAccountDeletionRequest } from "@/services/api/account-deletion";

import { profileDangerButtonClass, profileSecondaryButtonClass } from "./profile-elements";

export function AccountDeletionPanel() {
    const t = useTranslations("profile.deletion");
    const format = useFormatter();
    const { message } = App.useApp();
    const [request, setRequest] = useState<AccountDeletionRequestView | null>(null);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [currentPassword, setCurrentPassword] = useState("");
    const [note, setNote] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [withdrawing, setWithdrawing] = useState(false);

    useEffect(() => {
        void loadRequest();
    }, []);

    const loadRequest = async () => {
        setLoading(true);
        try {
            setRequest(await getOwnAccountDeletionRequest());
        } catch {
            message.error(t("loadFailed"));
        } finally {
            setLoading(false);
        }
    };

    const submitRequest = async () => {
        setSubmitting(true);
        try {
            const result = await submitOwnAccountDeletionRequest({ currentPassword, note });
            setRequest(result);
            setModalOpen(false);
            setCurrentPassword("");
            setNote("");
            message.success(t("submitted"));
        } catch {
            message.error(t("submitFailed"));
        } finally {
            setSubmitting(false);
        }
    };

    const withdrawRequest = async () => {
        setWithdrawing(true);
        try {
            setRequest(await withdrawOwnAccountDeletionRequest());
            message.success(t("withdrawn"));
        } catch {
            message.error(t("withdrawFailed"));
        } finally {
            setWithdrawing(false);
        }
    };

    const pending = request?.status === "pending";
    const accepted = request?.status === "accepted";

    return (
        <div className="border-t border-stone-200 pt-5 dark:border-stone-800">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-stone-950 dark:text-white">{t("title")}</h3>
                        {request ? <Tag color={statusColor(request.status)}>{t(`statuses.${request.status}`)}</Tag> : null}
                    </div>
                    <p className="mt-1 max-w-xl text-sm leading-6 text-stone-500 dark:text-stone-400">{t("description")}</p>
                    {request ? (
                        <div className="mt-3 space-y-1 text-xs leading-5 text-stone-500 dark:text-stone-400">
                            <div>{t("requestedAt", { time: format.dateTime(new Date(request.requestedAt), { dateStyle: "medium", timeStyle: "short" }) })}</div>
                            {request.reviewNote ? <div className="break-words">{t("reviewNote", { note: request.reviewNote })}</div> : null}
                        </div>
                    ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                    {pending ? (
                        <Popconfirm title={t("withdrawTitle")} description={t("withdrawDescription")} okText={t("withdraw")} cancelText={t("cancel")} onConfirm={() => void withdrawRequest()}>
                            <Button className={profileSecondaryButtonClass} loading={withdrawing} icon={<RotateCcw className="size-4" />}>
                                {t("withdrawRequest")}
                            </Button>
                        </Popconfirm>
                    ) : (
                        <Button danger className={profileDangerButtonClass} disabled={loading || accepted} icon={<UserRoundX className="size-4" />} onClick={() => setModalOpen(true)}>
                            {accepted ? t("processing") : t("requestDeletion")}
                        </Button>
                    )}
                </div>
            </div>

            <Modal
                title={t("modalTitle")}
                open={modalOpen}
                okText={t("submit")}
                cancelText={t("cancel")}
                okButtonProps={{ danger: true, disabled: !currentPassword.trim() }}
                confirmLoading={submitting}
                mask={{ closable: !submitting }}
                keyboard={!submitting}
                onOk={() => void submitRequest()}
                onCancel={() => {
                    if (submitting) return;
                    setModalOpen(false);
                    setCurrentPassword("");
                    setNote("");
                }}
            >
                <div className="space-y-4 pt-2">
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm leading-6 text-red-800 dark:border-red-950 dark:bg-red-950/35 dark:text-red-200">{t("warning")}</div>
                    <label className="block space-y-2">
                        <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{t("currentPassword")}</span>
                        <Input.Password value={currentPassword} autoComplete="current-password" placeholder={t("passwordPlaceholder")} onChange={(event) => setCurrentPassword(event.target.value)} />
                    </label>
                    <label className="block space-y-2">
                        <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{t("note")}</span>
                        <Input.TextArea value={note} maxLength={500} rows={3} showCount placeholder={t("notePlaceholder")} onChange={(event) => setNote(event.target.value)} />
                    </label>
                </div>
            </Modal>
        </div>
    );
}

function statusColor(status: AccountDeletionRequestStatus) {
    if (status === "pending") return "gold";
    if (status === "accepted") return "blue";
    if (status === "rejected") return "red";
    return "default";
}
