"use client";

import { App, Button, Input, Modal, Select } from "antd";
import { Flag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { submitWorkReport } from "@/services/api/work-governance";
import { useUserStore } from "@/stores/use-user-store";

export function PublicWorkReportButton({ slug, compact = false, className }: { slug: string; compact?: boolean; className?: string }) {
    const t = useTranslations("public.work.report");
    const options = ["illegal", "copyright", "privacy", "spam", "other"].map((value) => ({ value, label: t(`categories.${value}`) }));
    const { message } = App.useApp();
    const router = useRouter();
    const user = useUserStore((state) => state.user);
    const [open, setOpen] = useState(false);
    const [category, setCategory] = useState("illegal");
    const [description, setDescription] = useState("");
    const [loading, setLoading] = useState(false);

    const startReport = () => {
        if (!user) {
            router.push(`/login?next=${encodeURIComponent(`/share/${slug}`)}`);
            return;
        }
        setOpen(true);
    };

    const submit = async () => {
        if (description.trim().length < 5) return message.warning(t("minimum"));
        setLoading(true);
        try {
            await submitWorkReport(slug, { category, description: description.trim() });
            message.success(t("submitted"));
            setOpen(false);
            setDescription("");
        } catch {
            message.error(t("submitFailed"));
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <Button className={className} size={compact ? "small" : "middle"} icon={<Flag className="size-4" />} onClick={startReport} aria-label={t("aria")}>
                {compact ? null : t("report")}
            </Button>
            <Modal title={t("title")} open={open} okText={t("submit")} cancelText={t("cancel")} confirmLoading={loading} okButtonProps={{ disabled: description.trim().length < 5 }} onOk={() => void submit()} onCancel={() => !loading && setOpen(false)}>
                <div className="grid gap-4 pt-2">
                    <div>
                        <div className="mb-2 text-sm font-medium">{t("category")}</div>
                        <Select className="w-full" value={category} options={options} onChange={setCategory} />
                    </div>
                    <div>
                        <div className="mb-2 text-sm font-medium">{t("description")}</div>
                        <Input.TextArea value={description} rows={5} maxLength={1000} showCount placeholder={t("placeholder")} onChange={(event) => setDescription(event.target.value)} />
                    </div>
                </div>
            </Modal>
        </>
    );
}
