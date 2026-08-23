"use client";

import { Button, Popover } from "antd";
import { ArrowLeftRight, ImagePlus, Upload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { CreativeAsset } from "@/lib/creative-runtime-contract";
import { imagePreviewUrl } from "@/lib/media-image-url";
import type { CreativeVideoReferenceMode, VideoReferenceRole } from "@/lib/video-reference-contract";
import { cn } from "@/lib/utils";

type FrameRole = Extract<VideoReferenceRole, "first_frame" | "last_frame">;
type FramePopoverPlacement = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

export function CreativeVideoFrameControls({
    mode,
    images,
    firstFrameAssetId,
    lastFrameAssetId,
    uploading,
    placement,
    onSelect,
    onUpload,
    onRemove,
}: {
    mode: CreativeVideoReferenceMode;
    images: CreativeAsset[];
    firstFrameAssetId?: string;
    lastFrameAssetId?: string;
    uploading: boolean;
    placement: "topLeft" | "bottomLeft";
    onSelect: (role: FrameRole, assetId: string) => void;
    onUpload: (role: FrameRole) => void;
    onRemove: (role: FrameRole) => void;
}) {
    const t = useTranslations("create");
    if (mode === "reference") return null;
    return (
        <div className="flex shrink-0 items-start gap-1" aria-label={mode === "first_last" ? t("videoFirstAndLastFrames") : t("videoFirstFrame")}>
            <FrameSlot
                role="first_frame"
                label={t("firstFrame")}
                assetId={firstFrameAssetId}
                images={images}
                uploading={uploading}
                placement={placement === "bottomLeft" ? "bottomLeft" : "topLeft"}
                onSelect={onSelect}
                onUpload={onUpload}
                onRemove={onRemove}
            />
            {mode === "first_last" ? (
                <>
                    <ArrowLeftRight className="mt-7 size-3.5 shrink-0 text-[#9aa3ad] dark:text-[#7d8793]" aria-hidden="true" />
                    <FrameSlot
                        role="last_frame"
                        label={t("lastFrame")}
                        assetId={lastFrameAssetId}
                        images={images}
                        uploading={uploading}
                        placement={placement === "bottomLeft" ? "bottomRight" : "topRight"}
                        onSelect={onSelect}
                        onUpload={onUpload}
                        onRemove={onRemove}
                    />
                </>
            ) : null}
        </div>
    );
}

function FrameSlot({
    role,
    label,
    assetId,
    images,
    uploading,
    placement,
    onSelect,
    onUpload,
    onRemove,
}: {
    role: FrameRole;
    label: string;
    assetId?: string;
    images: CreativeAsset[];
    uploading: boolean;
    placement: FramePopoverPlacement;
    onSelect: (role: FrameRole, assetId: string) => void;
    onUpload: (role: FrameRole) => void;
    onRemove: (role: FrameRole) => void;
}) {
    const t = useTranslations("create");
    const [open, setOpen] = useState(false);
    const asset = images.find((item) => item.id === assetId);
    const url = assetUrl(asset);
    return (
        <div className="relative h-16 w-14 shrink-0">
            <Popover
                trigger="click"
                placement={placement}
                arrow={false}
                destroyOnHidden
                open={open}
                onOpenChange={setOpen}
                content={
                    <div className="w-64 max-w-[calc(100vw-40px)] py-0.5 sm:w-80">
                        <p className="px-1 pb-2 text-xs font-semibold text-[#303943] dark:text-[#eef1f4]">{t("selectFrameImage", { frame: label })}</p>
                        <div className="hide-scrollbar grid max-h-52 grid-cols-3 gap-1.5 overflow-y-auto">
                            {images.map((item) => {
                                const itemUrl = assetUrl(item);
                                const selected = item.id === assetId;
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        disabled={!itemUrl}
                                        className={cn(
                                            "relative aspect-square min-w-0 overflow-hidden rounded-lg border bg-[#f1f3f5] transition disabled:opacity-40 dark:bg-[#2a2f36]",
                                            selected ? "border-[#4d7f99] ring-2 ring-[#4d7f99]/20 dark:border-[#82adc3]" : "border-[#e0e4e8] hover:border-[#aeb8c2] dark:border-[#3b424b] dark:hover:border-[#626d78]",
                                        )}
                                        onClick={() => {
                                            onSelect(role, item.id);
                                            setOpen(false);
                                        }}
                                        aria-label={t("setAsFrame", { frame: label, name: item.title })}
                                    >
                                        {itemUrl ? <img src={imagePreviewUrl(itemUrl, 320)} alt="" className="size-full object-cover" /> : <ImagePlus className="absolute inset-0 m-auto size-4 text-[#9aa3ad]" />}
                                    </button>
                                );
                            })}
                        </div>
                        {!images.length ? <p className="py-4 text-center text-xs text-[#8b949f] dark:text-[#7f8996]">{t("noImageMaterialThisRound")}</p> : null}
                        <Button
                            type="text"
                            block
                            className="mt-2 !h-9 !justify-start !rounded-lg !text-xs"
                            icon={<Upload className="size-3.5" />}
                            loading={uploading}
                            onClick={() => {
                                setOpen(false);
                                onUpload(role);
                            }}
                        >
                            {t("uploadNewImage")}
                        </Button>
                    </div>
                }
            >
                <button
                    type="button"
                    className={cn(
                        "relative grid size-14 place-items-center overflow-hidden rounded-lg border border-[#dfe4e8] bg-[#f1f3f5] text-[#84909c] shadow-[0_2px_8px_rgba(38,49,65,0.08)] transition hover:border-[#aeb8c2] hover:text-[#3f4a55] dark:border-[#3c444d] dark:bg-[#191c20] dark:text-[#9ea8b3] dark:hover:border-[#626d78] dark:hover:text-white",
                        role === "first_frame" ? "rotate-[-3deg]" : "rotate-[3deg]",
                    )}
                    aria-label={asset ? t("replaceVideoFrame", { frame: label }) : t("addVideoFrame", { frame: label })}
                >
                    {url ? (
                        <img src={imagePreviewUrl(url, 320)} alt={asset?.title || label} className="size-full object-cover" />
                    ) : (
                        <span className="grid size-full place-items-center bg-[#f1f3f5] dark:bg-[#242930]">
                            <ImagePlus className="size-5" />
                        </span>
                    )}
                    <span className="absolute inset-x-0 bottom-0 bg-black/45 px-1 py-0.5 text-center text-[9px] font-medium text-white">{asset ? label : t("addFrame", { frame: label })}</span>
                </button>
            </Popover>
            {asset ? (
                <button
                    type="button"
                    className="absolute -right-1 -top-1 z-10 grid size-5 place-items-center rounded-full border border-white bg-black/60 text-white transition hover:bg-black/80 dark:border-[#181b20]"
                    onClick={() => onRemove(role)}
                    aria-label={t("removeVideoFrame", { frame: label })}
                >
                    <X className="size-3.5" />
                </button>
            ) : null}
        </div>
    );
}

function assetUrl(asset: CreativeAsset | undefined) {
    return asset?.serverUrl || asset?.remoteUrl || "";
}
