"use client";

import { useRef, useState } from "react";
import { AudioLines, Image as ImageIcon, Lightbulb, Paperclip, Send, Video } from "lucide-react";
import { useTranslations } from "next-intl";

import { HOME_CREATION_MODES, type HomeCreationMode } from "./home-data";
import { useHomeActions } from "./home-actions";
import styles from "./home-agent-hero.module.css";

const modeIcons = {
    agent: Lightbulb,
    image: ImageIcon,
    video: Video,
    audio: AudioLines,
} as const;

export function HomeAgentHero() {
    const t = useTranslations("home");
    const [prompt, setPrompt] = useState("");
    const [mode, setMode] = useState<HomeCreationMode>("agent");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const { startCreating } = useHomeActions();
    const currentMode = HOME_CREATION_MODES.find((item) => item.id === mode) ?? HOME_CREATION_MODES[0];

    const submit = () => {
        if (!prompt.trim()) {
            textareaRef.current?.focus();
            return;
        }
        startCreating(prompt, mode);
    };

    return (
        <section className={styles.hero} aria-labelledby="home-hero-title">
            <span className={`${styles.floatingArtifact} ${styles.artifactAgent}`} data-hero-decoration aria-hidden="true">
                <span className={styles.artifactFace}>
                    <Lightbulb />
                </span>
            </span>
            <span className={`${styles.floatingArtifact} ${styles.artifactImage}`} data-hero-decoration aria-hidden="true">
                <span className={styles.artifactFace}>
                    <ImageIcon />
                </span>
            </span>
            <span className={`${styles.floatingArtifact} ${styles.artifactVideo}`} data-hero-decoration aria-hidden="true">
                <span className={styles.artifactFace}>
                    <Video />
                </span>
            </span>
            <span className={`${styles.floatingArtifact} ${styles.artifactAudio}`} data-hero-decoration aria-hidden="true">
                <span className={styles.artifactFace}>
                    <AudioLines />
                </span>
            </span>
            <div className={styles.heroContent}>
                <h1 id="home-hero-title" className={styles.heroTitle}>
                    {t("heroTitleLead")} <span>{t("heroTitleAccent")}</span>
                </h1>
                <p className={styles.heroSubtitle}>{t("heroSubtitle")}</p>

                <div className={styles.agentStage}>
                    <div className={styles.agentRing} data-testid="home-agent-halo" aria-hidden="true">
                        <span className={styles.ringGround} data-halo-ring />
                        <span className={styles.ringOuter} data-halo-ring />
                        <span className={styles.ringMiddle} data-halo-ring />
                        <span className={styles.ringInner} data-halo-ring />
                    </div>
                    <div className={styles.agentCard} data-testid="home-agent-card">
                        <div className={styles.inputArea}>
                            <label htmlFor="home-agent-prompt" className={styles.srOnly}>
                                {t("promptLabel")}
                            </label>
                            <textarea
                                ref={textareaRef}
                                id="home-agent-prompt"
                                value={prompt}
                                onChange={(event) => setPrompt(event.target.value)}
                                onKeyDown={(event) => {
                                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit();
                                }}
                                className={styles.agentTextarea}
                                placeholder={t("promptPlaceholder")}
                                rows={3}
                            />
                        </div>

                        <div className={styles.promptExamples} aria-label={t("promptExamples")}>
                            {currentMode.exampleKeys.map((key) => {
                                const example = t(key);
                                return (
                                    <button key={key} type="button" onClick={() => setPrompt(example)}>
                                        {example}
                                    </button>
                                );
                            })}
                        </div>

                        <div className={styles.agentToolbar}>
                            <div className={styles.creationModes} role="group" aria-label={t("creationModes")}>
                                {HOME_CREATION_MODES.map((item) => {
                                    const Icon = modeIcons[item.icon];
                                    const label = t(item.labelKey);
                                    return (
                                        <button key={item.id} type="button" className={mode === item.id ? styles.modeActive : undefined} onClick={() => setMode(item.id)} aria-label={label} title={label} aria-pressed={mode === item.id}>
                                            <span className={styles.modeIcon}>
                                                <Icon aria-hidden="true" />
                                            </span>
                                            <span className={styles.modeLabel}>{label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            <div className={styles.agentTools}>
                                <button type="button" aria-label={t("addReference")} title={t("addReference")} onClick={() => startCreating(prompt, mode)}>
                                    <Paperclip aria-hidden="true" />
                                </button>
                                <button type="button" className={styles.sendButton} aria-label={t("startCreating")} title={t("startCreating")} onClick={submit}>
                                    <Send aria-hidden="true" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
