import { isIP } from "node:net";

import type { VideoValidationReference } from "@/lib/video-validation";

export function validationFixtureUrl(reference: VideoValidationReference) {
    return (
        reference.fixture === "video" ? process.env.VOZEB_PRO_VIDEO_VALIDATION_VIDEO_FIXTURE_URL : reference.role === "last_frame" ? process.env.VOZEB_PRO_VIDEO_VALIDATION_LAST_FRAME_FIXTURE_URL : process.env.VOZEB_PRO_VIDEO_VALIDATION_IMAGE_FIXTURE_URL
    )?.trim();
}

export async function configuredValidationFixtures() {
    const image = validationFixtureUrl({ role: "first_frame", fixture: "image" });
    const last = validationFixtureUrl({ role: "last_frame", fixture: "image" });
    const video = validationFixtureUrl({ role: "reference", fixture: "video" });
    const [imageReady, lastReady, videoReady] = await Promise.all([inspect(image, "image"), image && last && image !== last ? inspect(last, "image") : false, inspect(video, "video")]);
    return { image: imageReady, lastFrame: imageReady && lastReady, video: videoReady };
}

async function inspect(value: string | undefined, kind: "image" | "video") {
    if (!value) return false;
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || !host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || isIP(host)) return false;
    try {
        const response = await fetch(url, { redirect: "manual", headers: { Range: "bytes=0-31" } });
        if (!response.ok) return false;
        const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (kind === "video") return mime === "video/mp4" && bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp";
        if (mime === "image/png") return bytes.length >= 8 && bytes.slice(0, 8).every((byte, index) => byte === [137, 80, 78, 71, 13, 10, 26, 10][index]);
        if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        return mime === "image/webp" && bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
    } catch {
        return false;
    }
}
