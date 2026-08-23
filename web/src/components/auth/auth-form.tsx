"use client";

import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, Gift, LockKeyhole, Mail, ShieldCheck, UserRound } from "lucide-react";
import { App, Button, Checkbox, Input } from "antd";

import { SiteLogo } from "@/components/layout/site-logo";
import { DEFAULT_SITE_TITLE, resolveSiteTitle } from "@/lib/site-brand";
import { usePublicSessionStore } from "@/stores/use-public-session-store";
import { type LocalUser, useUserStore } from "@/stores/use-user-store";
import { cn } from "@/lib/utils";

type AuthFormProps = {
    mode: "login" | "register";
    nextPath?: string;
    registrationEnabled?: boolean;
    emailRegistrationEnabled?: boolean;
    firstUser?: boolean;
    installToken?: string;
    onInstallTokenChange?: (value: string) => void;
    variant?: "page" | "embedded";
    className?: string;
    headerSlot?: ReactNode;
    authError?: string;
    initialReferralCode?: string;
    referralSource?: string;
    inviteError?: string;
};

export function AuthForm({
    mode,
    nextPath = "/create",
    registrationEnabled = true,
    emailRegistrationEnabled = false,
    firstUser = false,
    installToken = "",
    onInstallTokenChange,
    variant = "page",
    className,
    headerSlot,
    authError,
    initialReferralCode = "",
    referralSource = "registration-form",
    inviteError,
}: AuthFormProps) {
    const t = useTranslations("auth");
    const router = useRouter();
    const { message } = App.useApp();
    const site = usePublicSessionStore((state) => state.payload?.settings?.site) || { title: DEFAULT_SITE_TITLE, logoUrl: "/logo.svg" };
    const siteTitle = resolveSiteTitle(site.title);
    const setUser = useUserStore((state) => state.setUser);
    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [emailCode, setEmailCode] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [password, setPassword] = useState("");
    const [totpCode, setTotpCode] = useState("");
    const [mfaRequired, setMfaRequired] = useState(false);
    const [referralCode, setReferralCode] = useState(initialReferralCode);
    const [policyAccepted, setPolicyAccepted] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [sendingCode, setSendingCode] = useState(false);
    const isRegister = mode === "register";
    const disabled = isRegister && !registrationEnabled;
    const installTokenReady = !firstUser || installToken.trim().length >= 32;

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (disabled) return;
        setSubmitting(true);
        try {
            const response = await fetch(isRegister ? "/api/auth/register" : "/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    username,
                    email,
                    emailCode,
                    displayName,
                    password,
                    totpCode: !isRegister && mfaRequired ? totpCode : undefined,
                    referralCode: isRegister && !firstUser ? referralCode : undefined,
                    referralSource,
                    policyAccepted: isRegister && !firstUser ? policyAccepted : undefined,
                    installToken: firstUser ? installToken.trim() : undefined,
                }),
            });
            const payload = (await response.json()) as { user?: LocalUser; error?: string; mfaRequired?: boolean; securityNotice?: { networkChanged: boolean; deviceChanged: boolean } };
            if (!isRegister && payload.mfaRequired) {
                setMfaRequired(true);
                message.info(t("mfaRequired"));
                return;
            }
            if (!response.ok || !payload.user) throw new Error(isRegister ? t("registerFailed") : t("loginFailed"));
            setUser(payload.user);
            if (!isRegister && payload.securityNotice) {
                const changed = payload.securityNotice.deviceChanged && payload.securityNotice.networkChanged ? t("securityChangedBoth") : payload.securityNotice.deviceChanged ? t("securityChangedDevice") : t("securityChangedNetwork");
                message.warning(t("securityNotice", { changed }));
            } else {
                message.success(isRegister ? t("registerSuccess") : t("loginSuccess"));
            }
            router.replace(nextPath);
            router.refresh();
        } catch {
            message.error(isRegister ? t("registerFailed") : t("loginFailed"));
        } finally {
            setSubmitting(false);
        }
    };

    const sendEmailCode = async () => {
        setSendingCode(true);
        try {
            const response = await fetch("/api/auth/email-code", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ purpose: "register", email }),
            });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(t("emailCodeFailed"));
            message.success(t("emailCodeSent"));
        } catch {
            message.error(t("emailCodeFailed"));
        } finally {
            setSendingCode(false);
        }
    };

    const form = (
        <section className={cn("auth-panel flex min-h-full items-center", variant === "embedded" ? "p-6 sm:p-7" : "p-8 sm:p-10", className)}>
            <form onSubmit={submit} className={cn("auth-form-body w-full", variant === "embedded" ? "space-y-4" : "space-y-6")}>
                {headerSlot}
                <div className="auth-form-header">
                    <p className="auth-form-kicker text-sm font-medium">{firstUser ? t("firstInitialization") : isRegister ? t("createCreativeAccount") : t("welcomeBack")}</p>
                    <h2 className={cn("mt-2 font-semibold tracking-normal text-stone-950 dark:text-white", variant === "embedded" ? "text-2xl" : "text-3xl")}>
                        {firstUser ? t("createFirstAdmin") : isRegister ? t("registerSite", { site: siteTitle }) : t("loginSite", { site: siteTitle })}
                    </h2>
                    <p className="auth-form-description mt-3 text-sm leading-6 text-stone-500 dark:text-stone-400">{isRegister ? t("registerDescription") : t("loginDescription")}</p>
                </div>

                {authError ? <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-100">{authError}</div> : null}

                {isRegister && inviteError ? <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100">{inviteError}</div> : null}

                {disabled ? <div className="rounded-md border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900 dark:border-cyan-300/20 dark:bg-cyan-300/8 dark:text-cyan-50">{t("registrationClosed")}</div> : null}

                {firstUser ? (
                    <label className="block space-y-3">
                        <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{t("installToken")}</span>
                        <Input.Password
                            size="large"
                            prefix={<LockKeyhole className="size-4 text-stone-500" />}
                            value={installToken}
                            onChange={(event) => onInstallTokenChange?.(event.target.value)}
                            placeholder={t("installTokenPlaceholder")}
                            autoComplete="off"
                            disabled={submitting}
                            required
                        />
                        <span className="block text-xs leading-5 text-stone-500 dark:text-stone-400">{t("installTokenHint")}</span>
                    </label>
                ) : null}

                <label className="block space-y-3">
                    <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{isRegister ? t("username") : t("usernameOrEmail")}</span>
                    <Input
                        size="large"
                        prefix={<UserRound className="size-4 text-stone-500" />}
                        value={username}
                        onChange={(event) => {
                            setUsername(event.target.value);
                            setMfaRequired(false);
                            setTotpCode("");
                        }}
                        placeholder={isRegister ? t("setUsername") : t("enterUsernameOrEmail")}
                        autoComplete="username"
                        disabled={submitting || disabled}
                        required
                    />
                    {isRegister ? <span className="block text-xs leading-5 text-stone-500 dark:text-stone-400">{t("usernameHint")}</span> : null}
                </label>

                {isRegister && emailRegistrationEnabled ? (
                    <div className="space-y-3">
                        <label className="block space-y-3">
                            <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{t("email")}</span>
                            <Input
                                size="large"
                                prefix={<Mail className="size-4 text-stone-500" />}
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                placeholder="csyqlz@gmail.com"
                                autoComplete="email"
                                type="email"
                                disabled={submitting || disabled}
                                required
                            />
                        </label>
                        <label className="block space-y-3">
                            <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{t("emailVerificationCode")}</span>
                            <Input.Search
                                size="large"
                                value={emailCode}
                                onChange={(event) => setEmailCode(event.target.value)}
                                placeholder={t("sixDigitCode")}
                                enterButton={sendingCode ? t("sending") : t("getVerificationCode")}
                                loading={sendingCode}
                                disabled={submitting || disabled}
                                onSearch={() => void sendEmailCode()}
                                required
                            />
                        </label>
                    </div>
                ) : null}

                {isRegister ? (
                    <label className="block space-y-3">
                        <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{t("creativeDisplayName")}</span>
                        <Input size="large" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={t("displayNamePlaceholder")} autoComplete="name" disabled={submitting || disabled} />
                    </label>
                ) : null}

                {isRegister && !firstUser ? (
                    <label className="block space-y-3">
                        <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{t("invitationCodeOptional")}</span>
                        <Input
                            size="large"
                            prefix={<Gift className="size-4 text-stone-500" />}
                            value={referralCode}
                            onChange={(event) => setReferralCode(event.target.value.toUpperCase())}
                            placeholder={t("invitePlaceholder")}
                            autoComplete="off"
                            maxLength={24}
                            disabled={submitting || disabled}
                        />
                    </label>
                ) : null}

                <label className="block space-y-3">
                    <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{t("password")}</span>
                    <Input.Password
                        size="large"
                        prefix={<LockKeyhole className="size-4 text-stone-500" />}
                        value={password}
                        onChange={(event) => {
                            setPassword(event.target.value);
                            setMfaRequired(false);
                            setTotpCode("");
                        }}
                        placeholder={isRegister ? t("passwordMinimum") : t("enterPassword")}
                        autoComplete={isRegister ? "new-password" : "current-password"}
                        disabled={submitting || disabled}
                        required
                    />
                </label>

                {!isRegister && mfaRequired ? (
                    <label className="block space-y-3">
                        <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{t("totpCode")}</span>
                        <Input
                            size="large"
                            prefix={<ShieldCheck className="size-4 text-stone-500" />}
                            value={totpCode}
                            autoFocus
                            autoComplete="one-time-code"
                            inputMode="numeric"
                            placeholder={t("totpPlaceholder")}
                            disabled={submitting}
                            onChange={(event) => setTotpCode(event.target.value)}
                            required
                        />
                    </label>
                ) : null}

                {isRegister && !firstUser ? (
                    <Checkbox checked={policyAccepted} disabled={submitting || disabled} onChange={(event) => setPolicyAccepted(event.target.checked)}>
                        <span className="text-sm leading-6 text-stone-600 dark:text-stone-300">
                            {t("policyPrefix")}
                            <a className="mx-1 font-medium text-stone-950 hover:underline dark:text-white" href={site.termsUrl || "/terms"} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                                {t("terms")}
                            </a>
                            {t("and")}
                            <a className="ml-1 font-medium text-stone-950 hover:underline dark:text-white" href={site.privacyUrl || "/privacy"} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                                {t("privacy")}
                            </a>
                        </span>
                    </Checkbox>
                ) : null}

                <Button
                    className="auth-submit-button"
                    type="primary"
                    htmlType="submit"
                    size="large"
                    block
                    loading={submitting}
                    disabled={disabled || !installTokenReady || (isRegister && !firstUser && !policyAccepted)}
                    icon={<ArrowRight className="size-4" />}
                    iconPlacement="end"
                >
                    {firstUser ? t("createAdminSubmit") : isRegister ? t("registerSubmit") : mfaRequired ? t("verifyLoginSubmit") : t("loginSubmit")}
                </Button>

                <div className="auth-switch-link pt-2 text-center text-sm text-stone-500 dark:text-stone-400">
                    {isRegister ? (
                        <>
                            {t("alreadyHaveAccount")}{" "}
                            <Link href="/login" className="font-medium text-stone-950 hover:underline dark:text-white">
                                {t("loginDirectly")}
                            </Link>
                        </>
                    ) : (
                        <>
                            {t("noAccount")}{" "}
                            <Link href="/register" className="font-medium text-stone-950 hover:underline dark:text-white">
                                {t("registerNow")}
                            </Link>
                            <span className="mx-2 text-stone-300 dark:text-stone-700">/</span>
                            <Link href="/forgot-password" className="font-medium text-stone-950 hover:underline dark:text-white">
                                {t("forgotPassword")}
                            </Link>
                        </>
                    )}
                </div>
            </form>
        </section>
    );

    if (variant === "embedded") return form;

    return (
        <main className="auth-page-bg app-scroll-page flex items-center justify-center px-4 py-6 text-foreground sm:px-6 sm:py-10">
            <div className="auth-page-card grid w-full max-w-5xl overflow-hidden border backdrop-blur md:grid-cols-[0.9fr_1fr]">
                <section className="auth-page-brand-panel flex min-h-[220px] flex-col justify-between gap-5 border-b p-5 text-stone-950 sm:min-h-[360px] sm:gap-8 sm:p-8 md:border-b-0 md:border-r dark:text-white">
                    <div className="flex items-start justify-between gap-4">
                        <Link href="/" className="inline-flex items-center gap-4 text-base font-semibold">
                            <SiteLogo logoUrl={site.logoUrl} className="size-16 sm:size-20" />
                            <span className="text-3xl">{site.title}</span>
                        </Link>
                        <Link
                            href="/"
                            className="auth-back-home inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-stone-200 bg-white/70 px-3 text-sm font-medium text-stone-700 transition hover:border-stone-300 hover:text-stone-950 dark:border-white/10 dark:bg-white/5 dark:text-stone-200 dark:hover:border-white/20 dark:hover:text-white"
                        >
                            <ArrowLeft className="size-4" />
                            <span>{t("backHome")}</span>
                        </Link>
                    </div>
                    <div className="auth-page-brand-copy">
                        <h1 className="text-balance text-2xl font-semibold tracking-normal sm:text-3xl">{firstUser ? t("createFirstAdmin") : isRegister ? t("registerBrandTitle") : t("loginBrandTitle")}</h1>
                    </div>
                    <div className="auth-page-feature-list grid gap-2 text-sm text-stone-600 dark:text-stone-300">
                        {[t("featureCommerce"), t("featureReuse"), t("featureUnified")].map((item) => (
                            <div key={item} className="flex items-center gap-2">
                                <span className="auth-feature-dot size-1.5 rounded-full" />
                                <span>{item}</span>
                            </div>
                        ))}
                    </div>
                    <p className="auth-page-brand-description max-w-sm text-sm leading-6 text-stone-500 dark:text-stone-400">{t("brandDescription")}</p>
                </section>
                {form}
            </div>
        </main>
    );
}
