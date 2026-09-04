import { readFile } from "node:fs/promises";

import { fileTypeFromBuffer } from "file-type";
import { parseBuffer } from "music-metadata";

import { getLocalMediaRegistration } from "@/lib/server/local-media-registry";
import { readExternalMediaBytes } from "@/lib/server/object-storage-service";
import { readReferenceAsset } from "@/lib/server/reference-asset-store";

const MIN_SOURCE_SECONDS = 5;
const MAX_SOURCE_SECONDS = 180;

export class VoiceProfileSourceError extends Error {
    constructor(
        message: string,
        readonly status = 400,
    ) {
        super(message);
    }
}

export async function inspectVoiceProfileSource(userId: string, storageKey: string) {
    const registration = await getLocalMediaRegistration(storageKey);
    if (!registration || registration.ownerUserId !== userId) throw new VoiceProfileSourceError("声音样本不存在", 404);
    if (registration.scope !== "reference" || registration.type !== "audio" || !registration.mimeType.startsWith("audio/")) throw new VoiceProfileSourceError("声音样本必须是真实音频文件");

    const bytes = registration.storageProvider === "object" ? await readExternalMediaBytes(registration) : await readLocalBytes(storageKey);
    if (!bytes?.length) throw new VoiceProfileSourceError("声音样本不存在", 404);
    const detected = await fileTypeFromBuffer(bytes);
    if (!detected?.mime.startsWith("audio/")) throw new VoiceProfileSourceError("声音样本必须是真实音频文件");

    let durationSeconds = 0;
    try {
        const metadata = await parseBuffer(bytes, { mimeType: detected.mime, size: bytes.length }, { duration: true, skipCovers: true });
        durationSeconds = Number(metadata.format.duration);
    } catch {
        throw new VoiceProfileSourceError("无法读取声音样本元数据");
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds < MIN_SOURCE_SECONDS || durationSeconds > MAX_SOURCE_SECONDS) throw new VoiceProfileSourceError("声音样本时长必须为 5–180 秒");

    return {
        storageKey: registration.storageKey,
        mimeType: detected.mime,
        bytes: registration.bytes,
        durationSeconds: Math.round(durationSeconds * 1_000) / 1_000,
    };
}

async function readLocalBytes(storageKey: string) {
    const asset = await readReferenceAsset(storageKey);
    return asset ? readFile(asset.filePath) : null;
}
