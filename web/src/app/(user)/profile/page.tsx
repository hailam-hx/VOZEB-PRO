"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { App, Button, Input, Pagination } from "antd";
import { saveAs } from "file-saver";
import { CreditCard, Download, History, ReceiptText, RefreshCw, ShieldCheck, WalletCards } from "lucide-react";
import { useTranslations } from "next-intl";

import { CreditSymbol, formatCreditAmount } from "@/constant/credits";
import { CompactEmptyState } from "@/components/compact-empty-state";
import { resetClientSessionState } from "@/lib/client-session-reset";
import { downloadUserDataExport } from "@/services/api/user-data-export";
import { useUserStore, type LocalUser } from "@/stores/use-user-store";

import { AccountDeletionPanel } from "./account-deletion-panel";
import { AdminMfaPanel } from "./admin-mfa-panel";
import { LoginSecurityPanel } from "./login-security-panel";
import { CouponWalletSection } from "./profile-coupon-wallet";
import { ProfileReferralCenter } from "./profile-referral-center";

import {
    ProfileSectionKey,
    RECORD_PAGE_SIZE,
    profilePrimaryButtonClass,
    profileSecondaryButtonClass,
    profileDangerButtonClass,
    ProfileSectionNav,
    BillingCenterSection,
    AccountEmailForm,
    ProfileForm,
    OrderList,
    AccountMetric,
    AccountPanel,
    LoadingBlock,
    RecordList,
    parseProfileSection,
} from "./profile-elements";
import { useProfileData } from "./use-profile-data";

export default function ProfilePage() {
    const t = useTranslations("profile.page");
    const router = useRouter();
    const searchParams = useSearchParams();
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const setUser = useUserStore((state) => state.setUser);
    const requestedSection = parseProfileSection(searchParams.get("section"));
    const [activeSection, setActiveSection] = useState<ProfileSectionKey>(requestedSection);
    const [displayName, setDisplayName] = useState("");
    const [bio, setBio] = useState("");
    const [email, setEmail] = useState("");
    const [emailCode, setEmailCode] = useState("");
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [savingProfile, setSavingProfile] = useState(false);
    const [savingEmail, setSavingEmail] = useState(false);
    const [sendingCode, setSendingCode] = useState(false);
    const [savingPassword, setSavingPassword] = useState(false);
    const [exportingData, setExportingData] = useState(false);
    const { products, coupons, orders, points, consumption, loading: accountLoading, refresh: refreshAccount } = useProfileData(activeSection);

    const boundEmail = user?.email || "";
    const emailChanged = email.trim().toLowerCase() !== boundEmail.toLowerCase();

    useEffect(() => {
        setActiveSection(requestedSection);
    }, [requestedSection]);

    useEffect(() => {
        if (!user) return;
        setDisplayName(user.displayName || user.username);
        setBio(user.bio || "");
        setEmail(user.email || "");
    }, [user]);

    const switchSection = (key: ProfileSectionKey) => {
        setActiveSection(key);
        router.replace(key === "overview" ? "/profile" : `/profile?section=${key}`, { scroll: false });
    };

    const saveProfile = async () => {
        setSavingProfile(true);
        try {
            const response = await fetch("/api/auth/profile", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ displayName, bio }),
            });
            const payload = (await response.json()) as { user?: LocalUser; error?: string };
            if (!response.ok || !payload.user) throw new Error(payload.error || t("errors.saveProfile"));
            setUser(payload.user);
            setEmailCode("");
            message.success(t("profileSaved"));
        } catch {
            message.error(t("errors.saveProfile"));
        } finally {
            setSavingProfile(false);
        }
    };

    const saveEmail = async () => {
        if (!emailChanged || savingEmail) return;
        setSavingEmail(true);
        try {
            const response = await fetch("/api/auth/profile", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, emailCode }),
            });
            const payload = (await response.json()) as { user?: LocalUser; error?: string };
            if (!response.ok || !payload.user) throw new Error(payload.error || t("errors.saveEmail"));
            setUser(payload.user);
            setEmailCode("");
            message.success(t("emailSaved"));
        } catch {
            message.error(t("errors.saveEmail"));
        } finally {
            setSavingEmail(false);
        }
    };

    const sendEmailCode = async () => {
        if (!emailChanged) {
            message.info(t("emailUnchanged"));
            return;
        }
        setSendingCode(true);
        try {
            const response = await fetch("/api/auth/email-code", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ purpose: "email-change", email }),
            });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(payload.error || t("errors.sendCode"));
            message.success(t("codeSent"));
        } catch {
            message.error(t("errors.sendCode"));
        } finally {
            setSendingCode(false);
        }
    };

    const savePassword = async () => {
        setSavingPassword(true);
        try {
            const response = await fetch("/api/auth/password", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ currentPassword, newPassword }),
            });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(payload.error || t("errors.savePassword"));
            await resetClientSessionState();
            message.success(t("passwordSaved"));
            window.location.href = "/login";
        } catch {
            message.error(t("errors.savePassword"));
        } finally {
            setSavingPassword(false);
        }
    };

    const exportUserData = async () => {
        setExportingData(true);
        try {
            const result = await downloadUserDataExport();
            saveAs(result.blob, result.fileName);
            message.success(t("dataExported"));
        } catch {
            message.error(t("errors.exportData"));
        } finally {
            setExportingData(false);
        }
    };

    return (
        <main className="profile-page-scroll h-full min-h-0 overflow-x-hidden overflow-y-auto px-2 py-2 text-foreground sm:px-6 sm:py-6" style={{ backgroundColor: "var(--background)" }}>
            <div className="mx-auto w-full max-w-[1280px] pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-[calc(2rem+env(safe-area-inset-bottom))]">
                <div className="mb-1 flex items-center justify-end gap-1.5 sm:mb-5 sm:justify-between sm:gap-3 sm:rounded-xl sm:border sm:border-border sm:bg-card sm:p-6 sm:text-card-foreground">
                    <div className="hidden min-w-0 sm:block">
                        <h1 className="text-lg font-semibold text-stone-950 sm:text-2xl dark:text-white">{t("title")}</h1>
                        <p className="mt-2 hidden max-w-2xl text-sm leading-6 text-stone-500 sm:block dark:text-stone-400">{t("description")}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                        <Button size="small" className={profileSecondaryButtonClass} icon={<RefreshCw className="size-3.5 sm:size-4" />} loading={accountLoading} onClick={() => void refreshAccount()}>
                            <span className="sm:hidden">{t("refreshShort")}</span>
                            <span className="hidden sm:inline">{t("refresh")}</span>
                        </Button>
                        <Button size="small" className={profilePrimaryButtonClass} type="primary" icon={<CreditCard className="size-3.5 sm:size-4" />} onClick={() => switchSection("billing")}>
                            <span className="sm:hidden">{t("plansShort")}</span>
                            <span className="hidden sm:inline">{t("buyPlan")}</span>
                        </Button>
                    </div>
                </div>

                <div className="mb-1.5 xl:hidden sm:mb-5">
                    <ProfileSectionNav activeKey={activeSection} onChange={switchSection} mode="mobile" />
                </div>

                {activeSection === "overview" ? (
                    <section className="mb-2 grid grid-cols-2 gap-1 overflow-hidden rounded-lg border border-border bg-card p-1 sm:mb-5 xl:grid-cols-4 xl:gap-3 xl:overflow-visible xl:rounded-none xl:border-0 xl:bg-transparent xl:p-0">
                        <AccountMetric label={t("metrics.currentPlan")} value={user?.planName || user?.planId || t("metrics.notLoaded")} icon={<WalletCards className="size-4" />} />
                        <AccountMetric
                            label={t("metrics.creditBalance")}
                            value={t("metrics.creditValue", { amount: formatCreditAmount(user?.pointsBalance || 0) })}
                            detail={t("metrics.creditDetail", { daily: formatCreditAmount(user?.dailyPointsBalance || 0), permanent: formatCreditAmount(user?.permanentPointsBalance ?? user?.pointsBalance ?? 0) })}
                            icon={<CreditSymbol className="text-base" />}
                        />
                        <AccountMetric label={t("metrics.orders")} value={t("metrics.orderCount", { count: orders.total })} icon={<ReceiptText className="size-4" />} />
                        <AccountMetric label={t("metrics.creditHistory")} value={t("metrics.recordCount", { count: points.total })} icon={<History className="size-4" />} />
                    </section>
                ) : null}

                <div className="grid min-w-0 gap-1.5 sm:gap-5 xl:grid-cols-[210px_minmax(0,1fr)]">
                    <div className="hidden xl:block">
                        <ProfileSectionNav activeKey={activeSection} onChange={switchSection} mode="desktop" />
                    </div>
                    <div className="min-w-0 space-y-1.5 sm:space-y-5">
                        {activeSection === "overview" ? (
                            <div className="grid gap-1.5 sm:gap-5 lg:grid-cols-2">
                                <AccountPanel title={t("recentCredits.title")} description={t("recentCredits.description")}>
                                    {points.loading ? (
                                        <LoadingBlock />
                                    ) : points.items.length ? (
                                        <RecordList records={points.items.slice(0, 4)} />
                                    ) : (
                                        <CompactEmptyState title={t("recentCredits.emptyTitle")} description={t("recentCredits.emptyDescription")} />
                                    )}
                                </AccountPanel>
                                <AccountPanel title={t("recentOrders.title")} description={t("recentOrders.description")}>
                                    <OrderList loading={orders.loading} orders={orders.items.slice(0, 5)} total={orders.total} page={orders.page} onPageChange={orders.setPage} compact />
                                </AccountPanel>
                            </div>
                        ) : null}

                        {activeSection === "profile" ? (
                            <AccountPanel title={t("profilePanel.title")} description={t("profilePanel.description")}>
                                <ProfileForm user={user} displayName={displayName} bio={bio} savingProfile={savingProfile} onDisplayNameChange={setDisplayName} onBioChange={setBio} onSave={() => void saveProfile()} />
                            </AccountPanel>
                        ) : null}

                        {activeSection === "billing" ? (
                            <BillingCenterSection
                                products={products.items}
                                productsLoading={products.loading}
                                onRefresh={() => void products.refresh()}
                                onCheckout={(product) => router.push(`/billing/checkout?product=${encodeURIComponent(product.id)}`)}
                            />
                        ) : null}

                        {activeSection === "coupons" ? (
                            <CouponWalletSection
                                coupons={coupons.items}
                                templates={coupons.templates}
                                templatesTotal={coupons.templatesTotal}
                                templatePage={coupons.templatePage}
                                total={coupons.total}
                                page={coupons.page}
                                loading={coupons.loading}
                                onRefresh={coupons.refresh}
                                onTemplatePageChange={coupons.setTemplatePage}
                                onPageChange={coupons.setPage}
                                onClaimed={coupons.refreshAfterClaim}
                            />
                        ) : null}

                        {activeSection === "referrals" ? <ProfileReferralCenter /> : null}

                        {activeSection === "orders" ? (
                            <AccountPanel title={t("ordersPanel.title")} description={t("ordersPanel.description")}>
                                <OrderList loading={orders.loading} orders={orders.items} total={orders.total} page={orders.page} onPageChange={orders.setPage} />
                            </AccountPanel>
                        ) : null}

                        {activeSection === "consume" ? (
                            <AccountPanel title={t("consumptionPanel.title")} description={t("consumptionPanel.description")}>
                                {consumption.loading ? (
                                    <LoadingBlock />
                                ) : consumption.items.length ? (
                                    <>
                                        <RecordList records={consumption.items} />
                                        {consumption.total > RECORD_PAGE_SIZE ? <Pagination size="small" current={consumption.page} pageSize={RECORD_PAGE_SIZE} total={consumption.total} showSizeChanger={false} onChange={consumption.setPage} /> : null}
                                    </>
                                ) : (
                                    <CompactEmptyState title={t("consumptionPanel.emptyTitle")} description={t("consumptionPanel.emptyDescription")} />
                                )}
                            </AccountPanel>
                        ) : null}

                        {activeSection === "points" ? (
                            <AccountPanel title={t("creditsPanel.title")} description={t("creditsPanel.description")}>
                                {points.loading ? (
                                    <LoadingBlock />
                                ) : points.items.length ? (
                                    <>
                                        <RecordList records={points.items} />
                                        {points.total > RECORD_PAGE_SIZE ? <Pagination size="small" current={points.page} pageSize={RECORD_PAGE_SIZE} total={points.total} showSizeChanger={false} onChange={points.setPage} /> : null}
                                    </>
                                ) : (
                                    <CompactEmptyState title={t("creditsPanel.emptyTitle")} description={t("creditsPanel.emptyDescription")} />
                                )}
                            </AccountPanel>
                        ) : null}

                        {activeSection === "security" ? (
                            <AccountPanel title={t("securityPanel.title")} description={t("securityPanel.description")}>
                                <div className="max-w-2xl space-y-6">
                                    <AccountEmailForm
                                        boundEmail={boundEmail}
                                        emailChanged={emailChanged}
                                        email={email}
                                        emailCode={emailCode}
                                        sendingCode={sendingCode}
                                        savingEmail={savingEmail}
                                        onEmailChange={setEmail}
                                        onEmailCodeChange={setEmailCode}
                                        onSendEmailCode={() => void sendEmailCode()}
                                        onSave={() => void saveEmail()}
                                    />

                                    <AdminMfaPanel />

                                    <LoginSecurityPanel />

                                    <div className="max-w-xl space-y-4 border-t border-stone-200 pt-5 dark:border-stone-800">
                                        <div>
                                            <h3 className="text-sm font-semibold text-stone-950 dark:text-white">{t("password.title")}</h3>
                                            <p className="mt-1 text-sm leading-6 text-stone-500 dark:text-stone-400">{t("password.description")}</p>
                                        </div>
                                        <label className="block space-y-2">
                                            <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{t("password.current")}</span>
                                            <Input.Password value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
                                        </label>
                                        <label className="block space-y-2">
                                            <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{t("password.new")}</span>
                                            <Input.Password value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder={t("password.placeholder")} />
                                        </label>
                                        <Button danger className={profileDangerButtonClass} loading={savingPassword} icon={<ShieldCheck className="size-4" />} onClick={() => void savePassword()}>
                                            {t("password.save")}
                                        </Button>
                                    </div>

                                    <div className="border-t border-stone-200 pt-5 dark:border-stone-800">
                                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                            <div className="min-w-0">
                                                <h3 className="text-sm font-semibold text-stone-950 dark:text-white">{t("data.title")}</h3>
                                                <p className="mt-1 text-sm leading-6 text-stone-500 dark:text-stone-400">{t("data.description")}</p>
                                            </div>
                                            <Button className={`${profileSecondaryButtonClass} shrink-0`} loading={exportingData} icon={<Download className="size-4" />} onClick={() => void exportUserData()}>
                                                {t("data.export")}
                                            </Button>
                                        </div>
                                    </div>
                                    <AccountDeletionPanel />
                                </div>
                            </AccountPanel>
                        ) : null}
                    </div>
                </div>
            </div>
        </main>
    );
}
