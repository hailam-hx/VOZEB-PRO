"use client";

import { useMemo, useRef, useState } from "react";
import { App, Button, Input, Modal, Pagination } from "antd";
import { BookOpenText, FileText, Search } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { splitDramaSource, type DramaSourceEpisodeDraft } from "@/lib/drama-source-splitter";
import type { DramaProject } from "../types";
import { useDramaStore } from "../stores/use-drama-store";

const IMPORT_PAGE_SIZE = 20;

export function DramaSourceImport({ project, onImported }: { project: DramaProject; onImported: () => void }) {
    const t = useTranslations("drama.editor.sourceImport");
    const sectionsT = useTranslations("drama.sections");
    const format = useFormatter();
    const { message } = App.useApp();
    const importEpisodes = useDramaStore((state) => state.importEpisodes);
    const createVersion = useDramaStore((state) => state.createVersion);
    const inputRef = useRef<HTMLInputElement>(null);
    const [drafts, setDrafts] = useState<DramaSourceEpisodeDraft[]>([]);
    const [fileName, setFileName] = useState("");
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(1);
    const [importing, setImporting] = useState(false);
    const open = drafts.length > 0;
    const totalCharacters = useMemo(() => drafts.reduce((total, draft) => total + draft.script.length, 0), [drafts]);
    const filtered = useMemo(() => {
        const keyword = query.trim().toLocaleLowerCase();
        if (!keyword) return drafts.map((draft, index) => ({ draft, index }));
        return drafts.flatMap((draft, index) => (`${draft.title} ${draft.sourceRange}`.toLocaleLowerCase().includes(keyword) ? [{ draft, index }] : []));
    }, [drafts, query]);
    const visible = filtered.slice((page - 1) * IMPORT_PAGE_SIZE, page * IMPORT_PAGE_SIZE);

    const close = () => {
        setDrafts([]);
        setFileName("");
        setQuery("");
        setPage(1);
    };

    const readSource = async (file?: File) => {
        if (!file) return;
        try {
            const nextDrafts = splitDramaSource(await file.text());
            if (!nextDrafts.length) return message.warning(t("noRecognizableText"));
            setDrafts(nextDrafts);
            setFileName(file.name);
            setQuery("");
            setPage(1);
        } catch {
            message.error(t("failed"));
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    const confirmImport = async () => {
        setImporting(true);
        try {
            await createVersion(project, t("versionReason"));
            importEpisodes(
                project.id,
                drafts.map((draft, index) => ({ ...draft, title: draft.title || sectionsT("episodeNumber", { number: index + 1 }) })),
            );
            close();
            onImported();
            message.success(t("success", { count: drafts.length }));
        } catch {
            message.error(t("failed"));
        } finally {
            setImporting(false);
        }
    };

    return (
        <>
            <Button className="!h-8 !px-2.5" size="small" icon={<BookOpenText className="size-3.5" />} onClick={() => inputRef.current?.click()}>
                {t("button")}
            </Button>
            <input ref={inputRef} type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden" onChange={(event) => void readSource(event.target.files?.[0])} />
            <Modal
                title={t("title")}
                open={open}
                width={720}
                centered
                destroyOnHidden
                mask={{ closable: !importing }}
                closable={!importing}
                okText={t("confirm", { count: drafts.length })}
                cancelText={t("cancel")}
                okButtonProps={{ loading: importing }}
                cancelButtonProps={{ disabled: importing }}
                onOk={() => void confirmImport()}
                onCancel={close}
                styles={{ container: { maxWidth: "calc(100vw - 24px)" }, body: { padding: 0 } }}
            >
                <div className="flex max-h-[min(68vh,640px)] min-h-0 flex-col overflow-hidden">
                    <div className="shrink-0 border-b border-border px-5 py-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                            <span className="flex min-w-0 items-center gap-1.5" title={fileName}>
                                <FileText className="size-3.5 shrink-0" />
                                <span className="max-w-60 truncate text-foreground">{fileName}</span>
                            </span>
                            <span>{t("episodes", { count: format.number(drafts.length) })}</span>
                            <span>{t("characters", { count: format.number(totalCharacters) })}</span>
                            <span>{t("replacementWarning", { count: project.episodes.length })}</span>
                        </div>
                        <Input
                            className="!mt-3 !h-8"
                            allowClear
                            prefix={<Search className="size-3.5 text-muted-foreground" />}
                            value={query}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setPage(1);
                            }}
                            placeholder={t("searchPlaceholder")}
                            aria-label={t("searchAria")}
                        />
                    </div>
                    <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-2" data-drama-import-preview>
                        {visible.length ? (
                            <div className="divide-y divide-border">
                                {visible.map(({ draft, index }) => (
                                    <div key={`${index}-${draft.title}`} className="grid min-w-0 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2 px-2 py-2.5">
                                        <span className="text-xs font-medium tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                                        <span className="min-w-0">
                                            <span className="block truncate text-sm font-medium">{draft.title || t("episodeNumber", { number: index + 1 })}</span>
                                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{draft.sourceRange || t("automaticRange")}</span>
                                        </span>
                                        <span className="text-xs tabular-nums text-muted-foreground">{t("characters", { count: format.number(draft.script.length) })}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="grid min-h-40 place-items-center text-sm text-muted-foreground">{t("noMatches")}</div>
                        )}
                    </div>
                    {filtered.length > IMPORT_PAGE_SIZE ? (
                        <div className="flex shrink-0 justify-end border-t border-border px-4 py-2.5">
                            <Pagination size="small" current={page} pageSize={IMPORT_PAGE_SIZE} total={filtered.length} showSizeChanger={false} showLessItems onChange={setPage} />
                        </div>
                    ) : null}
                </div>
            </Modal>
        </>
    );
}
