"use client";

import { useCallback, useEffect, useState } from "react";
import { App, Button, Empty, Form, Input, Modal, Popconfirm, Space, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import { Copy, FolderPlus, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { useAssetStore } from "@/stores/use-asset-store";
import { useCopyText } from "@/hooks/use-copy-text";
import { createMyPrompt, deleteMyPrompt, listMyPrompts } from "@/services/api/my-prompts";
import type { Prompt } from "@/services/api/prompts";

const PAGE_SIZE = 8;

type PromptFormValue = {
    title: string;
    prompt: string;
    category?: string;
    tags?: string;
    coverUrl?: string;
    preview?: string;
};

export function MyPromptsPage() {
    const t = useTranslations("media.myPrompts");
    const { message } = App.useApp();
    const [form] = Form.useForm<PromptFormValue>();
    const [items, setItems] = useState<Prompt[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [deletingId, setDeletingId] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const copyText = useCopyText();
    const addAsset = useAssetStore((state) => state.addAsset);

    const loadPrompts = useCallback(
        async (targetPage: number) => {
            setLoading(true);
            try {
                const payload = await listMyPrompts({ page: targetPage, pageSize: PAGE_SIZE });
                setItems(payload.items);
                setTotal(payload.total);
            } catch {
                message.error(t("loadFailed"));
            } finally {
                setLoading(false);
            }
        },
        [message, t],
    );

    useEffect(() => {
        void loadPrompts(page);
    }, [loadPrompts, page]);

    const createPrompt = async (value: PromptFormValue) => {
        setSubmitting(true);
        try {
            await createMyPrompt({ ...value, tags: splitTags(value.tags) });
            form.resetFields();
            setCreateOpen(false);
            message.success(t("saved"));
            if (page === 1) await loadPrompts(1);
            else setPage(1);
        } catch {
            message.error(t("createFailed"));
        } finally {
            setSubmitting(false);
        }
    };

    const deletePrompt = async (id: string) => {
        setDeletingId(id);
        try {
            await deleteMyPrompt(id);
            message.success(t("deleted"));
            const targetPage = Math.min(page, Math.max(1, Math.ceil(Math.max(0, total - 1) / PAGE_SIZE)));
            if (targetPage === page) await loadPrompts(targetPage);
            else setPage(targetPage);
        } catch {
            message.error(t("deleteFailed"));
        } finally {
            setDeletingId("");
        }
    };

    const savePromptAsset = async (item: Prompt) => {
        try {
            await addAsset({ kind: "text", title: item.title, coverUrl: item.coverUrl, tags: item.tags, source: item.category, data: { content: item.prompt }, metadata: { source: "my-prompts", promptId: item.id } });
            message.success(t("assetSaved"));
        } catch {
            message.error(t("assetSaveFailed"));
        }
    };

    const columns: TableColumnsType<Prompt> = [
        {
            title: t("columns.title"),
            dataIndex: "title",
            render: (_, record) => (
                <div className="min-w-0">
                    <div className="font-medium text-stone-950 dark:text-stone-100">{record.title}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500 dark:text-stone-400">{record.prompt}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                        {record.tags.map((tag) => (
                            <Tag key={tag} className="m-0 text-[11px]">
                                {tag}
                            </Tag>
                        ))}
                    </div>
                </div>
            ),
        },
        {
            title: t("columns.category"),
            dataIndex: "category",
            width: 120,
            responsive: ["md"],
        },
        {
            title: t("columns.actions"),
            width: 180,
            render: (_, record) => (
                <Space wrap size="small">
                    <Button size="small" aria-label={t("copyPrompt")} icon={<Copy className="size-3.5" />} onClick={() => copyText(record.prompt, t("copied"))}>
                        <span className="hidden sm:inline">{t("copy")}</span>
                    </Button>
                    <Button size="small" aria-label={t("addToAssets")} icon={<FolderPlus className="size-3.5" />} onClick={() => savePromptAsset(record)}>
                        <span className="hidden sm:inline">{t("asset")}</span>
                    </Button>
                    <Popconfirm title={t("deleteConfirm")} okText={t("delete")} cancelText={t("cancel")} onConfirm={() => deletePrompt(record.id)}>
                        <Button size="small" danger aria-label={t("deletePrompt")} loading={deletingId === record.id} icon={<Trash2 className="size-3.5" />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-800 dark:text-stone-100">
            <main className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-6 sm:py-8">
                <div className="mx-auto max-w-7xl space-y-3 sm:space-y-6">
                    <div className="flex flex-row items-center justify-between gap-3 sm:items-end sm:gap-4">
                        <div>
                            <h1 className="text-xl font-semibold text-stone-950 sm:text-2xl dark:text-stone-100">{t("title")}</h1>
                            <p className="mt-1.5 text-xs leading-5 text-stone-500 sm:mt-2 sm:text-sm dark:text-stone-400">{t("description")}</p>
                        </div>
                        <Button type="primary" size="small" className="shrink-0 sm:!h-9" icon={<Plus className="size-3.5 sm:size-4" />} onClick={() => setCreateOpen(true)}>
                            {t("add")}
                        </Button>
                    </div>

                    <section className="overflow-hidden rounded-lg border border-border bg-card">
                        <div className="border-b border-border px-3 py-2.5 sm:px-5 sm:py-4">
                            <h2 className="text-base font-semibold text-stone-950 sm:text-lg dark:text-stone-100">{t("records")}</h2>
                        </div>
                        <Table
                            className="[&_.ant-table-tbody>tr>td]:!py-2 sm:[&_.ant-table-tbody>tr>td]:!py-3 [&_.ant-table-thead>tr>th]:!py-2"
                            rowKey="id"
                            loading={loading}
                            columns={columns}
                            dataSource={items}
                            tableLayout="fixed"
                            pagination={{ current: page, pageSize: PAGE_SIZE, total, hideOnSinglePage: true, showSizeChanger: false, onChange: setPage }}
                            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("empty")} /> }}
                        />
                    </section>
                </div>
            </main>
            <Modal title={t("add")} open={createOpen} footer={null} centered width={720} destroyOnHidden onCancel={() => setCreateOpen(false)} afterClose={() => form.resetFields()}>
                <Form form={form} layout="vertical" onFinish={createPrompt} requiredMark={false} className="pt-3">
                    <div className="grid gap-x-4 sm:grid-cols-2">
                        <Form.Item label={t("form.title")} name="title" rules={[{ required: true, message: t("form.titleRequired") }]}>
                            <Input placeholder={t("form.titlePlaceholder")} />
                        </Form.Item>
                        <Form.Item label={t("form.category")} name="category">
                            <Input placeholder={t("form.categoryPlaceholder")} />
                        </Form.Item>
                        <Form.Item label={t("form.tags")} name="tags">
                            <Input placeholder={t("form.tagsPlaceholder")} />
                        </Form.Item>
                        <Form.Item label={t("form.coverUrl")} name="coverUrl">
                            <Input placeholder={t("form.coverPlaceholder")} />
                        </Form.Item>
                    </div>
                    <Form.Item label={t("form.prompt")} name="prompt" rules={[{ required: true, message: t("form.promptRequired") }]}>
                        <Input.TextArea rows={5} placeholder={t("form.promptPlaceholder")} />
                    </Form.Item>
                    <Form.Item label={t("form.preview")} name="preview">
                        <Input.TextArea rows={2} placeholder={t("form.previewPlaceholder")} />
                    </Form.Item>
                    <div className="flex justify-end gap-3">
                        <Button onClick={() => setCreateOpen(false)}>{t("cancel")}</Button>
                        <Button type="primary" htmlType="submit" loading={submitting} icon={<Plus className="size-4" />}>
                            {t("save")}
                        </Button>
                    </div>
                </Form>
            </Modal>
        </div>
    );
}

function splitTags(value?: string) {
    return (value || "")
        .split(/[,，\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean);
}
