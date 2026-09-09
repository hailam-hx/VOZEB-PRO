"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Sparkles } from "lucide-react";

import { useHomeActions } from "@/app/home/home-actions";
import type { SeoLandingDefinition } from "./seo-landing-data";
import type { AppLocale } from "@/i18n/config";
import { landingUi } from "./content/ui";
import styles from "./seo-landing.module.css";

export function SeoLandingActions({ definition, compact = false, locale = "vi" }: { definition: SeoLandingDefinition; compact?: boolean; locale?: AppLocale }) {
    const t = landingUi[locale];
    const { openProtectedPath, startCreating } = useHomeActions();
    const [prompt, setPrompt] = useState("");

    const openDestination = () => {
        if (definition.cta.kind === "create") {
            if (definition.cta.mode === "agent" && !prompt.trim()) openProtectedPath("/create");
            else startCreating(prompt.trim(), definition.cta.mode);
        } else openProtectedPath(definition.cta.href);
    };

    const submit = (event: FormEvent) => {
        event.preventDefault();
        openDestination();
    };

    if (compact) {
        return (
            <button type="button" className={styles.compactCta} onClick={openDestination} data-testid="seo-final-cta">
                {definition.cta.label}
                <ArrowRight aria-hidden="true" />
            </button>
        );
    }

    if (!definition.prompt) {
        return (
            <div className={styles.workspaceCard}>
                <span className={styles.workspaceIcon} aria-hidden="true">
                    <Sparkles />
                </span>
                <h2>{definition.slug === "voice-cloning" ? t.voiceTitle : t.dramaTitle}</h2>
                <p>{definition.slug === "voice-cloning" ? t.voiceDescription : t.dramaDescription}</p>
                <button type="button" className={styles.primaryCta} onClick={openDestination} data-testid="seo-primary-cta">
                    {definition.cta.label}
                    <ArrowRight aria-hidden="true" />
                </button>
                {definition.slug === "voice-cloning" ? <small>{t.consent}</small> : null}
            </div>
        );
    }

    return (
        <form className={styles.promptCard} onSubmit={submit} data-testid="seo-landing-prompt">
            <div className={styles.promptCardHeader}>
                <span aria-hidden="true">
                    <Sparkles />
                </span>
                <div>
                    <strong>{t.brief}</strong>
                    <small>{t.mode}</small>
                </div>
            </div>
            <label htmlFor={`seo-prompt-${definition.slug}`}>{definition.prompt.label}</label>
            <textarea id={`seo-prompt-${definition.slug}`} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={definition.prompt.placeholder} rows={6} />
            <div className={styles.promptExamples} aria-label={t.suggestions}>
                {definition.prompt.examples.map((example) => (
                    <button key={example} type="button" onClick={() => setPrompt(example)}>
                        {example}
                    </button>
                ))}
            </div>
            <button type="submit" className={styles.primaryCta} data-testid="seo-primary-cta">
                {definition.cta.label}
                <ArrowRight aria-hidden="true" />
            </button>
            <small>{t.edit}</small>
        </form>
    );
}
