"use client";

import { ImageIcon, X } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";

import type { CanvasTheme } from "@/lib/canvas-theme";
import { imagePreviewUrl } from "@/lib/media-image-url";
import type { CreativeVideoReferenceMode, VideoReferenceRole } from "@/lib/video-reference-contract";

import type { CanvasNodeMetadata, CanvasVideoFrameSelection } from "../types";
import type { CanvasResourceReference } from "../utils/canvas-resource-references";
import { canvasVideoFrameSelection, canvasVideoFrameSelectionPatch, canvasVideoReferenceModePatch, normalizeCanvasVideoReferenceMode } from "../utils/canvas-video-references";

type FrameRole = Extract<VideoReferenceRole, "first_frame" | "last_frame">;

const referenceModes: CreativeVideoReferenceMode[] = ["reference", "first_frame", "first_last"];

export function CanvasVideoReferenceSettings({
    metadata,
    references,
    theme,
    compact = false,
    onChange,
}: {
    metadata?: CanvasNodeMetadata;
    references: CanvasResourceReference[];
    theme: CanvasTheme;
    compact?: boolean;
    onChange: (patch: Partial<CanvasNodeMetadata>) => void;
}) {
    const t = useTranslations("canvas");
    const mode = normalizeCanvasVideoReferenceMode(metadata?.videoReferenceMode);
    const [activeRole, setActiveRole] = useState<FrameRole>("first_frame");
    const [feedback, setFeedback] = useState("");
    const selectedRole = mode === "first_frame" ? "first_frame" : activeRole;
    const frameOptions = references.filter((reference) => reference.kind === "image").map((reference) => ({ reference, selection: canvasVideoFrameSelection(reference) }));

    const updateMode = (nextMode: CreativeVideoReferenceMode) => {
        onChange(canvasVideoReferenceModePatch(nextMode));
        setActiveRole("first_frame");
        setFeedback("");
    };
    const selectFrame = (selection: CanvasVideoFrameSelection | null) => {
        if (!selection) {
            setFeedback(t("videoReferences.notSaved"));
            return;
        }
        const otherRole = selectedRole === "first_frame" ? "last_frame" : "first_frame";
        const otherSelection = otherRole === "first_frame" ? metadata?.videoFirstFrame : metadata?.videoLastFrame;
        onChange(canvasVideoFrameSelectionPatch(metadata, selectedRole, selection));
        const otherLabel = t(`videoReferences.roles.${frameRoleKey(otherRole)}`);
        const selectedLabel = t(`videoReferences.roles.${frameRoleKey(selectedRole)}`);
        setFeedback(sameFrameSelection(selection, otherSelection) ? t("videoReferences.removedDuplicate", { role: otherLabel }) : t("videoReferences.setRole", { role: selectedLabel }));
    };

    return (
        <section className="space-y-2.5" data-canvas-video-reference-settings>
            <div className="text-xs font-medium" style={{ color: theme.node.muted }}>
                {t("videoReferences.referenceMode")}
            </div>
            <div className={compact ? "grid grid-cols-3 gap-1" : "grid grid-cols-3 gap-2"}>
                {referenceModes.map((value) => {
                    const selected = value === mode;
                    const label = t(`videoReferences.modes.${value}.label`);
                    return (
                        <button
                            key={value}
                            type="button"
                            className={compact ? "h-8 min-w-0 rounded-lg px-1 text-center text-[11px] font-medium transition hover:opacity-80" : "min-w-0 rounded-xl border px-2 py-2 text-left transition hover:opacity-80"}
                            style={{ background: selected ? theme.toolbar.itemHover : theme.node.fill, borderColor: selected ? theme.node.text : theme.node.stroke, color: selected ? theme.node.action : theme.node.muted }}
                            aria-label={t("videoReferences.modeAria", { mode: label })}
                            aria-pressed={selected}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={() => updateMode(value)}
                        >
                            <span className="block truncate text-xs font-medium">{label}</span>
                            {!compact ? (
                                <span className="mt-0.5 block truncate text-[10px]" style={{ color: theme.node.faint }}>
                                    {t(`videoReferences.modes.${value}.description`)}
                                </span>
                            ) : null}
                        </button>
                    );
                })}
            </div>

            {mode === "reference" ? (
                <p className="text-[11px] leading-4" style={{ color: theme.node.faint }}>
                    {t("videoReferences.referenceHint")}
                </p>
            ) : (
                <>
                    <div className={`grid gap-2 ${mode === "first_last" ? "grid-cols-2" : "grid-cols-1"}`}>
                        <FrameSlot
                            role="first_frame"
                            selection={metadata?.videoFirstFrame}
                            active={selectedRole === "first_frame"}
                            theme={theme}
                            onSelect={() => setActiveRole("first_frame")}
                            onClear={() => onChange(canvasVideoFrameSelectionPatch(metadata, "first_frame"))}
                        />
                        {mode === "first_last" ? (
                            <FrameSlot
                                role="last_frame"
                                selection={metadata?.videoLastFrame}
                                active={selectedRole === "last_frame"}
                                theme={theme}
                                onSelect={() => setActiveRole("last_frame")}
                                onClear={() => onChange(canvasVideoFrameSelectionPatch(metadata, "last_frame"))}
                            />
                        ) : null}
                    </div>

                    <div className="flex items-center justify-between gap-3">
                        <span className="text-[11px] font-medium" style={{ color: theme.node.muted }}>
                            {t("videoReferences.selectRoleImage", { role: t(`videoReferences.roles.${frameRoleKey(selectedRole)}`) })}
                        </span>
                        <span className="text-[10px]" style={{ color: theme.node.faint }}>
                            {t("videoReferences.fromConnectedImages")}
                        </span>
                    </div>
                    {frameOptions.length ? (
                        <div className="hide-scrollbar grid max-h-36 grid-cols-4 gap-1.5 overflow-y-auto pr-0.5">
                            {frameOptions.map(({ reference, selection }) => {
                                const selected = sameFrameSelection(selection, selectedRole === "first_frame" ? metadata?.videoFirstFrame : metadata?.videoLastFrame);
                                const first = sameFrameSelection(selection, metadata?.videoFirstFrame);
                                const last = sameFrameSelection(selection, metadata?.videoLastFrame);
                                return (
                                    <button
                                        key={reference.nodeId}
                                        type="button"
                                        disabled={!selection}
                                        className="relative aspect-square min-w-0 overflow-hidden rounded-lg border transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                                        style={{ background: theme.node.fill, borderColor: selected ? theme.node.text : theme.node.stroke }}
                                        aria-label={t("videoReferences.setNamed", { role: t(`videoReferences.roles.${frameRoleKey(selectedRole)}`), title: reference.title })}
                                        title={selection ? reference.title : t("videoReferences.namedNotSaved", { title: reference.title })}
                                        onMouseDown={(event) => event.stopPropagation()}
                                        onClick={() => selectFrame(selection)}
                                    >
                                        {reference.previewUrl ? (
                                            <img src={imagePreviewUrl(reference.previewUrl, 320)} alt="" className="size-full object-cover" />
                                        ) : (
                                            <ImageIcon className="absolute inset-0 m-auto size-4" style={{ color: theme.node.muted }} />
                                        )}
                                        {first || last ? (
                                            <span className="absolute bottom-1 right-1 rounded px-1 py-0.5 text-[9px] font-medium" style={{ background: theme.node.action, color: theme.node.actionText }}>
                                                {first && last ? t("videoReferences.badges.both") : first ? t("videoReferences.badges.first") : t("videoReferences.badges.last")}
                                            </span>
                                        ) : null}
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="grid min-h-16 place-items-center rounded-xl border border-dashed px-3 text-center text-[11px] leading-4" style={{ borderColor: theme.node.stroke, color: theme.node.faint }}>
                            {t("videoReferences.connectImagesFirst")}
                        </div>
                    )}
                    <p aria-live="polite" className="min-h-4 text-[10px] leading-4" style={{ color: feedback ? theme.node.muted : theme.node.faint }}>
                        {feedback || t("videoReferences.selectionRule")}
                    </p>
                </>
            )}
        </section>
    );
}

function FrameSlot({ role, selection, active, theme, onSelect, onClear }: { role: FrameRole; selection?: CanvasVideoFrameSelection; active: boolean; theme: CanvasTheme; onSelect: () => void; onClear: () => void }) {
    const t = useTranslations("canvas");
    const label = t(`videoReferences.roles.${frameRoleKey(role)}`);
    const preview = selection?.previewUrl || selection?.serverUrl || selection?.remoteUrl;
    return (
        <div className="flex min-w-0 items-center gap-2 rounded-xl border p-1.5" style={{ background: active ? theme.toolbar.itemHover : theme.node.fill, borderColor: active ? theme.node.text : theme.node.stroke }}>
            <button
                type="button"
                className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg border transition hover:opacity-80"
                style={{ background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.muted }}
                aria-label={t("videoReferences.chooseRole", { role: label })}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={onSelect}
            >
                {preview ? <img src={imagePreviewUrl(preview, 320)} alt="" className="size-full object-cover" /> : <ImageIcon className="size-4" />}
            </button>
            <button type="button" className="min-w-0 flex-1 text-left" aria-label={t("videoReferences.switchRole", { role: label })} onMouseDown={(event) => event.stopPropagation()} onClick={onSelect}>
                <span className="block text-[11px] font-medium">{label}</span>
                <span className="block truncate text-[10px]" style={{ color: theme.node.faint }}>
                    {selection?.title || t("videoReferences.pendingSelection")}
                </span>
            </button>
            {selection ? (
                <button
                    type="button"
                    className="grid size-7 shrink-0 place-items-center rounded-lg transition hover:opacity-70"
                    style={{ color: theme.node.muted }}
                    aria-label={t("videoReferences.clearRole", { role: label })}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={onClear}
                >
                    <X className="size-3.5" />
                </button>
            ) : null}
        </div>
    );
}

function frameRoleKey(role: FrameRole) {
    return role === "first_frame" ? "first" : "last";
}

function sameFrameSelection(left: CanvasVideoFrameSelection | null | undefined, right: CanvasVideoFrameSelection | null | undefined) {
    if (!left || !right) return false;
    return Boolean((left.nodeId && right.nodeId && left.nodeId === right.nodeId) || left.source === right.source);
}
