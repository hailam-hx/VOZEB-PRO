import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { readFile } from "node:fs/promises";

import { fileTypeFromBuffer } from "file-type";

import defaultFixturePack from "../../../validation-fixtures/manifest.json";

import { MAX_MEDIA_PROXY_BYTES, limitMediaResponseBody } from "./media-response-limit";
import { probeMediaBytes } from "./media-metadata-probe";
import { fetchSafeOutbound } from "./safe-outbound-fetch";

export type ValidationFixtureAsset = {
    publicUrl: string | null;
    mimeType: string | null;
    sha256: string | null;
    durationMs: number | null;
    width: number | null;
    height: number | null;
    audioPresent: boolean | null;
    speechPresent: boolean | null;
    faceCount: number | null;
    purpose: string;
    annotationEvidence?: string | null;
    reachabilityEvidence?: string | null;
};
export type ValidationFixturePack = { version: 1; assets: Record<string, ValidationFixtureAsset> };
type Inspection = { bytes: Uint8Array; mimeType: string; durationMs?: number; width?: number; height?: number; audioPresent?: boolean };
type AssetResult = { verified: boolean; reason?: string; asset: ValidationFixtureAsset };

export async function loadValidationFixturePack(): Promise<ValidationFixturePack> {
    const path = process.env.VOZEB_PRO_VIDEO_VALIDATION_FIXTURE_MANIFEST_PATH?.trim();
    if (!path) return defaultFixturePack as ValidationFixturePack;
    try {
        const parsed: unknown = JSON.parse(await readFile(/* turbopackIgnore: true */ path, "utf8"));
        if (!parsed || typeof parsed !== "object" || (parsed as { version?: unknown }).version !== 1 || !((parsed as { assets?: unknown }).assets && typeof (parsed as { assets?: unknown }).assets === "object")) throw new Error("invalid manifest");
        return parsed as ValidationFixturePack;
    } catch {
        return { version: 1, assets: {} };
    }
}

export async function verifyValidationFixturePack(pack: ValidationFixturePack, dependencies: { inspect?: (url: string) => Promise<Inspection> } = {}) {
    const assets: Record<string, AssetResult> = {};
    for (const [name, asset] of Object.entries(pack.assets)) {
        const reason = await verifyAsset(asset, dependencies.inspect || inspectPublicFixture);
        assets[name] = { verified: !reason, ...(reason ? { reason } : {}), asset };
    }
    return { ready: Object.values(assets).length > 0 && Object.values(assets).every((item) => item.verified), assets };
}

async function verifyAsset(asset: ValidationFixtureAsset, inspect: (url: string) => Promise<Inspection>): Promise<string | undefined> {
    if (!asset || !asset.publicUrl || !safePublicHttps(asset.publicUrl)) return "FIXTURE_URL_UNSAFE";
    if (ephemeralUrl(asset.publicUrl)) return "FIXTURE_URL_EPHEMERAL";
    if (!asset.mimeType || !asset.sha256 || !/^[a-f0-9]{64}$/i.test(asset.sha256)) return "FIXTURE_METADATA_INCOMPLETE";
    if (!asset.reachabilityEvidence?.trim()) return "FIXTURE_EXTERNAL_REACHABILITY_UNVERIFIED";
    if (asset.speechPresent === true || (asset.faceCount !== null && asset.faceCount > 0)) {
        if (!asset.annotationEvidence?.trim()) return "FIXTURE_ANNOTATION_UNVERIFIED";
    }
    try {
        const actual = await inspect(asset.publicUrl);
        if (actual.mimeType !== asset.mimeType) return "FIXTURE_MIME_MISMATCH";
        if (createHash("sha256").update(actual.bytes).digest("hex").toLowerCase() !== asset.sha256.toLowerCase()) return "FIXTURE_HASH_MISMATCH";
        if (asset.durationMs !== actual.durationMs) return "FIXTURE_DURATION_MISMATCH";
        if (asset.width !== (actual.width ?? null) || asset.height !== (actual.height ?? null) || asset.audioPresent !== (actual.audioPresent ?? null)) return "FIXTURE_MEDIA_METADATA_MISMATCH";
        return undefined;
    } catch {
        return "FIXTURE_UNREACHABLE";
    }
}

export function safePublicHttps(value: string) {
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        return url.protocol === "https:" && !url.username && !url.password && Boolean(host) && !isIP(host) && host !== "localhost" && !host.endsWith(".localhost") && !host.endsWith(".local") && !host.endsWith(".internal");
    } catch {
        return false;
    }
}

function ephemeralUrl(value: string) {
    return Boolean(new URL(value).search);
}

async function inspectPublicFixture(url: string): Promise<Inspection> {
    const response = await fetchSafeOutbound(url, { redirect: "manual" });
    if (!response.ok || !response.body) throw new Error("fixture fetch failed");
    const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() || "";
    const stream = limitMediaResponseBody(response.body, MAX_MEDIA_PROXY_BYTES);
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    const detected = await fileTypeFromBuffer(bytes);
    if (!detected || detected.mime !== mimeType) throw new Error("fixture MIME mismatch");
    const metadata = await probeMediaBytes(bytes, mimeType);
    if (!metadata) throw new Error("fixture media metadata unavailable");
    return { bytes, mimeType, ...metadata };
}
