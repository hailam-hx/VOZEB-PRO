import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Database, Eye, FileDown, MailCheck, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getPublicSiteSettings } from "@/lib/server/site-metadata";

const highlightIcons = [Eye, Sparkles, FileDown] as const;
const sectionParagraphCounts = [4, 2, 3, 2, 2, 3, 3] as const;

export async function generateMetadata(): Promise<Metadata> {
    const [site, t] = await Promise.all([getPublicSiteSettings(), getTranslations("public.privacy")]);
    return {
        title: t("title"),
        description: t("metadataDescription", { site: site.title }),
        alternates: { canonical: "/privacy" },
    };
}

export default async function PrivacyPage() {
    const [site, t] = await Promise.all([getPublicSiteSettings(), getTranslations("public.privacy")]);
    const highlights = highlightIcons.map((icon, index) => ({ icon, title: t(`highlights.${index}.title`), body: t(`highlights.${index}.body`) }));
    const sections = sectionParagraphCounts.map((count, index) => ({ title: t(`sections.${index}.title`), paragraphs: Array.from({ length: count }, (_, paragraph) => t(`sections.${index}.paragraphs.${paragraph}`)) }));
    return (
        <main className="app-scroll-page bg-[#f7f8fa] text-stone-800 dark:bg-[#0f1114] dark:text-stone-200">
            <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-8 sm:py-8">
                <Link
                    href="/"
                    className="inline-flex h-9 items-center gap-2 rounded-full border border-stone-200 bg-white px-3.5 text-sm font-medium text-stone-700 transition hover:border-emerald-300 hover:text-emerald-700 dark:border-white/10 dark:bg-white/5 dark:text-stone-200 dark:hover:border-emerald-500/50 dark:hover:text-emerald-200"
                >
                    <ArrowLeft className="size-4" />
                    {t("backHome")}
                </Link>

                <article className="mt-5 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,.08)] dark:border-white/10 dark:bg-[#15181c] dark:shadow-black/30">
                    <header className="bg-[#101211] px-5 py-8 text-white sm:px-9 sm:py-10">
                        <div className="inline-flex items-center gap-2 text-sm font-medium text-emerald-200">
                            <ShieldCheck className="size-4" />
                            {t("eyebrow")}
                        </div>
                        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{t("title")}</h1>
                        <p className="mt-4 max-w-3xl text-sm leading-7 text-stone-300 sm:text-base">{t("intro", { site: site.title })}</p>
                        <p className="mt-5 text-xs text-stone-400">{t("effectiveDate")}</p>
                    </header>

                    <div className="grid gap-3 border-b border-stone-200 p-4 sm:grid-cols-3 sm:p-6 dark:border-white/10">
                        {highlights.map(({ title, body, icon: Icon }) => (
                            <section key={title} className="rounded-lg border border-stone-200 bg-stone-50 p-4 dark:border-white/10 dark:bg-white/[0.035]">
                                <Icon className="size-5 text-emerald-600 dark:text-emerald-300" />
                                <h2 className="mt-3 text-sm font-semibold text-stone-950 dark:text-white">{title}</h2>
                                <p className="mt-1.5 text-xs leading-5 text-stone-600 dark:text-stone-400">{body}</p>
                            </section>
                        ))}
                    </div>

                    <div className="divide-y divide-stone-200 px-5 sm:px-9 dark:divide-white/10">
                        {sections.map((section, index) => (
                            <section key={section.title} className="grid gap-3 py-6 sm:grid-cols-[44px_minmax(0,1fr)] sm:py-8">
                                <span className="grid size-8 place-items-center rounded-full bg-emerald-50 text-xs font-semibold text-emerald-700 dark:bg-emerald-300/10 dark:text-emerald-300">{String(index + 1).padStart(2, "0")}</span>
                                <div>
                                    <h2 className="text-lg font-semibold text-stone-950 dark:text-white">{section.title}</h2>
                                    <div className="mt-3 space-y-3 text-sm leading-7 text-stone-600 dark:text-stone-400">
                                        {section.paragraphs.map((paragraph) => (
                                            <p key={paragraph}>{paragraph}</p>
                                        ))}
                                    </div>
                                </div>
                            </section>
                        ))}
                    </div>

                    <footer className="grid gap-3 border-t border-stone-200 bg-stone-50 px-5 py-5 text-xs leading-5 text-stone-600 sm:grid-cols-3 sm:px-9 dark:border-white/10 dark:bg-white/[0.025] dark:text-stone-400">
                        <span className="flex items-start gap-2">
                            <Database className="mt-0.5 size-4 shrink-0" />
                            {t("footer.scopedAccess")}
                        </span>
                        <span className="flex items-start gap-2">
                            <MailCheck className="mt-0.5 size-4 shrink-0" />
                            {t("footer.verificationCodes")}
                        </span>
                        <span className="flex items-start gap-2">
                            <Trash2 className="mt-0.5 size-4 shrink-0" />
                            {t("footer.deletion")}
                        </span>
                    </footer>
                </article>
            </div>
        </main>
    );
}
