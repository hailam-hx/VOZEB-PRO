"use client";

import { App, Button, Empty, Input, QRCode, Spin, Tag } from "antd";
import { ArrowLeft, Check, CheckCircle2, Copy, CreditCard, ExternalLink, FileText, Landmark, LockKeyhole, QrCode, ShieldCheck, WalletCards } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { TopUpPresetGrid } from "@/components/billing/top-up-preset-grid";
import { CreditSymbol, formatCreditAmount } from "@/constant/credits";
import { useCopyText } from "@/hooks/use-copy-text";
import { createTopUpCheckout, createTopUpOrder, listTopUpPresets, quoteTopUpOrder, type PaymentCheckout, type TopUpPreset, type TopUpQuote, type TopUpSelection } from "@/services/api/billing";
import { openPaymentCheckoutWindow } from "./payment-checkout-window";

const providerOptions = [
    { value: "stripe", icon: CreditCard },
    { value: "alipay", icon: Landmark },
    { value: "wechat", icon: QrCode },
    { value: "payply", icon: WalletCards },
    { value: "manual", icon: FileText },
] as const;

type CheckoutProps = { initialPresetId?: string; initialAmountVnd?: string; promotionId?: string; userCouponId?: string };

export function BillingCheckoutPage({ initialPresetId, initialAmountVnd, promotionId, userCouponId }: CheckoutProps) {
    const t = useTranslations("billing.checkout");
    const router = useRouter();
    const { message } = App.useApp();
    const copyText = useCopyText();
    const [presets, setPresets] = useState<TopUpPreset[]>([]);
    const [providers, setProviders] = useState<string[]>([]);
    const [provider, setProvider] = useState("");
    const [presetId, setPresetId] = useState(initialAmountVnd ? "" : initialPresetId || "");
    const [customAmount, setCustomAmount] = useState(initialAmountVnd || "");
    const [customMode, setCustomMode] = useState(Boolean(initialAmountVnd));
    const [quote, setQuote] = useState<TopUpQuote | null>(null);
    const [loading, setLoading] = useState(true);
    const [quoteLoading, setQuoteLoading] = useState(false);
    const [quoteError, setQuoteError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [checkout, setCheckout] = useState<PaymentCheckout | null>(null);
    const quoteRequest = useRef(0);

    const selection = useMemo<TopUpSelection | null>(() => {
        const discountIds = { ...(promotionId ? { promotionId } : {}), ...(userCouponId ? { userCouponId } : {}) };
        if (customMode) return /^[1-9]\d*$/.test(customAmount) ? { customAmountVnd: customAmount, ...discountIds } : null;
        return presetId ? { presetId, ...discountIds } : null;
    }, [customAmount, customMode, presetId, promotionId, userCouponId]);
    const availableProviders = useMemo(() => providerOptions.filter((item) => providers.includes(item.value)), [providers]);

    useEffect(() => {
        let active = true;
        void listTopUpPresets()
            .then((payload) => {
                if (!active) return;
                setPresets(payload.presets);
                setProviders(payload.paymentProviders);
                setProvider(payload.paymentProviders[0] || "");
                if (!customMode) setPresetId((current) => (payload.presets.some((item) => item.id === current) ? current : payload.presets[0]?.id || ""));
            })
            .catch(() => message.error(t("errors.paymentInfoFailed")))
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [customMode, message, t]);

    useEffect(() => {
        const requestId = ++quoteRequest.current;
        setCheckout(null);
        setQuote(null);
        setQuoteError("");
        if (!selection) return;
        setQuoteLoading(true);
        void quoteTopUpOrder(selection)
            .then((payload) => {
                if (quoteRequest.current === requestId) setQuote(payload.quote);
            })
            .catch((error: unknown) => {
                if (quoteRequest.current === requestId) setQuoteError(error instanceof Error ? error.message : t("errors.quoteFailed"));
            })
            .finally(() => {
                if (quoteRequest.current === requestId) setQuoteLoading(false);
            });
    }, [selection, t]);

    const submit = async () => {
        if (!selection || !provider || !quote) return;
        setSubmitting(true);
        try {
            const created = await createTopUpOrder({ ...selection, provider });
            const result = await createTopUpCheckout(created.order.id);
            setCheckout(result.checkout);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("errors.createOrderFailed"));
        } finally {
            setSubmitting(false);
        }
    };

    const continuePayment = () => {
        if (!checkout) return;
        const result = openPaymentCheckoutWindow(checkout);
        if (result.status === "blocked" || result.status === "invalid") {
            if (result.fallbackValue) copyText(result.fallbackValue, t(result.status === "blocked" ? "paymentCopiedBlocked" : "paymentCopied"));
            message.warning(t(result.status === "blocked" ? "windowBlocked" : "invalidPaymentUrl"));
            return;
        }
        if (result.status === "manual") message.info(t("manualConfirmation"));
        router.push(`/billing/success?orderId=${encodeURIComponent(checkout.orderId)}`);
    };

    if (loading)
        return (
            <CheckoutShell>
                <Spin />
            </CheckoutShell>
        );
    if (!presets.length && !customMode)
        return (
            <CheckoutShell>
                <Empty description={t("presetUnavailable")} />
                <Button className="mt-4" onClick={() => setCustomMode(true)}>
                    {t("customAmount")}
                </Button>
            </CheckoutShell>
        );

    return (
        <main className="h-full min-h-0 overflow-y-auto overflow-x-hidden bg-[#f4f5f2] px-2 py-2 text-stone-950 sm:px-6 sm:py-8 dark:bg-[#0f1012] dark:text-stone-100">
            <div className="mx-auto w-full max-w-6xl pb-[calc(1rem+env(safe-area-inset-bottom))]">
                <header className="mb-3 flex items-center justify-between gap-2 sm:mb-5">
                    <Link
                        href="/profile?section=billing"
                        className="inline-flex h-9 items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 text-sm font-semibold text-stone-700 hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200 dark:hover:bg-stone-900"
                    >
                        <ArrowLeft className="size-4" /> {t("backToTopUp")}
                    </Link>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300">
                        <ShieldCheck className="size-3.5 text-emerald-600" /> {t("secureCheckout")}
                    </span>
                </header>

                <div className="grid overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm lg:grid-cols-[1.05fr_.95fr] dark:border-stone-800 dark:bg-stone-950">
                    <section className="min-w-0 border-b border-stone-200 p-3 sm:p-6 lg:border-b-0 lg:border-r dark:border-stone-800">
                        <p className="text-xs font-semibold tracking-[.16em] text-stone-400">TOP UP</p>
                        <h1 className="mt-2 text-xl font-semibold sm:text-2xl">{t("title")}</h1>
                        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{t("description")}</p>
                        <div className="mt-5">
                            <TopUpPresetGrid
                                presets={presets}
                                selectedPresetId={customMode ? undefined : presetId}
                                customSelected={customMode}
                                onSelectPreset={(preset) => {
                                    setCustomMode(false);
                                    setPresetId(preset.id);
                                }}
                                onSelectCustom={() => setCustomMode(true)}
                            />
                        </div>
                        {customMode ? (
                            <label className="mt-4 block rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/60">
                                <span className="text-sm font-semibold">{t("customAmount")}</span>
                                <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">{t("customAmountHint")}</span>
                                <Input
                                    className="mt-3"
                                    inputMode="numeric"
                                    value={customAmount}
                                    status={customAmount && !selection ? "error" : undefined}
                                    suffix="VND"
                                    aria-label={t("customAmount")}
                                    onChange={(event) => setCustomAmount(event.target.value.replace(/\D/g, ""))}
                                />
                            </label>
                        ) : null}
                        <div className="mt-5 rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/60" aria-live="polite">
                            {quoteLoading ? (
                                <div className="flex items-center gap-2 text-sm text-stone-500">
                                    <Spin size="small" /> {t("calculating")}
                                </div>
                            ) : quoteError ? (
                                <p className="text-sm text-rose-600 dark:text-rose-300">{quoteError}</p>
                            ) : quote ? (
                                <QuoteSummary quote={quote} />
                            ) : (
                                <p className="text-sm text-stone-500">{t("selectAmount")}</p>
                            )}
                        </div>
                    </section>

                    <section className="min-w-0 p-3 sm:p-6">
                        {!checkout ? (
                            <>
                                <div className="flex flex-wrap items-center gap-2">
                                    <h2 className="text-lg font-semibold sm:text-xl">{t("selectPaymentMethod")}</h2>
                                    <Tag color="green">
                                        <LockKeyhole className="mr-1 inline size-3" />
                                        {t("encrypted")}
                                    </Tag>
                                </div>
                                <div className="mt-4 space-y-2">
                                    {availableProviders.map(({ value, icon: Icon }) => {
                                        const selected = provider === value;
                                        return (
                                            <button
                                                key={value}
                                                type="button"
                                                aria-pressed={selected}
                                                onClick={() => setProvider(value)}
                                                className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${selected ? "border-stone-950 bg-stone-50 ring-1 ring-stone-950 dark:border-stone-200 dark:bg-stone-900 dark:ring-stone-200" : "border-stone-200 hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"}`}
                                            >
                                                <span
                                                    className={`grid size-10 shrink-0 place-items-center rounded-xl ${selected ? "bg-stone-950 text-white dark:bg-white dark:text-stone-950" : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"}`}
                                                >
                                                    <Icon className="size-5" />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-sm font-semibold">{t(`providers.${value}.label`)}</span>
                                                    <span className="block text-xs text-stone-500 dark:text-stone-400">{t(`providers.${value}.description`)}</span>
                                                </span>
                                                <span className={`grid size-5 place-items-center rounded-full border ${selected ? "border-emerald-600 bg-emerald-600 text-white" : "border-stone-300 text-transparent dark:border-stone-700"}`}>
                                                    <Check className="size-3" />
                                                </span>
                                            </button>
                                        );
                                    })}
                                    {!availableProviders.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("noPaymentProvider")} /> : null}
                                </div>
                                <Button block type="primary" size="large" className="profile-primary-button mt-5 !h-11" loading={submitting} disabled={!provider || !quote || quoteLoading || Boolean(quoteError)} onClick={() => void submit()}>
                                    <LockKeyhole className="mr-1 inline size-4" /> {t("confirmAndPay")}
                                </Button>
                                <p className="mt-3 text-center text-xs leading-5 text-stone-500 dark:text-stone-400">{t("paymentRequiredNotice")}</p>
                            </>
                        ) : (
                            <div className="flex min-h-72 flex-col items-center justify-center text-center">
                                <span className="grid size-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300">
                                    <CheckCircle2 className="size-7" />
                                </span>
                                <h2 className="mt-4 text-xl font-semibold">{t("orderCreated")}</h2>
                                <p className="mt-2 break-all text-sm text-stone-500">{t("orderNumber", { number: checkout.orderNo })}</p>
                                {checkout.qrContent ? <QRCode className="mt-5" value={checkout.qrContent} size={180} /> : null}
                                <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
                                    <Button icon={<Copy className="size-4" />} onClick={() => copyText(checkout.qrContent || checkout.url || checkout.orderNo, t("paymentCopied"))}>
                                        {t("copyPaymentInfo")}
                                    </Button>
                                    <Button type="primary" className="profile-primary-button" icon={<ExternalLink className="size-4" />} onClick={continuePayment}>
                                        {checkout.kind === "manual" ? t("viewInstructions") : t("goToPayment")}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </main>
    );
}

function CheckoutShell({ children }: { children: React.ReactNode }) {
    return (
        <main className="grid h-full min-h-0 place-items-center overflow-y-auto overflow-x-hidden bg-[#f4f5f2] px-3 py-6 dark:bg-[#0f1012]">
            <div className="w-full max-w-lg rounded-2xl border border-stone-200 bg-white p-6 text-center dark:border-stone-800 dark:bg-stone-950">{children}</div>
        </main>
    );
}

function QuoteSummary({ quote }: { quote: TopUpQuote }) {
    const t = useTranslations("billing.checkout");
    return (
        <div className="space-y-2 text-sm">
            <QuoteRow label={t("nominalAmount")} value={formatVnd(quote.nominalNativeAmount)} />
            {quote.promotionDiscountNativeAmount !== "0" ? <QuoteRow label={quote.promotion?.label || t("promotionDiscount")} value={`− ${formatVnd(quote.promotionDiscountNativeAmount)}`} /> : null}
            {quote.couponDiscountNativeAmount !== "0" ? <QuoteRow label={quote.coupon ? t("couponApplied") : t("coupon")} value={`− ${formatVnd(quote.couponDiscountNativeAmount)}`} /> : null}
            <QuoteRow label={t("amountDue")} value={formatVnd(quote.payableNativeAmount)} strong />
            <QuoteRow label={t("topUpCredits")} value={`${formatCreditAmount(quote.creditAmount)} ${t("creditsUnit")}`} icon={<CreditSymbol />} strong />
            <p className="border-t border-stone-200 pt-2 text-xs text-stone-500 dark:border-stone-700 dark:text-stone-400">{t("quoteSnapshot", { version: quote.pricingVersion })}</p>
        </div>
    );
}

function QuoteRow({ label, value, strong, icon }: { label: string; value: string; strong?: boolean; icon?: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="text-stone-500 dark:text-stone-400">{label}</span>
            <span className={`inline-flex items-center gap-1 text-right tabular-nums ${strong ? "font-semibold text-stone-950 dark:text-white" : "font-medium"}`}>
                {icon}
                {value}
            </span>
        </div>
    );
}

function formatVnd(value: string) {
    return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(BigInt(value))} ₫`;
}
