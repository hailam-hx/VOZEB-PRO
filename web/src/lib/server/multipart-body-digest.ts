import { createHash } from "node:crypto";

export async function canonicalMultipartBodyDigest(formData: FormData) {
    return processMultipartFormData(formData, false).then((result) => result.bodyDigest);
}

export async function cloneMultipartFormDataWithDigest(formData: FormData) {
    const result = await processMultipartFormData(formData, true);
    return { body: result.body!, bodyDigest: result.bodyDigest };
}

async function processMultipartFormData(formData: FormData, clone: boolean) {
    const body = clone ? new FormData() : undefined;
    const digest = createHash("sha256");
    for (const [key, value] of formData.entries()) {
        if (typeof value === "string") {
            body?.append(key, value);
            updateMultipartDigest(digest, ["field", key, value]);
            continue;
        }
        const bytes = new Uint8Array(await value.arrayBuffer());
        const type = value.type || "application/octet-stream";
        const name = value.name || "file";
        body?.append(key, new Blob([bytes], { type }), name);
        updateMultipartDigest(digest, ["file", key, name, type, String(bytes.byteLength), createHash("sha256").update(bytes).digest("hex")]);
    }
    return { body, bodyDigest: digest.digest("hex") };
}

function updateMultipartDigest(digest: ReturnType<typeof createHash>, parts: string[]) {
    for (const part of parts)
        digest
            .update(String(Buffer.byteLength(part)))
            .update(":")
            .update(part)
            .update("\0");
}
