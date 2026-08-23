"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Divider, Input, Modal, Popover, Select, Tooltip } from "antd";
import { EditorContent, useEditor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { useFormatter, useTranslations } from "next-intl";
import {
    AlignCenter,
    AlignJustify,
    AlignLeft,
    AlignRight,
    Bold,
    ChevronDown,
    Highlighter,
    IndentDecrease,
    IndentIncrease,
    Italic,
    Link2,
    List,
    ListOrdered,
    Maximize2,
    Minimize2,
    Quote,
    Redo2,
    RemoveFormatting,
    Search,
    Strikethrough,
    UnderlineIcon,
    Undo2,
} from "lucide-react";

import type { DramaScriptRichContent } from "@/lib/drama-script-rich-content";
import { dramaRichContentToPlainText, normalizeDramaScriptRichContent, plainTextToDramaRichContent } from "@/lib/drama-script-rich-content";
import type { DramaEpisode } from "../types";

const TEXT_COLORS = [
    { key: "default", value: "" },
    { key: "black", value: "#111827" },
    { key: "darkGray", value: "#4b5563" },
    { key: "red", value: "#dc2626" },
    { key: "orange", value: "#ea580c" },
    { key: "yellow", value: "#ca8a04" },
    { key: "green", value: "#16a34a" },
    { key: "blue", value: "#2563eb" },
    { key: "purple", value: "#7c3aed" },
] as const;

const HIGHLIGHTS = [
    { key: "none", value: "" },
    { key: "lightYellow", value: "#fef08a" },
    { key: "lightOrange", value: "#fed7aa" },
    { key: "lightGreen", value: "#bbf7d0" },
    { key: "lightBlue", value: "#bfdbfe" },
    { key: "lightPurple", value: "#ddd6fe" },
    { key: "lightRed", value: "#fecaca" },
] as const;

export function DramaRichScriptEditor({
    episode,
    fullscreen,
    onFullscreenChange,
    onChange,
    onReady,
}: {
    episode: DramaEpisode;
    fullscreen: boolean;
    onFullscreenChange: (value: boolean) => void;
    onChange: (script: string, scriptRichContent: DramaScriptRichContent) => void;
    onReady: (selectText: (value: string) => void) => void;
}) {
    const t = useTranslations("drama.editor.richScript");
    const format = useFormatter();
    const textColors = TEXT_COLORS.map((color) => ({ value: color.value, label: t(`colors.${color.key}`) }));
    const highlights = HIGHLIGHTS.map((color) => ({ value: color.value, label: t(`highlights.${color.key}`) }));
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchText, setSearchText] = useState("");
    const [replaceText, setReplaceText] = useState("");
    const [linkOpen, setLinkOpen] = useState(false);
    const [linkValue, setLinkValue] = useState("");
    const lastContentRef = useRef("");
    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({ link: false, underline: false }),
            Underline,
            TextStyle,
            Color,
            FontSize.configure({ types: ["textStyle"] }),
            Highlight.configure({ multicolor: true }),
            TextAlign.configure({ types: ["heading", "paragraph"] }),
            Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } }),
        ],
        content: episode.scriptRichContent || plainTextToDramaRichContent(episode.script),
        editorProps: {
            attributes: {
                class: "mr-auto min-h-full w-full max-w-[900px] px-8 py-6 text-left text-[16px] leading-[1.8] text-foreground outline-none sm:px-10 sm:py-7 [&_a]:text-violet-600 [&_a]:underline dark:[&_a]:text-violet-300 [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-violet-300 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_h1]:mb-4 [&_h1]:mt-6 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-3 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-lg [&_h3]:font-semibold [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-7 [&_p]:m-0 [&_p]:min-h-[1.8em] [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-7",
                "aria-label": t("editorAria"),
            },
            handleClick: (view) => {
                if (view.state.doc.textContent) return false;
                view.dispatch(view.state.tr.setSelection(TextSelection.atStart(view.state.doc)));
                view.focus();
                return true;
            },
        },
        onCreate: ({ editor: instance }) => {
            lastContentRef.current = JSON.stringify(instance.getJSON());
        },
        onUpdate: ({ editor: instance }) => {
            const richContent = normalizeDramaScriptRichContent(instance.getJSON());
            if (!richContent) return;
            lastContentRef.current = JSON.stringify(richContent);
            onChange(dramaRichContentToPlainText(richContent).trim(), richContent);
        },
    });

    useEffect(() => {
        if (!editor) return;
        const next = episode.scriptRichContent || plainTextToDramaRichContent(episode.script);
        const serialized = JSON.stringify(next);
        if (serialized === lastContentRef.current) return;
        lastContentRef.current = serialized;
        editor.commands.setContent(next, { emitUpdate: false });
    }, [editor, episode.id, episode.script, episode.scriptRichContent]);

    useEffect(() => {
        if (!editor) return;
        onReady((value) => selectText(editor, value));
    }, [editor, onReady]);

    useEffect(() => {
        if (!fullscreen) return;
        const exit = (event: KeyboardEvent) => event.key === "Escape" && onFullscreenChange(false);
        window.addEventListener("keydown", exit);
        return () => window.removeEventListener("keydown", exit);
    }, [fullscreen, onFullscreenChange]);

    useEffect(() => {
        const openSearch = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
                event.preventDefault();
                setSearchOpen(true);
            }
        };
        window.addEventListener("keydown", openSearch);
        return () => window.removeEventListener("keydown", openSearch);
    }, []);

    if (!editor) return <div className="min-h-0 flex-1 bg-background" />;

    const findNext = () => {
        if (!searchText) return;
        const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n", "\n");
        const currentOffset = editor.state.doc.textBetween(0, editor.state.selection.to, "\n", "\n").length;
        const next = text.indexOf(searchText, currentOffset);
        const offset = next >= 0 ? next : text.indexOf(searchText);
        if (offset < 0) return;
        editor
            .chain()
            .focus()
            .setTextSelection({ from: positionAtTextOffset(editor.state.doc, offset), to: positionAtTextOffset(editor.state.doc, offset + searchText.length) })
            .run();
    };

    const replaceAll = () => {
        if (!searchText) return;
        const ranges: Array<{ from: number; to: number }> = [];
        editor.state.doc.descendants((node, pos) => {
            if (!node.isText || !node.text) return;
            let index = node.text.indexOf(searchText);
            while (index >= 0) {
                ranges.push({ from: pos + index, to: pos + index + searchText.length });
                index = node.text.indexOf(searchText, index + searchText.length);
            }
        });
        if (!ranges.length) return;
        let transaction = editor.state.tr;
        for (const range of ranges.reverse()) transaction = transaction.insertText(replaceText, range.from, range.to);
        editor.view.dispatch(transaction);
        editor.commands.focus();
    };

    const applyLink = () => {
        const href = linkValue.trim();
        if (!href) editor.chain().focus().unsetLink().run();
        else editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
        setLinkOpen(false);
    };

    return (
        <section className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border border-border bg-background ${fullscreen ? "fixed inset-3 z-[1100] rounded-md shadow-2xl" : "rounded-md"}`} data-drama-script-editor>
            <div className="hide-scrollbar flex h-[46px] shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2" aria-label={t("toolbarAria")} data-drama-script-toolbar>
                <Select
                    size="small"
                    className="!w-[88px] shrink-0"
                    value={editor.isActive("heading", { level: 1 }) ? "h1" : editor.isActive("heading", { level: 2 }) ? "h2" : editor.isActive("heading", { level: 3 }) ? "h3" : "p"}
                    options={[
                        { label: t("paragraph"), value: "p" },
                        { label: t("heading", { level: 1 }), value: "h1" },
                        { label: t("heading", { level: 2 }), value: "h2" },
                        { label: t("heading", { level: 3 }), value: "h3" },
                    ]}
                    onChange={(value) =>
                        value === "p"
                            ? editor.chain().focus().setParagraph().run()
                            : editor
                                  .chain()
                                  .focus()
                                  .toggleHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 })
                                  .run()
                    }
                    aria-label={t("paragraphStyle")}
                />
                <Select
                    size="small"
                    className="!w-[66px] shrink-0"
                    value={editor.getAttributes("textStyle").fontSize || "16px"}
                    options={[12, 14, 16, 18, 20, 24].map((size) => ({ label: size, value: `${size}px` }))}
                    onChange={(value) => editor.chain().focus().setFontSize(value).run()}
                    aria-label={t("fontSize")}
                />
                <ToolbarDivider />
                <ToolButton label={t("bold")} active={editor.isActive("bold")} disabled={!editor.can().chain().focus().toggleBold().run()} icon={<Bold />} onClick={() => editor.chain().focus().toggleBold().run()} />
                <ToolButton label={t("italic")} active={editor.isActive("italic")} disabled={!editor.can().chain().focus().toggleItalic().run()} icon={<Italic />} onClick={() => editor.chain().focus().toggleItalic().run()} />
                <ToolButton label={t("underline")} active={editor.isActive("underline")} icon={<UnderlineIcon />} onClick={() => editor.chain().focus().toggleUnderline().run()} />
                <ToolButton label={t("strikethrough")} active={editor.isActive("strike")} icon={<Strikethrough />} onClick={() => editor.chain().focus().toggleStrike().run()} />
                <PaletteButton
                    label={t("textColor")}
                    icon={<span className="text-sm font-semibold">A</span>}
                    colors={textColors}
                    activeColor={editor.getAttributes("textStyle").color}
                    onSelect={(value) => (value ? editor.chain().focus().setColor(value).run() : editor.chain().focus().unsetColor().run())}
                />
                <PaletteButton
                    label={t("highlightColor")}
                    icon={<Highlighter />}
                    colors={highlights}
                    activeColor={editor.getAttributes("highlight").color}
                    onSelect={(value) => (value ? editor.chain().focus().setHighlight({ color: value }).run() : editor.chain().focus().unsetHighlight().run())}
                />
                <ToolbarDivider />
                <ToolButton label={t("bulletList")} active={editor.isActive("bulletList")} icon={<List />} onClick={() => editor.chain().focus().toggleBulletList().run()} />
                <ToolButton label={t("numberedList")} active={editor.isActive("orderedList")} icon={<ListOrdered />} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
                <ToolButton label={t("decreaseIndent")} disabled={!editor.can().liftListItem("listItem")} icon={<IndentDecrease />} onClick={() => editor.chain().focus().liftListItem("listItem").run()} />
                <ToolButton label={t("increaseIndent")} disabled={!editor.can().sinkListItem("listItem")} icon={<IndentIncrease />} onClick={() => editor.chain().focus().sinkListItem("listItem").run()} />
                <AlignmentButton editor={editor} />
                <ToolButton label={t("quote")} active={editor.isActive("blockquote")} icon={<Quote />} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
                <Popover
                    open={linkOpen}
                    onOpenChange={(open) => {
                        setLinkOpen(open);
                        if (open) setLinkValue(editor.getAttributes("link").href || "");
                    }}
                    trigger="click"
                    placement="bottom"
                    content={
                        <div className="flex w-[280px] gap-2">
                            <Input size="small" value={linkValue} placeholder="https://example.com" onChange={(event) => setLinkValue(event.target.value)} onPressEnter={applyLink} aria-label={t("linkAddress")} />
                            <Button size="small" type="primary" onClick={applyLink}>
                                {t("confirm")}
                            </Button>
                        </div>
                    }
                >
                    <span>
                        <ToolButton label={t("link")} active={editor.isActive("link")} icon={<Link2 />} onClick={() => setLinkOpen(true)} />
                    </span>
                </Popover>
                <ToolButton label={t("clearFormatting")} icon={<RemoveFormatting />} onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} />
                <ToolbarDivider />
                <ToolButton label={t("undo")} disabled={!editor.can().undo()} icon={<Undo2 />} onClick={() => editor.chain().focus().undo().run()} />
                <ToolButton label={t("redo")} disabled={!editor.can().redo()} icon={<Redo2 />} onClick={() => editor.chain().focus().redo().run()} />
                <ToolButton label={t("find")} icon={<Search />} onClick={() => setSearchOpen(true)} />
                <ToolButton label={fullscreen ? t("exitFullscreen") : t("fullscreen")} icon={fullscreen ? <Minimize2 /> : <Maximize2 />} onClick={() => onFullscreenChange(!fullscreen)} />
                <span className="ml-auto shrink-0 px-2 text-[11px] tabular-nums text-muted-foreground">{t("characterCount", { count: format.number(episode.script.length) })}</span>
            </div>
            <EditorContent editor={editor} className="hide-scrollbar min-h-0 flex-1 overflow-y-auto bg-card/35" />
            <Modal title={t("findReplace")} open={searchOpen} width={420} centered destroyOnHidden okText={t("replaceAll")} cancelText={t("close")} okButtonProps={{ disabled: !searchText }} onCancel={() => setSearchOpen(false)} onOk={replaceAll}>
                <div className="space-y-3 py-1">
                    <Input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder={t("findContent")} aria-label={t("findContent")} onPressEnter={findNext} />
                    <Input value={replaceText} onChange={(event) => setReplaceText(event.target.value)} placeholder={t("replaceWith")} aria-label={t("replaceWith")} />
                    <Button icon={<Search className="size-3.5" />} disabled={!searchText} onClick={findNext}>
                        {t("findNext")}
                    </Button>
                </div>
            </Modal>
        </section>
    );
}

function ToolButton({ label, icon, active = false, disabled = false, onClick }: { label: string; icon: React.ReactNode; active?: boolean; disabled?: boolean; onClick: () => void }) {
    return (
        <Tooltip title={label}>
            <Button
                type="text"
                className={`!size-8 !min-w-8 !rounded ${active ? "!bg-violet-100 !text-violet-700 dark:!bg-violet-950/60 dark:!text-violet-300" : "!text-muted-foreground hover:!bg-muted hover:!text-foreground"} [&_svg]:!size-4`}
                icon={icon}
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onClick}
                aria-label={label}
                aria-pressed={active}
            />
        </Tooltip>
    );
}

function PaletteButton({ label, icon, colors, activeColor, onSelect }: { label: string; icon: React.ReactNode; colors: ReadonlyArray<{ label: string; value: string }>; activeColor?: string; onSelect: (value: string) => void }) {
    return (
        <Popover
            trigger="click"
            placement="bottom"
            content={
                <div className="w-[204px]">
                    <div className="mb-2 text-xs font-medium">{label}</div>
                    <div className="grid grid-cols-5 gap-2">
                        {colors.map((color) => (
                            <Tooltip key={color.label} title={color.label}>
                                <button
                                    type="button"
                                    className={`grid size-8 place-items-center rounded border transition hover:scale-105 ${activeColor === color.value ? "border-violet-500 ring-2 ring-violet-200 dark:ring-violet-900" : "border-border"}`}
                                    style={{ backgroundColor: color.value || undefined }}
                                    onClick={() => onSelect(color.value)}
                                    aria-label={color.label}
                                >
                                    {!color.value ? <span className="h-px w-5 -rotate-45 bg-rose-500" /> : null}
                                </button>
                            </Tooltip>
                        ))}
                    </div>
                </div>
            }
        >
            <Button type="text" className="relative !size-8 !min-w-8 !rounded !text-muted-foreground hover:!bg-muted hover:!text-foreground [&_svg]:!size-4" icon={icon} aria-label={label}>
                <ChevronDown className="absolute bottom-0.5 right-0.5 !size-2.5" />
                {activeColor ? <span className="absolute inset-x-1.5 bottom-0 h-0.5 rounded" style={{ backgroundColor: activeColor }} /> : null}
            </Button>
        </Popover>
    );
}

function AlignmentButton({ editor }: { editor: NonNullable<ReturnType<typeof useEditor>> }) {
    const t = useTranslations("drama.editor.richScript");
    const alignments = [
        { label: t("alignLeft"), value: "left", icon: <AlignLeft /> },
        { label: t("alignCenter"), value: "center", icon: <AlignCenter /> },
        { label: t("alignRight"), value: "right", icon: <AlignRight /> },
        { label: t("alignJustify"), value: "justify", icon: <AlignJustify /> },
    ];
    const current = alignments.find((item) => editor.isActive({ textAlign: item.value })) || alignments[0];
    return (
        <Popover
            trigger="click"
            placement="bottom"
            content={
                <div className="flex gap-1">
                    {alignments.map((item) => (
                        <ToolButton key={item.value} label={item.label} active={current.value === item.value} icon={item.icon} onClick={() => editor.chain().focus().setTextAlign(item.value).run()} />
                    ))}
                </div>
            }
        >
            <Button type="text" className="!size-8 !min-w-8 !rounded !text-muted-foreground hover:!bg-muted hover:!text-foreground [&_svg]:!size-4" icon={current.icon} aria-label={t("textAlignment")} />
        </Popover>
    );
}

function ToolbarDivider() {
    return <Divider orientation="vertical" className="!mx-1 !h-5 !border-border" />;
}

function selectText(editor: NonNullable<ReturnType<typeof useEditor>>, value: string) {
    const source = value.trim();
    if (!source) return;
    const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n", "\n");
    const offset = text.indexOf(source);
    editor
        .chain()
        .focus()
        .setTextSelection(offset < 0 ? 1 : { from: positionAtTextOffset(editor.state.doc, offset), to: positionAtTextOffset(editor.state.doc, offset + source.length) })
        .scrollIntoView()
        .run();
}

function positionAtTextOffset(doc: { content: { size: number }; textBetween: (from: number, to: number, blockSeparator?: string, leafText?: string) => string }, offset: number) {
    let low = 0;
    let high = doc.content.size;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        const length = doc.textBetween(0, middle, "\n", "\n").length;
        if (length < offset) low = middle + 1;
        else high = middle;
    }
    return Math.max(1, Math.min(doc.content.size, low));
}
