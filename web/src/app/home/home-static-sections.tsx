import { Cloud, Grid2X2, History, Layers3, Network, PencilLine, Rocket, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { HOME_ADVANTAGES, HOME_STEPS } from "./home-data";
import styles from "./home.module.css";

const stepIcons = { grid: Grid2X2, edit: PencilLine, rocket: Rocket, share: Share2 } as const;
const advantageIcons = { layers: Layers3, network: Network, history: History, cloud: Cloud } as const;

export function HomeStepsSection() {
    const t = useTranslations("home");
    return (
        <section className={styles.section} aria-labelledby="home-steps-title">
            <SectionHeading id="home-steps-title" title={t("stepsTitle")} subtitle={t("stepsSubtitle")} />
            <div className={styles.stepsGrid}>
                {HOME_STEPS.map((step) => {
                    const Icon = stepIcons[step.icon];
                    return (
                        <article key={step.number} className={styles.stepCard}>
                            <span className={styles.stepNumber}>{step.number}</span>
                            <div>
                                <h3>{t(step.titleKey)}</h3>
                                <p>{t(step.descriptionKey)}</p>
                            </div>
                            <Icon aria-hidden="true" />
                        </article>
                    );
                })}
            </div>
        </section>
    );
}

export function HomeAdvantagesSection() {
    const t = useTranslations("home");
    return (
        <section className={styles.advantages} aria-label={t("advantages")}>
            {HOME_ADVANTAGES.map((advantage) => {
                const Icon = advantageIcons[advantage.icon];
                return (
                    <article key={advantage.titleKey}>
                        <span>
                            <Icon aria-hidden="true" />
                        </span>
                        <div>
                            <h3>{t(advantage.titleKey)}</h3>
                            <p>{t(advantage.descriptionKey)}</p>
                        </div>
                    </article>
                );
            })}
        </section>
    );
}

function SectionHeading({ id, title, subtitle }: { id: string; title: string; subtitle: string }) {
    return (
        <header className={styles.sectionHeading}>
            <h2 id={id}>{title}</h2>
            <p>{subtitle}</p>
        </header>
    );
}
