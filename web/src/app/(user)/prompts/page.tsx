"use client";

import { FolderPlus, RotateCcw, Search } from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { App, Button, Input, Pagination, Select, Spin } from "antd";
import { useTranslations } from "next-intl";

import { PromptCard } from "@/components/prompts/prompt-card";
import { CompactEmptyState } from "@/components/compact-empty-state";
import { PromptDetailDialog } from "@/components/prompts/prompt-detail-dialog";
import { usePromptPage } from "@/components/prompts/use-prompt-list";
import { useCopyText } from "@/hooks/use-copy-text";
import { useAssetStore } from "@/stores/use-asset-store";
import { ALL_PROMPTS_OPTION, type Prompt } from "@/services/api/prompts";

const PAGE_SIZE = 16;

export default function PromptsPage() {
    const t = useTranslations("media.promptLibrary");
    const { message } = App.useApp();
    const [titleKeyword, setTitleKeyword] = useState("");
    const [selectedTag, setSelectedTag] = useState(ALL_PROMPTS_OPTION);
    const [selectedCategory, setSelectedCategory] = useState(ALL_PROMPTS_OPTION);
    const [page, setPage] = useState(1);
    const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
    const [selectedPromptPreviewUrl, setSelectedPromptPreviewUrl] = useState("");
    const scrollContainerRef = useRef<HTMLElement | null>(null);
    const listStartRef = useRef<HTMLDivElement | null>(null);
    const addAsset = useAssetStore((state) => state.addAsset);
    const copyText = useCopyText();
    const deferredKeyword = useDeferredValue(titleKeyword.trim());
    const {
        query,
        items: promptItems,
        tags: promptTags,
        categories: promptCategoryOptions,
        total: totalPrompts,
    } = usePromptPage({
        keyword: deferredKeyword,
        tag: selectedTag,
        category: selectedCategory,
        page,
        pageSize: PAGE_SIZE,
    });
    const hasFilters = Boolean(titleKeyword.trim()) || selectedTag !== ALL_PROMPTS_OPTION || selectedCategory !== ALL_PROMPTS_OPTION;

    useEffect(() => {
        if (query.isError) {
            message.error(t("loadFailed"));
        }
    }, [message, query.error, query.isError, t]);

    const updateCategory = (value: string) => {
        setSelectedCategory(value);
        setPage(1);
    };

    const updateTag = (value: string) => {
        setSelectedTag(value);
        setPage(1);
    };

    const clearFilters = () => {
        setTitleKeyword("");
        setSelectedCategory(ALL_PROMPTS_OPTION);
        setSelectedTag(ALL_PROMPTS_OPTION);
        setPage(1);
    };

    const changePage = (value: number) => {
        setPage(value);
        requestAnimationFrame(() => listStartRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
    };

    const savePromptAsset = async (item: Prompt) => {
        try {
            await addAsset({ kind: "text", title: item.title, coverUrl: item.coverUrl, tags: item.tags, source: item.category, data: { content: item.prompt }, metadata: { source: "prompt-library", promptId: item.id, githubUrl: item.githubUrl || "" } });
            message.success(t("assetSaved"));
        } catch {
            message.error(t("assetSaveFailed"));
        }
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-800 dark:text-stone-100">
            <main ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto bg-background px-3 py-3 sm:px-6 sm:py-8">
                <div className="mx-auto max-w-7xl">
                    <div>
                        <h1 className="text-xl font-semibold text-stone-950 sm:text-2xl dark:text-stone-100">{t("title")}</h1>
                        <p className="mt-1.5 text-xs leading-5 text-stone-500 sm:mt-2 sm:text-sm dark:text-stone-400">{t("description")}</p>
                    </div>

                    <section className="mt-2.5 rounded-xl border border-border bg-card p-2 sm:mt-6 sm:p-3.5">
                        <div className="grid min-w-0 grid-cols-2 gap-1.5 sm:grid-cols-[minmax(240px,1fr)_160px_180px_auto] sm:items-center sm:gap-2">
                            <div className="col-span-2 min-w-0 sm:col-span-1">
                                <Input
                                    allowClear
                                    className="!h-9 w-full"
                                    prefix={<Search className="size-4 text-stone-400" />}
                                    value={titleKeyword}
                                    placeholder={t("searchPlaceholder")}
                                    onChange={(event) => {
                                        setTitleKeyword(event.target.value);
                                        setPage(1);
                                    }}
                                />
                            </div>
                            <div className="min-w-0">
                                <Select
                                    aria-label={t("categoryAria")}
                                    className="w-full"
                                    value={selectedCategory}
                                    options={promptCategoryOptions.map((category) => ({ label: category === ALL_PROMPTS_OPTION ? t("all") : category, value: category }))}
                                    onChange={updateCategory}
                                />
                            </div>
                            <div className="min-w-0">
                                <Select
                                    showSearch
                                    aria-label={t("tagAria")}
                                    className="w-full"
                                    optionFilterProp="label"
                                    value={selectedTag}
                                    options={promptTags.map((tag) => ({ label: tag === ALL_PROMPTS_OPTION ? t("all") : tag, value: tag }))}
                                    onChange={updateTag}
                                />
                            </div>
                            <div className="col-span-2 flex min-h-8 items-center justify-between gap-2 sm:col-span-1 sm:justify-end">
                                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t("count", { count: totalPrompts })}</span>
                                <Button aria-label={t("clearAria")} icon={<RotateCcw className="size-3.5" />} disabled={!hasFilters} onClick={clearFilters}>
                                    {t("clear")}
                                </Button>
                            </div>
                        </div>
                    </section>

                    <div ref={listStartRef} className="scroll-mt-4 pt-3 sm:pt-5">
                        {query.isLoading ? (
                            <div className="flex h-32 items-center justify-center">
                                <Spin />
                            </div>
                        ) : null}
                        {!query.isLoading ? (
                            <div className="grid gap-2 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4">
                                {promptItems.map((item) => (
                                    <PromptCard
                                        key={item.id}
                                        item={item}
                                        onOpen={(previewUrl) => {
                                            setSelectedPrompt(item);
                                            setSelectedPromptPreviewUrl(previewUrl || "");
                                        }}
                                        onCopy={() => copyText(item.prompt, t("copied"))}
                                        extraAction={
                                            <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => savePromptAsset(item)}>
                                                {t("addToAssets")}
                                            </Button>
                                        }
                                    />
                                ))}
                            </div>
                        ) : null}
                        {!query.isLoading && promptItems.length === 0 ? <CompactEmptyState title={t("emptyTitle")} description={t("emptyDescription")} /> : null}
                        {totalPrompts > PAGE_SIZE ? (
                            <div className="flex justify-center py-5 sm:py-8">
                                <Pagination current={page} pageSize={PAGE_SIZE} total={totalPrompts} showSizeChanger={false} showLessItems responsive onChange={changePage} />
                            </div>
                        ) : null}
                    </div>
                </div>
            </main>

            <PromptDetailDialog
                prompt={selectedPrompt}
                previewUrl={selectedPromptPreviewUrl}
                onClose={() => {
                    setSelectedPrompt(null);
                    setSelectedPromptPreviewUrl("");
                }}
                onCopy={(prompt) => copyText(prompt, t("copied"))}
                onSaveAsset={savePromptAsset}
            />
        </div>
    );
}
