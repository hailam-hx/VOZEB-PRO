import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown } from "lucide-react";

import type { SeoLandingDefinition } from "./seo-landing-data";
import { getSeoLandingDefinition } from "./seo-landing-data";
import { getSeoPagePath } from "@/i18n/routing";
import type { AppLocale } from "@/i18n/config";
import { landingUi } from "./content/ui";
import styles from "./seo-landing.module.css";

export function SeoLandingContent({ definition, actions, finalAction, locale = "vi" }: { definition: SeoLandingDefinition; actions: ReactNode; finalAction?: ReactNode; locale?: AppLocale }) {
    const t = landingUi[locale];
    return (
        <>
            <section className={styles.hero} aria-labelledby="seo-landing-title">
                <div className={styles.heroGlow} aria-hidden="true" />
                <div className={styles.container}>
                    <nav className={styles.breadcrumb} aria-label={t.breadcrumb}>
                        {getSeoPagePath("home", locale) ? <Link href={getSeoPagePath("home", locale)!}>{t.home}</Link> : null}
                        <span aria-hidden="true">/</span>
                        <span aria-current="page">{definition.primaryKeyword}</span>
                    </nav>
                    <div className={styles.heroGrid}>
                        <div className={styles.heroCopy}>
                            <p className={styles.eyebrow}>{definition.eyebrow}</p>
                            <h1 id="seo-landing-title">{definition.h1}</h1>
                            <p className={styles.heroDescription}>{definition.description}</p>
                            <p className={styles.heroNote}>
                                <Check aria-hidden="true" />
                                {definition.heroNote}
                            </p>
                            <div className={styles.keywordList} aria-label={t.topics}>
                                {definition.secondaryKeywords.map((keyword) => (
                                    <span key={keyword}>{keyword}</span>
                                ))}
                            </div>
                        </div>
                        <div className={styles.heroActions}>{actions}</div>
                    </div>
                </div>
            </section>

            <section className={styles.showcase} data-seo-section="showcase" aria-labelledby="seo-showcase-title">
                <div className={styles.container}>
                    <SectionHeading eyebrow={t.workspace} title={definition.showcaseTitle} description={definition.showcaseDescription} id="seo-showcase-title" />
                    <div className={styles.visualFrame}>
                        <div className={styles.visualBar} aria-hidden="true">
                            <span />
                            <span />
                            <span />
                            <strong>HOTX AI</strong>
                        </div>
                        <Image
                            src={definition.visual.src}
                            alt={definition.visual.alt}
                            width={definition.visual.width}
                            height={definition.visual.height}
                            className={styles.visualImage}
                            sizes="(max-width: 767px) calc(100vw - 28px), (max-width: 1380px) calc(100vw - 64px), 1316px"
                        />
                    </div>
                </div>
            </section>

            <section className={styles.section} data-seo-section="use-cases" aria-labelledby="seo-use-cases-title">
                <div className={styles.container}>
                    <SectionHeading eyebrow={t.uses} title={definition.useCasesTitle} description={definition.useCasesDescription} id="seo-use-cases-title" />
                    <div className={styles.cardGrid}>
                        {definition.useCases.map((item, index) => (
                            <article key={item.title} className={styles.infoCard}>
                                <span className={styles.cardIndex}>{String(index + 1).padStart(2, "0")}</span>
                                <h3>{item.title}</h3>
                                <p>{item.description}</p>
                            </article>
                        ))}
                    </div>
                </div>
            </section>

            <section className={`${styles.section} ${styles.stepsSection}`} data-seo-section="steps" aria-labelledby="seo-steps-title">
                <div className={styles.container}>
                    <SectionHeading eyebrow={t.steps} title={definition.stepsTitle} description={definition.stepsDescription} id="seo-steps-title" />
                    <ol className={styles.stepsList}>
                        {definition.steps.map((step, index) => (
                            <li key={step.title}>
                                <span>{index + 1}</span>
                                <div>
                                    <h3>{step.title}</h3>
                                    <p>{step.description}</p>
                                </div>
                            </li>
                        ))}
                    </ol>
                </div>
            </section>

            <section className={styles.section} data-seo-section="capabilities" aria-labelledby="seo-capabilities-title">
                <div className={styles.container}>
                    <SectionHeading eyebrow={t.capabilities} title={definition.capabilitiesTitle} description={definition.capabilitiesDescription} id="seo-capabilities-title" />
                    <div className={styles.capabilityGrid}>
                        {definition.capabilities.map((capability) => (
                            <article key={capability.title}>
                                <span aria-hidden="true">
                                    <Check />
                                </span>
                                <div>
                                    <h3>{capability.title}</h3>
                                    <p>{capability.description}</p>
                                </div>
                            </article>
                        ))}
                    </div>
                </div>
            </section>

            <section className={`${styles.section} ${styles.faqSection}`} data-seo-section="faq" aria-labelledby="seo-faq-title">
                <div className={styles.narrowContainer}>
                    <SectionHeading eyebrow={t.faq} title={`${t.faqTitle} ${definition.primaryKeyword}`} id="seo-faq-title" />
                    <div className={styles.faqList}>
                        {definition.faqs.map((faq) => (
                            <details key={faq.question}>
                                <summary>
                                    <span>{faq.question}</span>
                                    <ChevronDown aria-hidden="true" />
                                </summary>
                                <p>{faq.answer}</p>
                            </details>
                        ))}
                    </div>
                </div>
            </section>

            <section className={styles.section} data-seo-section="related" aria-labelledby="seo-related-title">
                <div className={styles.container}>
                    <SectionHeading eyebrow={t.related} title={t.relatedTitle} id="seo-related-title" />
                    <div className={styles.relatedGrid}>
                        {definition.related.map((slug) => {
                            const related = getSeoLandingDefinition(slug, locale);
                            const href = getSeoPagePath(slug, locale);
                            if (!related || !href) return null;
                            return (
                                <Link key={slug} href={href}>
                                    <span>{related.eyebrow}</span>
                                    <h3>{related.h1}</h3>
                                    <p>{related.description}</p>
                                    <strong>
                                        {t.explore} <ArrowRight aria-hidden="true" />
                                    </strong>
                                </Link>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section className={styles.finalCta} aria-labelledby="seo-final-cta-title">
                <div className={styles.finalCtaGlow} aria-hidden="true" />
                <div>
                    <p className={styles.eyebrow}>{t.start}</p>
                    <h2 id="seo-final-cta-title">{definition.finalCtaTitle}</h2>
                    <p>{definition.finalCtaDescription}</p>
                    <div className={styles.finalCtaAction}>{finalAction ?? actions}</div>
                </div>
            </section>
        </>
    );
}

function SectionHeading({ eyebrow, title, description, id }: { eyebrow: string; title: string; description?: string; id: string }) {
    return (
        <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h2 id={id}>{title}</h2>
            {description ? <p>{description}</p> : null}
        </div>
    );
}
