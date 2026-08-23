"use client";

import { Clapperboard, FileText, KeyRound, MapPinned, Package, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import type { DramaAgentMentionItem, DramaAgentMentionKind } from "./drama-agent-mention";

const KIND_ICONS = { character: UserRound, scene: MapPinned, prop: Package, clue: KeyRound, source: FileText, shot: Clapperboard } satisfies Record<DramaAgentMentionKind, typeof UserRound>;
const KIND_ORDER: DramaAgentMentionKind[] = ["character", "scene", "prop", "clue", "source", "shot"];

export function DramaAgentMentionPicker({ items, selectedIds, onSelect }: { items: DramaAgentMentionItem[]; selectedIds: Set<string>; onSelect: (item: DramaAgentMentionItem) => void }) {
    const t = useTranslations("drama.editor.mentions");
    const [activeKind, setActiveKind] = useState<DramaAgentMentionKind>("character");
    const groups = useMemo(() => new Map(KIND_ORDER.map((kind) => [kind, items.filter((item) => item.kind === kind)])), [items]);
    const availableKinds = KIND_ORDER.filter((kind) => groups.get(kind)?.length);
    const visibleKind = availableKinds.includes(activeKind) ? activeKind : availableKinds[0];
    const visibleItems = visibleKind ? groups.get(visibleKind) || [] : [];
    const tabColumns = availableKinds.length === 1 ? "grid-cols-1" : availableKinds.length === 2 ? "grid-cols-2" : "grid-cols-3";

    if (!visibleKind) return <p className="w-[min(17rem,calc(100vw-1.5rem))] px-3 py-4 text-center text-xs text-muted-foreground">{t("empty")}</p>;
    return (
        <div className="flex w-[min(17rem,calc(100vw-1.5rem))] min-w-0 flex-col overflow-hidden p-1.5" data-drama-agent-mention-picker>
            <div className={`mb-1.5 grid gap-1 rounded-lg bg-muted/60 p-1 ${tabColumns}`} role="tablist" aria-label={t("typeAria")}>
                {availableKinds.map((kind) => {
                    const Icon = KIND_ICONS[kind];
                    const active = kind === visibleKind;
                    return (
                        <button
                            key={kind}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            className={`flex h-7 min-w-0 items-center justify-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                                active ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
                            }`}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => setActiveKind(kind)}
                        >
                            <Icon className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                            <span className="truncate">{t(`kinds.${kind}`)}</span>
                            <span className="text-[10px] font-normal tabular-nums opacity-55">{groups.get(kind)?.length}</span>
                        </button>
                    );
                })}
            </div>
            <div className="hide-scrollbar grid max-h-[min(14rem,calc(100dvh-12rem))] grid-cols-2 gap-1 overflow-y-auto overscroll-contain p-0.5" data-drama-agent-mention-list={visibleKind}>
                {visibleItems.map((item) => {
                    const selected = selectedIds.has(item.id);
                    return (
                        <button
                            key={item.id}
                            type="button"
                            className={`flex h-8 min-w-0 items-center rounded-md px-2.5 text-left text-[13px] font-medium transition-colors ${selected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted/70"}`}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => onSelect(item)}
                            aria-label={t("reference", { kind: t(`kinds.${item.kind}`), title: item.title })}
                            title={item.title}
                        >
                            <span className="truncate">{item.title}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
