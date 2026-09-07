"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Sparkles } from "lucide-react";

import { useHomeActions } from "@/app/home/home-actions";
import type { SeoLandingDefinition } from "./seo-landing-data";
import styles from "./seo-landing.module.css";

export function SeoLandingActions({ definition, compact = false }: { definition: SeoLandingDefinition; compact?: boolean }) {
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
                <h2>{definition.slug === "voice-cloning" ? "Quản lý hồ sơ giọng trong workspace riêng" : "Bắt đầu trong workspace sản xuất phim ngắn"}</h2>
                <p>{definition.slug === "voice-cloning" ? "Tải mẫu, xác nhận quyền sử dụng và theo dõi trạng thái sau khi đăng nhập." : "Tạo dự án, tổ chức tài sản và phát triển từng tập trong cùng một quy trình."}</p>
                <button type="button" className={styles.primaryCta} onClick={openDestination} data-testid="seo-primary-cta">
                    {definition.cta.label}
                    <ArrowRight aria-hidden="true" />
                </button>
                {definition.slug === "voice-cloning" ? <small>Không sử dụng mẫu giọng nếu chưa có sự đồng ý phù hợp.</small> : null}
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
                    <strong>Bắt đầu từ một brief</strong>
                    <small>HOTX AI sẽ mở đúng chế độ sáng tạo</small>
                </div>
            </div>
            <label htmlFor={`seo-prompt-${definition.slug}`}>{definition.prompt.label}</label>
            <textarea id={`seo-prompt-${definition.slug}`} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={definition.prompt.placeholder} rows={6} />
            <div className={styles.promptExamples} aria-label="Gợi ý nhanh">
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
            <small>Bạn có thể chỉnh sửa brief và thêm tài liệu tham chiếu sau khi vào workspace.</small>
        </form>
    );
}
