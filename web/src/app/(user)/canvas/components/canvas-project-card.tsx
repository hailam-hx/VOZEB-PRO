"use client";

import { Check, Download, Pencil, Share2, Trash2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { App, Button, Input } from "antd";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { useCanvasStore, type CanvasProjectSummary } from "../stores/use-canvas-store";
import { useCanvasUiStore } from "../stores/use-canvas-ui-store";
import { exportCanvasProjects } from "../utils/canvas-export";

export function CanvasProjectCard({ project }: { project: CanvasProjectSummary }) {
    const t = useTranslations("canvas");
    const format = useFormatter();
    const { message } = App.useApp();
    const router = useRouter();
    const searchParams = useSearchParams();
    const renameProject = useCanvasStore((state) => state.renameProject);
    const loadProject = useCanvasStore((state) => state.loadProject);
    const [exporting, setExporting] = useState(false);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const editingId = useCanvasUiStore((state) => state.editingProjectId);
    const editingTitle = useCanvasUiStore((state) => state.editingProjectTitle);
    const startEditing = useCanvasUiStore((state) => state.startEditingProject);
    const setEditingTitle = useCanvasUiStore((state) => state.setEditingProjectTitle);
    const stopEditing = useCanvasUiStore((state) => state.stopEditingProject);
    const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const editing = editingId === project.id;
    const selected = selectedIds.includes(project.id);
    const open = () => router.push(`/canvas/${project.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`);
    const saveTitle = () => {
        renameProject(project.id, editingTitle);
        stopEditing();
    };
    const exportProject = async () => {
        if (exporting) return;
        setExporting(true);
        try {
            const detail = await loadProject(project.id);
            await exportCanvasProjects([detail]);
        } catch {
            message.error(t("exportFailed"));
        } finally {
            setExporting(false);
        }
    };

    return (
        <article
            className="group flex min-h-0 cursor-pointer flex-col justify-between rounded-lg border border-border bg-card p-2.5 text-card-foreground transition hover:border-foreground/20 hover:bg-accent/35 sm:min-h-44 sm:p-5"
            onClick={() => !editing && open()}
        >
            <div className="flex items-start gap-3">
                <input
                    type="checkbox"
                    checked={selected}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => toggleSelected(project.id, event.target.checked)}
                    className="mt-1 size-4 accent-stone-950 dark:accent-stone-100"
                    aria-label={t("selectProject", { name: project.title })}
                />
                {editing ? (
                    <Input className="min-w-0" value={editingTitle} onClick={(event) => event.stopPropagation()} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveTitle()} autoFocus />
                ) : (
                    <button
                        type="button"
                        className="min-w-0 cursor-pointer text-left"
                        onClick={(event) => {
                            event.stopPropagation();
                            open();
                        }}
                    >
                        <h2 className="truncate text-base font-semibold text-stone-950 sm:text-xl dark:text-stone-100">{project.title}</h2>
                        <p className="mt-1.5 text-xs leading-5 text-stone-600 sm:mt-3 sm:text-sm sm:leading-6 dark:text-stone-400">{t("projectCounts", { nodes: project.nodeCount, connections: project.connectionCount })}</p>
                    </button>
                )}
            </div>
            <div className="mt-2 flex items-end justify-between gap-3 sm:mt-8">
                <p className="text-xs text-stone-500 dark:text-stone-400">{t("updatedAt", { time: format.dateTime(new Date(project.updatedAt), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) })}</p>
                <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                    {editing ? (
                        <>
                            <Button type="text" size="small" shape="circle" icon={<Check className="size-4" />} onClick={saveTitle} aria-label={t("saveName")} />
                            <Button type="text" size="small" shape="circle" icon={<X className="size-4" />} onClick={stopEditing} aria-label={t("cancelRename")} />
                        </>
                    ) : (
                        <>
                            <Button type="text" size="small" shape="circle" loading={exporting} icon={<Download className="size-4" />} onClick={() => void exportProject()} aria-label={t("export")} />
                            <Button type="text" size="small" shape="circle" icon={<Share2 className="size-4" />} onClick={() => router.push(`/works?sourceType=canvas&sourceId=${encodeURIComponent(project.id)}`)} aria-label={t("publishWork")} />
                            <Button type="text" size="small" shape="circle" icon={<Pencil className="size-4" />} onClick={() => startEditing(project.id, project.title)} aria-label={t("rename")} />
                            <Button type="text" size="small" shape="circle" icon={<Trash2 className="size-4" />} onClick={() => setDeleteIds([project.id])} aria-label={t("delete")} />
                        </>
                    )}
                </div>
            </div>
        </article>
    );
}
