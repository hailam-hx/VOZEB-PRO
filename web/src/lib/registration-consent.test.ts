import { describe, expect, it } from "vitest";

import { createRegistrationPolicyConsent, normalizeRegistrationPolicyConsent } from "./registration-consent";

describe("registration policy consent", () => {
    it("creates and normalizes the exact accepted policy snapshot", () => {
        const consent = createRegistrationPolicyConsent({ termsVersion: "2.0", termsUrl: "/terms", privacyVersion: "3.0", privacyUrl: "https://example.com/privacy" }, "2026-08-09T08:30:00.000Z");

        expect(normalizeRegistrationPolicyConsent(consent)).toEqual(consent);
    });

    it("rejects incomplete or invalid consent snapshots", () => {
        expect(normalizeRegistrationPolicyConsent({ termsVersion: "1.0" })).toBeUndefined();
        expect(normalizeRegistrationPolicyConsent({ termsVersion: "1.0", termsUrl: "/terms", privacyVersion: "1.0", privacyUrl: "/privacy", acceptedAt: "invalid" })).toBeUndefined();
    });

    it("preserves acceptance when administrator policy fields are intentionally empty", () => {
        const consent = createRegistrationPolicyConsent({ termsVersion: "", termsUrl: "", privacyVersion: "", privacyUrl: "" }, "2026-09-10T08:30:00.000Z");

        expect(normalizeRegistrationPolicyConsent(consent)).toEqual({ termsVersion: "", termsUrl: "", privacyVersion: "", privacyUrl: "", acceptedAt: "2026-09-10T08:30:00.000Z" });
    });

    it.each(["termsVersion", "termsUrl", "privacyVersion", "privacyUrl"])("still rejects missing or non-string %s despite a valid acceptance timestamp", (field) => {
        const consent = { termsVersion: "", termsUrl: "", privacyVersion: "", privacyUrl: "", acceptedAt: "2026-09-10T08:30:00.000Z" };
        for (const invalid of [undefined, null, 1]) expect(normalizeRegistrationPolicyConsent({ ...consent, [field]: invalid })).toBeUndefined();
    });
});
