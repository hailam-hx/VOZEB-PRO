"use client";

import { useState } from "react";
import { App, Button, Modal } from "antd";
import { useTranslations } from "next-intl";

import { useCanvasStore } from "../stores/use-canvas-store";
import { useCanvasUiStore } from "../stores/use-canvas-ui-store";

export function CanvasDeleteProjectsDialog() {
    const t = useTranslations("canvas");
    const { message } = App.useApp();
    const [deleting, setDeleting] = useState(false);
    const ids = useCanvasUiStore((state) => state.deleteProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const confirm = async () => {
        setDeleting(true);
        try {
            await deleteProjects(ids);
            removeSelectedIds(ids);
            setDeleteIds([]);
        } catch {
            message.error(t("deleteFailed"));
        } finally {
            setDeleting(false);
        }
    };

    return (
        <Modal
            title={t("deleteCanvasesQuestion")}
            open={ids.length > 0}
            centered
            onCancel={() => setDeleteIds([])}
            footer={
                <>
                    <Button onClick={() => setDeleteIds([])}>{t("cancel")}</Button>
                    <Button danger type="primary" loading={deleting} onClick={() => void confirm()}>
                        {t("delete")}
                    </Button>
                </>
            }
        >
            <p className="text-sm text-stone-500">{t("deleteDescription", { count: ids.length })}</p>
        </Modal>
    );
}
