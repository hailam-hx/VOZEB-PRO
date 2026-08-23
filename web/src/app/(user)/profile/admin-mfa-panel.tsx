"use client";

import { useState } from "react";
import { App, Button, Input, Modal, QRCode, Tag, Tooltip } from "antd";
import { Copy, KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { useTranslations } from "next-intl";

import { useCopyText } from "@/hooks/use-copy-text";
import { beginAdminMfaSetup, disableAdminMfa, enableAdminMfa, type AdminMfaSetup } from "@/services/api/admin-mfa";
import { useUserStore } from "@/stores/use-user-store";

import { profileDangerButtonClass, profilePrimaryButtonClass, profileSecondaryButtonClass } from "./profile-elements";

type Dialog = "setup" | "disable" | null;

export function AdminMfaPanel() {
    const t = useTranslations("profile.mfa");
    const { message } = App.useApp();
    const copyText = useCopyText();
    const user = useUserStore((state) => state.user);
    const setUser = useUserStore((state) => state.setUser);
    const [dialog, setDialog] = useState<Dialog>(null);
    const [currentPassword, setCurrentPassword] = useState("");
    const [token, setToken] = useState("");
    const [setup, setSetup] = useState<AdminMfaSetup | null>(null);
    const [submitting, setSubmitting] = useState(false);

    if (user?.role !== "admin") return null;

    const closeDialog = () => {
        if (submitting) return;
        setDialog(null);
        setCurrentPassword("");
        setToken("");
        setSetup(null);
    };

    const createSetup = async () => {
        setSubmitting(true);
        try {
            setSetup(await beginAdminMfaSetup(currentPassword));
            setCurrentPassword("");
        } catch {
            message.error(t("createFailed"));
        } finally {
            setSubmitting(false);
        }
    };

    const confirmSetup = async () => {
        setSubmitting(true);
        try {
            setUser(await enableAdminMfa(token));
            message.success(t("enabledSuccess"));
            closeAfterSuccess();
        } catch {
            message.error(t("enableFailed"));
        } finally {
            setSubmitting(false);
        }
    };

    const confirmDisable = async () => {
        setSubmitting(true);
        try {
            setUser(await disableAdminMfa(currentPassword, token));
            message.success(t("disabledSuccess"));
            closeAfterSuccess();
        } catch {
            message.error(t("disableFailed"));
        } finally {
            setSubmitting(false);
        }
    };

    const closeAfterSuccess = () => {
        setDialog(null);
        setCurrentPassword("");
        setToken("");
        setSetup(null);
    };

    return (
        <div className="max-w-xl space-y-4 border-t border-stone-200 pt-5 dark:border-stone-800">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-stone-950 dark:text-white">{t("title")}</h3>
                        <Tag color={user.mfaEnabled ? "green" : "default"}>{user.mfaEnabled ? t("enabled") : t("disabled")}</Tag>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-stone-500 dark:text-stone-400">{t("description")}</p>
                </div>
                {user.mfaEnabled ? (
                    <Button danger className={`${profileDangerButtonClass} shrink-0`} icon={<ShieldOff className="size-4" />} onClick={() => setDialog("disable")}>
                        {t("disable")}
                    </Button>
                ) : (
                    <Button type="primary" className={`${profilePrimaryButtonClass} shrink-0`} icon={<ShieldCheck className="size-4" />} onClick={() => setDialog("setup")}>
                        {t("setup")}
                    </Button>
                )}
            </div>

            <Modal
                title={dialog === "disable" ? t("disableTitle") : t("setupTitle")}
                open={dialog !== null}
                onCancel={closeDialog}
                mask={{ closable: false }}
                closable={{ "aria-label": t("close") }}
                footer={
                    <div className="flex justify-end gap-2">
                        <Button className={profileSecondaryButtonClass} disabled={submitting} onClick={closeDialog}>
                            {t("cancel")}
                        </Button>
                        {dialog === "setup" && !setup ? (
                            <Button type="primary" className={profilePrimaryButtonClass} loading={submitting} icon={<KeyRound className="size-4" />} onClick={() => void createSetup()}>
                                {t("generate")}
                            </Button>
                        ) : dialog === "setup" ? (
                            <Button type="primary" className={profilePrimaryButtonClass} loading={submitting} icon={<ShieldCheck className="size-4" />} onClick={() => void confirmSetup()}>
                                {t("verifyEnable")}
                            </Button>
                        ) : (
                            <Button danger className={profileDangerButtonClass} loading={submitting} icon={<ShieldOff className="size-4" />} onClick={() => void confirmDisable()}>
                                {t("verifyDisable")}
                            </Button>
                        )}
                    </div>
                }
            >
                {dialog === "setup" ? (
                    setup ? (
                        <div className="space-y-5">
                            <div className="flex justify-center" aria-label={t("qrAria")}>
                                <QRCode value={setup.uri} type="svg" />
                            </div>
                            <div className="space-y-2">
                                <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{t("manualSecret")}</span>
                                <div className="flex min-w-0 items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 dark:border-stone-700 dark:bg-stone-900">
                                    <code className="min-w-0 flex-1 break-all text-sm text-stone-800 dark:text-stone-100">{setup.secret}</code>
                                    <Tooltip title={t("copySecret")}>
                                        <Button type="text" aria-label={t("copySecretAria")} icon={<Copy className="size-4" />} onClick={() => copyText(setup.secret, t("secretCopied"))} />
                                    </Tooltip>
                                </div>
                            </div>
                            <TokenInput value={token} onChange={setToken} autoFocus />
                        </div>
                    ) : (
                        <PasswordInput value={currentPassword} onChange={setCurrentPassword} />
                    )
                ) : (
                    <div className="space-y-4">
                        <PasswordInput value={currentPassword} onChange={setCurrentPassword} />
                        <TokenInput value={token} onChange={setToken} />
                    </div>
                )}
            </Modal>
        </div>
    );
}

function PasswordInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    const t = useTranslations("profile.mfa");
    return (
        <label className="block space-y-2">
            <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{t("currentPassword")}</span>
            <Input.Password value={value} autoComplete="current-password" onChange={(event) => onChange(event.target.value)} />
        </label>
    );
}

function TokenInput({ value, onChange, autoFocus = false }: { value: string; onChange: (value: string) => void; autoFocus?: boolean }) {
    const t = useTranslations("profile.mfa");
    return (
        <label className="block space-y-2">
            <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{t("token")}</span>
            <Input value={value} autoFocus={autoFocus} autoComplete="one-time-code" inputMode="numeric" placeholder={t("tokenPlaceholder")} onChange={(event) => onChange(event.target.value)} />
        </label>
    );
}
