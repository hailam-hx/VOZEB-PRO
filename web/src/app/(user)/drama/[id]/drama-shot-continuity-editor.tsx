"use client";

import { Input } from "antd";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { useDramaStore } from "../stores/use-drama-store";
import type { DramaShot, DramaShotContinuity } from "../types";

export function DramaShotContinuityEditor({ projectId, episodeId, shot }: { projectId: string; episodeId: string; shot: DramaShot }) {
    const t = useTranslations("drama.editor.continuity");
    const updateShot = useDramaStore((state) => state.updateShot);
    const [open, setOpen] = useState(false);
    const continuity = { ...emptyContinuity, ...shot.continuity };
    const updateContinuity = (key: keyof DramaShotContinuity, value: string) => updateShot(projectId, episodeId, shot.id, { continuity: { ...continuity, [key]: value } });
    const panelId = `shot-continuity-${shot.id}`;

    return (
        <div className="mt-5 border-t border-border/70 pt-4">
            <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                className={`group grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 overflow-hidden rounded-lg border px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${open ? "border-foreground/25 bg-muted/25" : "border-border/70 bg-background hover:border-foreground/20 hover:bg-muted/25"}`}
                onClick={() => setOpen((value) => !value)}
            >
                <span className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-foreground transition-colors group-hover:bg-muted/80">
                        <SlidersHorizontal className="size-4" />
                    </span>
                    <span className="flex min-w-0 flex-col justify-center gap-0.5 overflow-hidden">
                        <span className="truncate text-base font-semibold text-foreground">{t("title")}</span>
                        <span className="truncate text-xs text-muted-foreground">{t("description")}</span>
                    </span>
                </span>
                <span
                    className={`flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors ${open ? "border-foreground bg-foreground text-background" : "border-border bg-background text-foreground group-hover:border-foreground/30 group-hover:bg-muted/70"}`}
                >
                    <span>{open ? t("collapse") : t("configure")}</span>
                    <ChevronDown className={`size-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
                </span>
            </button>
            {open ? (
                <div id={panelId} className="mt-2 grid gap-3 rounded-md bg-muted/20 p-3 sm:grid-cols-2">
                    <ContinuityInput label={t("shotSize")} value={continuity.shotSize} placeholder={t("shotSizePlaceholder")} onChange={(value) => updateContinuity("shotSize", value)} />
                    <ContinuityInput label={t("cameraAngle")} value={continuity.cameraAngle} placeholder={t("cameraAnglePlaceholder")} onChange={(value) => updateContinuity("cameraAngle", value)} />
                    <ContinuityInput label={t("composition")} value={continuity.composition} placeholder={t("compositionPlaceholder")} onChange={(value) => updateContinuity("composition", value)} />
                    <ContinuityInput label={t("characterBlocking")} value={continuity.characterBlocking} placeholder={t("characterBlockingPlaceholder")} onChange={(value) => updateContinuity("characterBlocking", value)} />
                    <ContinuityInput label={t("gazeDirection")} value={continuity.gazeDirection} placeholder={t("gazeDirectionPlaceholder")} onChange={(value) => updateContinuity("gazeDirection", value)} />
                    <ContinuityInput label={t("axisRule")} value={continuity.axisRule} placeholder={t("axisRulePlaceholder")} onChange={(value) => updateContinuity("axisRule", value)} />
                    <ContinuityTextArea label={t("actionStart")} value={continuity.actionStart} placeholder={t("actionStartPlaceholder")} onChange={(value) => updateContinuity("actionStart", value)} />
                    <ContinuityTextArea label={t("actionEnd")} value={continuity.actionEnd} placeholder={t("actionEndPlaceholder")} onChange={(value) => updateContinuity("actionEnd", value)} />
                    <ContinuityTextArea label={t("notes")} value={continuity.continuityNotes} placeholder={t("notesPlaceholder")} onChange={(value) => updateContinuity("continuityNotes", value)} />
                </div>
            ) : null}
        </div>
    );
}

function ContinuityInput({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
    return (
        <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
        </label>
    );
}

function ContinuityTextArea({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
    return (
        <label className="block space-y-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            <Input.TextArea value={value} onChange={(event) => onChange(event.target.value)} autoSize={{ minRows: 1, maxRows: 3 }} placeholder={placeholder} />
        </label>
    );
}

const emptyContinuity: DramaShotContinuity = {
    shotSize: "",
    cameraAngle: "",
    composition: "",
    characterBlocking: "",
    gazeDirection: "",
    actionStart: "",
    actionEnd: "",
    screenDirection: "",
    axisRule: "",
    continuityNotes: "",
};
