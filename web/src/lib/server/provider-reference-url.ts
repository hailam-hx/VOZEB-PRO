import { isIP } from "node:net";

import type { VideoGenerationReference } from "@/lib/video-reference-contract";
import { createSignedReferenceAssetUrl } from "@/lib/server/reference-asset-access";
import { getLocalMediaRegistration } from "@/lib/server/local-media-registry";
import { createExternalProviderMediaReadUrl } from "@/lib/server/object-storage-service";
import { isSafeOutboundUrl } from "@/lib/server/outbound-url-security";

const REFERENCE_ASSET_PREFIX = "/api/reference-assets/";
const PROVIDER_REFERENCE_TTL_MS = 60 * 60 * 1000;
const PRIVATE_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp"];
const PUBLIC_REFERENCE_ERROR = "参考素材必须使用上游可访问的公网 URL；请配置 VOZEB_PRO_PUBLIC_BASE_URL 或启用外部对象存储";

function referenceUrlError(message: string, code: string) {
    return Object.assign(new Error(message), { code });
}

export async function resolveProviderReferenceUrls(references: VideoGenerationReference[], publicOrigin: string, ownerUserId: string) {
    return Promise.all(
        references.map(async (reference) => ({
            ...reference,
            url: await resolveProviderReferenceUrl(reference.url, publicOrigin, ownerUserId),
        })),
    );
}

export async function resolveProviderReferenceUrl(value: string, publicOrigin: string, ownerUserId: string) {
    const raw = value.trim();
    if (!raw) return raw;
    if (/^assetId:\/\/[a-zA-Z0-9._:-]+$/i.test(raw)) return raw;
    const token = referenceAssetToken(raw, publicOrigin);
    if (token) {
        const registration = await getLocalMediaRegistration(token);
        if (!registration || registration.ownerUserId !== ownerUserId) throw referenceUrlError("参考素材不存在或无权访问", "reference_asset_unavailable");
        if (registration?.storageProvider === "object") {
            const objectUrl = await createExternalProviderMediaReadUrl(registration);
            if (objectUrl && isPublicProviderMediaUrl(objectUrl) && (await isSafeOutboundUrl(objectUrl, { allowCredentials: false }))) return objectUrl;
        }
        if (!isPublicProviderOrigin(publicOrigin)) throw referenceUrlError(PUBLIC_REFERENCE_ERROR, "reference_url_not_public");
        const signedUrl = createSignedReferenceAssetUrl(token, publicOrigin, Date.now(), PROVIDER_REFERENCE_TTL_MS);
        if (!signedUrl) throw referenceUrlError("站内参考素材签名不可用，请配置 VOZEB_PRO_ENCRYPTION_KEY", "reference_url_signing_unavailable");
        if (!(await isSafeOutboundUrl(signedUrl, { allowCredentials: false }))) throw referenceUrlError(PUBLIC_REFERENCE_ERROR, "reference_url_not_public");
        return signedUrl;
    }
    if (!isPublicProviderMediaUrl(raw) || !(await isSafeOutboundUrl(raw, { allowCredentials: false }))) throw referenceUrlError(PUBLIC_REFERENCE_ERROR, "reference_url_not_public");
    return raw;
}

export function isPublicProviderMediaUrl(value: string) {
    try {
        const url = new URL(value);
        return (url.protocol === "http:" || url.protocol === "https:") && isPublicProviderHost(url.hostname);
    } catch {
        return false;
    }
}

export function isPublicProviderOrigin(value: string) {
    try {
        const url = new URL(value);
        return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value.replace(/\/+$/, "") && isPublicProviderHost(url.hostname);
    } catch {
        return false;
    }
}

function referenceAssetToken(value: string, origin: string) {
    try {
        const url = new URL(value, origin || "https://hotx.invalid");
        if (!url.pathname.startsWith(REFERENCE_ASSET_PREFIX)) return "";
        return url.pathname
            .slice(REFERENCE_ASSET_PREFIX.length)
            .split("/")
            .map((part) => decodeURIComponent(part))
            .join("/");
    } catch {
        return "";
    }
}

function isPublicProviderHost(value: string) {
    const host = value.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host || host === "localhost" || PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
    const ipVersion = isIP(host);
    if (ipVersion === 4) return isPublicIpv4(host);
    if (ipVersion === 6) return isPublicIpv6(host);
    return host.includes(".");
}

function isPublicIpv4(host: string) {
    const [a, b] = host.split(".").map(Number);
    return a !== 0 && a !== 10 && a !== 127 && a < 224 && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168) && !(a === 198 && (b === 18 || b === 19));
}

function isPublicIpv6(host: string) {
    const normalized = host.toLowerCase();
    return normalized !== "::" && normalized !== "::1" && !/^(?:fc|fd|fe8|fe9|fea|feb)/.test(normalized) && !normalized.startsWith("2001:db8:");
}
