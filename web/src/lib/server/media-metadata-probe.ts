import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runFfprobe } from "./ffmpeg";

export type VerifiedMediaMetadata = { durationMs?: number; width?: number; height?: number; audioPresent?: boolean };

export async function probeMediaBytes(bytes: Uint8Array, mimeType: string): Promise<VerifiedMediaMetadata | undefined> {
    const directory = await mkdtemp(join(tmpdir(), "vozeb-media-probe-"));
    const filePath = join(directory, `input${extensionForMime(mimeType)}`);
    try {
        await writeFile(filePath, bytes);
        const result = await runFfprobe(["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", filePath]);
        const payload = JSON.parse(result.stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number }> };
        const durationSeconds = Number(payload.format?.duration);
        const video = payload.streams?.find((stream) => stream.codec_type === "video");
        const audioPresent = payload.streams?.some((stream) => stream.codec_type === "audio") || false;
        const durationMs = Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds * 1000) : undefined;
        const width = positiveInteger(video?.width);
        const height = positiveInteger(video?.height);
        return durationMs || width || height ? { ...(durationMs ? { durationMs } : {}), ...(width ? { width } : {}), ...(height ? { height } : {}), audioPresent } : undefined;
    } catch {
        return undefined;
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

function positiveInteger(value: unknown) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function extensionForMime(mimeType: string) {
    if (mimeType === "video/webm") return ".webm";
    if (mimeType === "video/quicktime") return ".mov";
    if (mimeType.startsWith("video/")) return ".mp4";
    if (mimeType.includes("wav")) return ".wav";
    return ".bin";
}
