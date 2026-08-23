"use client";

import { useState } from "react";
import Link from "next/link";
import { App, Button, Input } from "antd";
import { ArrowLeft, Mail } from "lucide-react";
import { useTranslations } from "next-intl";

export default function ForgotPasswordPage() {
    const t = useTranslations("auth");
    const { message } = App.useApp();
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [sendingCode, setSendingCode] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const sendCode = async () => {
        setSendingCode(true);
        try {
            const response = await fetch("/api/auth/email-code", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ purpose: "password-reset", email }),
            });
            if (!response.ok) throw new Error(t("emailCodeFailed"));
            message.success(t("emailCodeSent"));
        } catch {
            message.error(t("emailCodeFailed"));
        } finally {
            setSendingCode(false);
        }
    };

    const resetPassword = async () => {
        setSubmitting(true);
        try {
            const response = await fetch("/api/auth/password/reset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, code, newPassword }),
            });
            if (!response.ok) throw new Error(t("resetFailed"));
            message.success(t("resetSuccess"));
            window.location.href = "/login";
        } catch {
            message.error(t("resetFailed"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="auth-page-bg app-scroll-page flex items-center justify-center px-4 py-6 text-foreground sm:px-6 sm:py-10">
            <section className="auth-reset-card w-full max-w-md border p-6 backdrop-blur">
                <Link href="/login" className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-stone-600 hover:text-stone-950 dark:text-stone-300 dark:hover:text-white">
                    <ArrowLeft className="size-4" />
                    {t("backToLogin")}
                </Link>
                <div className="mb-5">
                    <p className="auth-form-kicker text-sm font-medium">{t("recoverAccount")}</p>
                    <h1 className="mt-2 text-2xl font-semibold text-stone-950 dark:text-white">{t("resetPassword")}</h1>
                    <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">{t("resetDescription")}</p>
                </div>
                <div className="space-y-4">
                    <Input size="large" prefix={<Mail className="size-4 text-stone-500" />} value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("boundEmail")} type="email" />
                    <Input.Search size="large" value={code} onChange={(event) => setCode(event.target.value)} placeholder={t("sixDigitCode")} enterButton={t("getVerificationCode")} loading={sendingCode} onSearch={() => void sendCode()} />
                    <Input.Password size="large" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder={t("newPassword")} />
                    <Button type="primary" size="large" block loading={submitting} onClick={() => void resetPassword()}>
                        {t("resetPassword")}
                    </Button>
                </div>
            </section>
        </main>
    );
}
