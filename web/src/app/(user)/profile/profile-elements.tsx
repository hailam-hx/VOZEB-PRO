"use client";

import type { ReactNode } from "react";
import { Button, Input, Pagination, Select, Spin, Tag } from "antd";
import { CreditCard, History, ReceiptText, RefreshCw, Save, ShieldCheck, UserCircle, UserPlus, WalletCards } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { CreditSymbol, formatCreditAmount } from "@/constant/credits";
import { TopUpPresetGrid } from "@/components/billing/top-up-preset-grid";
import { CompactEmptyState } from "@/components/compact-empty-state";
import { cn } from "@/lib/utils";
import { type TopUpOrder, type TopUpOrderStatus, type TopUpPreset } from "@/services/api/billing";
import type { PointRecord } from "@/services/api/points";
import { useUserStore } from "@/stores/use-user-store";
import { ProfileAvatarUploader } from "@/components/profile/profile-avatar-uploader";

export type ProfileSectionKey = "overview" | "profile" | "billing" | "referrals" | "orders" | "consume" | "points" | "security";

export const RECORD_PAGE_SIZE = 8;
export const ORDER_PAGE_SIZE = 8;

const profileSections: Array<{ key: ProfileSectionKey; icon: ReactNode }> = [
    { key: "overview", icon: <WalletCards className="size-4" /> },
    { key: "profile", icon: <UserCircle className="size-4" /> },
    { key: "billing", icon: <CreditCard className="size-4" /> },
    { key: "orders", icon: <ReceiptText className="size-4" /> },
    { key: "points", icon: <CreditSymbol className="text-sm" /> },
    { key: "consume", icon: <History className="size-4" /> },
    { key: "referrals", icon: <UserPlus className="size-4" /> },
    { key: "security", icon: <ShieldCheck className="size-4" /> },
];

export const profilePrimaryButtonClass = "profile-primary-button";
export const profileSecondaryButtonClass = "profile-secondary-button";
export const profileDangerButtonClass = "profile-danger-button";

export function ProfileSectionNav({ activeKey, onChange, mode }: { activeKey: ProfileSectionKey; onChange: (key: ProfileSectionKey) => void; mode: "mobile" | "desktop" }) {
    const t = useTranslations("profile.sections");
    if (mode === "mobile") {
        return (
            <nav className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-2 text-card-foreground" aria-label={t("aria")}>
                <span className="shrink-0 text-[11px] font-medium text-stone-500 dark:text-stone-400">{t("current")}</span>
                <Select aria-label={t("switchAria")} className="min-w-0 flex-1" variant="borderless" value={activeKey} options={profileSections.map((section) => ({ label: t(`${section.key}.label`), value: section.key }))} onChange={onChange} />
            </nav>
        );
    }

    return (
        <aside className="min-w-0 self-start xl:sticky xl:top-0">
            <div className="rounded-xl border border-border bg-card p-1 text-card-foreground shadow-sm shadow-stone-200/60 dark:shadow-black/20">
                <div className="flex flex-col gap-1">
                    {profileSections.map((section) => {
                        const active = section.key === activeKey;
                        return (
                            <button
                                key={section.key}
                                type="button"
                                className={cn(
                                    "relative flex min-w-0 items-center gap-2 overflow-hidden rounded-lg border px-2 py-2 text-left transition",
                                    active
                                        ? "border-[#bcc8d6] bg-[#eef2f7] text-[#263141] shadow-[0_10px_24px_rgba(71,85,105,0.10)] dark:border-[#536173] dark:bg-[#252d37] dark:text-white dark:shadow-black/20"
                                        : "border-transparent text-stone-600 hover:border-stone-200 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:border-stone-800 dark:hover:bg-stone-900 dark:hover:text-white",
                                )}
                                onClick={() => onChange(section.key)}
                            >
                                <span
                                    className={cn(
                                        "flex size-6 shrink-0 items-center justify-center rounded-md",
                                        active ? "bg-white text-[#52627a] shadow-sm dark:bg-[#343e49] dark:text-[#d8dee8]" : "bg-stone-100 text-stone-700 dark:bg-stone-900 dark:text-stone-200",
                                    )}
                                >
                                    {section.icon}
                                </span>
                                <span className="min-w-0">
                                    <span className={cn("block text-sm font-semibold", active ? "text-[#263141] dark:text-white" : "text-stone-950 dark:text-stone-100")}>{t(`${section.key}.label`)}</span>
                                    <span className={cn("mt-0.5 block truncate text-xs", active ? "text-[#66758e] dark:text-[#b8c4d6]" : "text-stone-500 dark:text-stone-400")}>{t(`${section.key}.shortDescription`)}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </aside>
    );
}

export function BillingCenterSection({ presets, presetsLoading, onRefresh, onCheckout, onCustom }: { presets: TopUpPreset[]; presetsLoading: boolean; onRefresh: () => void; onCheckout: (preset: TopUpPreset) => void; onCustom: () => void }) {
    const t = useTranslations("profile.billingCenter");
    return (
        <section className="rounded-lg border border-border bg-card p-2 text-card-foreground sm:rounded-2xl sm:p-6">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="text-lg font-semibold tracking-tight text-stone-950 sm:text-xl dark:text-white">{t("title")}</h2>
                    <p className="mt-1 text-xs leading-5 text-stone-500 sm:text-sm sm:leading-6 dark:text-stone-400">{t("description")}</p>
                </div>
                <Button className={`${profileSecondaryButtonClass} shrink-0`} icon={<RefreshCw className="size-4" />} onClick={onRefresh} loading={presetsLoading}>
                    <span className="hidden sm:inline">{t("refresh")}</span>
                </Button>
            </div>
            <div className="mt-2 border-t border-stone-200 pt-2 sm:mt-4 sm:pt-4 dark:border-stone-800">
                <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="text-base font-semibold text-stone-950 dark:text-white">{t("available")}</h3>
                        <p className="mt-1 hidden text-sm text-stone-500 sm:block dark:text-stone-400">{t("availableDescription")}</p>
                    </div>
                    {!presetsLoading && presets.length ? <span className="shrink-0 text-xs text-stone-400 dark:text-stone-500">{t("count", { count: presets.length })}</span> : null}
                </div>
                <div className="mt-2 sm:mt-4">{presetsLoading ? <LoadingBlock /> : <TopUpPresetGrid presets={presets} customSelected={false} onSelectPreset={onCheckout} onSelectCustom={onCustom} />}</div>
            </div>
        </section>
    );
}

export function ProfileForm({
    user,
    displayName,
    bio,
    savingProfile,
    onDisplayNameChange,
    onBioChange,
    onSave,
}: {
    user: ReturnType<typeof useUserStore.getState>["user"];
    displayName: string;
    bio: string;
    savingProfile: boolean;
    onDisplayNameChange: (value: string) => void;
    onBioChange: (value: string) => void;
    onSave: () => void;
}) {
    const t = useTranslations("profile.form");
    return (
        <div className="max-w-2xl">
            <ProfileAvatarUploader />
            <div className="mt-3 grid gap-3 sm:mt-4 sm:grid-cols-2 sm:gap-4">
                <label className="block min-w-0 space-y-2">
                    <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{t("username")}</span>
                    <Input value={user?.username || ""} disabled />
                </label>
                <label className="block min-w-0 space-y-2">
                    <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{t("displayName")}</span>
                    <Input value={displayName} onChange={(event) => onDisplayNameChange(event.target.value)} />
                </label>
                <label className="block min-w-0 space-y-2 sm:col-span-2">
                    <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{t("bio")}</span>
                    <Input.TextArea value={bio} maxLength={160} showCount autoSize={{ minRows: 3, maxRows: 5 }} placeholder={t("bioPlaceholder")} onChange={(event) => onBioChange(event.target.value)} />
                </label>
                <Button className={`${profilePrimaryButtonClass} w-fit sm:col-span-2`} type="primary" icon={<Save className="size-4" />} loading={savingProfile} onClick={onSave}>
                    {t("save")}
                </Button>
            </div>
        </div>
    );
}

export function AccountEmailForm({
    boundEmail,
    emailChanged,
    email,
    emailCode,
    sendingCode,
    savingEmail,
    onEmailChange,
    onEmailCodeChange,
    onSendEmailCode,
    onSave,
}: {
    boundEmail: string;
    emailChanged: boolean;
    email: string;
    emailCode: string;
    sendingCode: boolean;
    savingEmail: boolean;
    onEmailChange: (value: string) => void;
    onEmailCodeChange: (value: string) => void;
    onSendEmailCode: () => void;
    onSave: () => void;
}) {
    const t = useTranslations("profile.email");
    return (
        <div className="max-w-2xl">
            <div>
                <h3 className="text-sm font-semibold text-stone-950 dark:text-white">{t("title")}</h3>
                <p className="mt-1 break-all text-sm leading-6 text-stone-500 dark:text-stone-400">{boundEmail || t("description")}</p>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block min-w-0 space-y-2">
                    <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{boundEmail ? t("change") : t("bind")}</span>
                    <Input value={email} onChange={(event) => onEmailChange(event.target.value)} placeholder={t("placeholder")} />
                </label>
                <label className="block min-w-0 space-y-2">
                    <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{t("code")}</span>
                    <Input.Search
                        className="profile-email-code-search"
                        value={emailCode}
                        onChange={(event) => onEmailCodeChange(event.target.value)}
                        placeholder={emailChanged ? t("codeRequired") : t("codeNotNeeded")}
                        enterButton={t("getCode")}
                        loading={sendingCode}
                        disabled={!emailChanged}
                        onSearch={onSendEmailCode}
                    />
                </label>
                <Button className={`${profilePrimaryButtonClass} w-fit sm:col-span-2`} type="primary" icon={<Save className="size-4" />} loading={savingEmail} disabled={!emailChanged || !email.trim()} onClick={onSave}>
                    {t("save")}
                </Button>
            </div>
        </div>
    );
}

export function OrderList({ loading, orders, total, page, onPageChange, compact }: { loading: boolean; orders: TopUpOrder[]; total: number; page: number; onPageChange: (page: number) => void; compact?: boolean }) {
    const t = useTranslations("profile.records");
    const format = useFormatter();
    if (loading) return <LoadingBlock />;
    if (!orders.length) return <CompactEmptyState title={t("emptyOrders")} description={t("emptyOrdersDescription")} />;
    return (
        <div className="divide-y divide-stone-200 dark:divide-stone-800" role="list">
            {orders.map((order) => (
                <div key={order.id} role="listitem" className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 py-1.5 text-xs first:pt-0 last:pb-0 sm:min-h-0 sm:gap-3 sm:px-1 sm:py-3 sm:text-sm">
                    <div className="min-w-0">
                        <div className="truncate font-semibold text-stone-950 dark:text-white">{order.subject}</div>
                        <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] leading-4 text-stone-500 sm:mt-1 sm:gap-2 sm:text-xs dark:text-stone-400">
                            <span className={cn("truncate", compact && "hidden sm:inline")}>{order.orderNo}</span>
                            <span className="shrink-0">{format.dateTime(new Date(order.createdAt), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                        <Tag className="m-0 !px-1 !py-0 text-[10px] leading-[18px] sm:!px-2 sm:text-xs sm:leading-5" color={orderStatusColor(order.status)}>
                            {t(`orderStatuses.${order.status}`)}
                        </Tag>
                        <div className="text-xs font-semibold tabular-nums text-stone-900 dark:text-stone-100 sm:text-[13px]">{formatVnd(order.payableNativeAmount)}</div>
                    </div>
                </div>
            ))}
            {!compact && total > ORDER_PAGE_SIZE ? <Pagination size="small" current={page} pageSize={ORDER_PAGE_SIZE} total={total} showSizeChanger={false} onChange={onPageChange} /> : null}
        </div>
    );
}

export function AccountMetric({ label, value, icon, detail }: { label: string; value: string; icon: ReactNode; detail?: string }) {
    return (
        <div className="rounded-lg bg-stone-50/70 px-2.5 py-2 text-card-foreground xl:rounded-2xl xl:border xl:border-border xl:bg-card xl:p-4 xl:shadow-sm xl:shadow-stone-200/60 dark:bg-stone-900/35 xl:dark:bg-card xl:dark:shadow-black/20">
            <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-stone-500 xl:text-sm dark:text-stone-400">{label}</div>
                <span className="flex size-5 items-center justify-center text-stone-400 xl:size-8 xl:rounded-xl xl:bg-stone-100 xl:text-stone-700 dark:text-stone-500 xl:dark:bg-stone-900 xl:dark:text-stone-200">{icon}</span>
            </div>
            <div className="mt-1 truncate text-sm font-semibold tracking-normal text-stone-950 xl:mt-3 xl:text-xl dark:text-white">{value}</div>
            {detail ? <div className="mt-0.5 truncate text-[10px] text-stone-500 xl:mt-1 xl:text-xs dark:text-stone-400">{detail}</div> : null}
        </div>
    );
}

export function AccountPanel({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children: ReactNode }) {
    return (
        <section className="rounded-lg border border-border bg-card p-2 text-card-foreground sm:rounded-2xl sm:p-5 sm:shadow-[0_12px_40px_rgba(15,23,42,0.07)] dark:sm:shadow-black/20">
            <div className="mb-1.5 flex items-start justify-between gap-3 sm:mb-4">
                <div className="min-w-0">
                    <h2 className="text-base font-semibold text-stone-950 sm:text-lg dark:text-white">{title}</h2>
                    <p className="mt-1 hidden text-sm leading-6 text-stone-500 sm:block dark:text-stone-400">{description}</p>
                </div>
                {action}
            </div>
            {children}
        </section>
    );
}

export function LoadingBlock() {
    return (
        <div className="flex min-h-12 items-center justify-center rounded-lg border border-dashed border-stone-200 sm:min-h-24 dark:border-stone-800">
            <Spin size="small" />
        </div>
    );
}

export function RecordList({ records }: { records: PointRecord[] }) {
    const t = useTranslations("profile.records");
    const format = useFormatter();
    return (
        <div className="divide-y divide-stone-200 dark:divide-stone-800">
            {records.map((record) => {
                const positive = !record.amount.startsWith("-");
                return (
                    <div key={record.id} className="py-1.5 first:pt-0 last:pb-0 sm:px-1 sm:py-3">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="break-words text-sm font-semibold text-stone-900 dark:text-stone-100">{record.description || t(`pointTypes.${record.type}`)}</div>
                                <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">{format.dateTime(new Date(record.createdAt), { dateStyle: "medium", timeStyle: "short" })}</div>
                            </div>
                            <Tag color={positive ? "green" : "red"} className="m-0 shrink-0">
                                {positive ? "+" : ""}
                                {formatCreditAmount(record.amount)}
                            </Tag>
                        </div>
                        <div className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">{t("balanceAfter", { amount: formatCreditAmount(record.balanceAfter) })}</div>
                    </div>
                );
            })}
        </div>
    );
}

export function parseProfileSection(value: string | null): ProfileSectionKey {
    return profileSections.some((section) => section.key === value) ? (value as ProfileSectionKey) : "overview";
}

export function orderStatusColor(status: TopUpOrderStatus) {
    if (status === "pending") return "gold";
    if (status === "paid") return "green";
    if (status === "refunded") return "blue";
    if (status === "refunding") return "orange";
    return "default";
}

function formatVnd(value: string) {
    return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(BigInt(value))} ₫`;
}
