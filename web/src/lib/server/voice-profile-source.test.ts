import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    registration: vi.fn(),
    localAsset: vi.fn(),
    objectBytes: vi.fn(),
}));

vi.mock("@/lib/server/local-media-registry", () => ({ getLocalMediaRegistration: mocks.registration }));
vi.mock("@/lib/server/reference-asset-store", () => ({ readReferenceAsset: mocks.localAsset }));
vi.mock("@/lib/server/object-storage-service", () => ({ readExternalMediaBytes: mocks.objectBytes }));

import { inspectVoiceProfileSource } from "./voice-profile-source";

function wav(seconds: number) {
    const sampleRate = 8_000;
    const samples = sampleRate * seconds;
    const bytes = Buffer.alloc(44 + samples * 2);
    bytes.write("RIFF", 0);
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write("WAVEfmt ", 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(sampleRate, 24);
    bytes.writeUInt32LE(sampleRate * 2, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write("data", 36);
    bytes.writeUInt32LE(samples * 2, 40);
    return bytes;
}

describe("voice profile source", () => {
    it("verifies ownership, real audio contents and the 5-180 second duration", async () => {
        mocks.registration.mockResolvedValue({
            storageKey: "permanent/source.wav",
            ownerUserId: "user-one",
            scope: "reference",
            type: "audio",
            mimeType: "audio/wav",
            storageProvider: "object",
            externalObjectKey: "media/source.wav",
        });
        mocks.objectBytes.mockResolvedValue(wav(6));

        await expect(inspectVoiceProfileSource("user-one", "permanent/source.wav")).resolves.toMatchObject({ storageKey: "permanent/source.wav", mimeType: "audio/wav", durationSeconds: 6 });
        await expect(inspectVoiceProfileSource("user-two", "permanent/source.wav")).rejects.toThrow("不存在");

        mocks.objectBytes.mockResolvedValueOnce(wav(4));
        await expect(inspectVoiceProfileSource("user-one", "permanent/source.wav")).rejects.toThrow("5–180");
        mocks.objectBytes.mockResolvedValueOnce(Buffer.from("not audio"));
        await expect(inspectVoiceProfileSource("user-one", "permanent/source.wav")).rejects.toThrow("音频");
    });
});
