export type CreativeUploadMediaType = "image" | "video" | "audio";

export const CREATIVE_UPLOAD_MAX_BYTES_BY_TYPE = {
    image: 20 * 1024 * 1024,
    video: 200 * 1024 * 1024,
    audio: 30 * 1024 * 1024,
} as const satisfies Record<CreativeUploadMediaType, number>;

export const CREATIVE_UPLOAD_MAX_REQUEST_BYTES = Math.max(...Object.values(CREATIVE_UPLOAD_MAX_BYTES_BY_TYPE)) + 64 * 1024;

// Image-only callers retain their existing default while all mixed-media paths use the MIME-aware policy below.
export const CREATIVE_UPLOAD_MAX_BYTES = CREATIVE_UPLOAD_MAX_BYTES_BY_TYPE.image;

export const CREATIVE_UPLOAD_MIME_TYPES = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/ogg",
    "audio/opus",
    "audio/aac",
    "audio/flac",
] as const;

export const CREATIVE_UPLOAD_ACCEPT = CREATIVE_UPLOAD_MIME_TYPES.join(",");

export function isCreativeUploadMimeType(value: string): value is (typeof CREATIVE_UPLOAD_MIME_TYPES)[number] {
    return CREATIVE_UPLOAD_MIME_TYPES.includes(value.toLowerCase() as (typeof CREATIVE_UPLOAD_MIME_TYPES)[number]);
}

export function creativeUploadMediaTypeFromMimeType(value: string): CreativeUploadMediaType | null {
    const mimeType = value.toLowerCase();
    if (!isCreativeUploadMimeType(mimeType)) return null;
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    return null;
}

export function creativeUploadMaxBytesForMimeType(value: string) {
    const type = creativeUploadMediaTypeFromMimeType(value);
    return type ? CREATIVE_UPLOAD_MAX_BYTES_BY_TYPE[type] : null;
}

export function isCreativeUploadSizeAllowed(mimeType: string, bytes: number) {
    const maxBytes = creativeUploadMaxBytesForMimeType(mimeType);
    return maxBytes !== null && Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= maxBytes;
}
