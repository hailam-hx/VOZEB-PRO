import { expect, test } from "@playwright/test";

test("request nonce does not produce a JSON-LD hydration mismatch", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "The desktop Chromium project covers browser nonce hydration");
    const consoleErrors: string[] = [];
    const onConsole = (message: { type(): string; text(): string }) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    };
    page.on("console", onConsole);

    try {
        await page.goto("/gallery", { waitUntil: "domcontentloaded" });
        await expect(page.locator("#website-json-ld")).toHaveCount(1);
        await page.waitForLoadState("networkidle");

        const nonceHydrationWarnings = consoleErrors.filter((message) => message.includes("WebsiteStructuredData") && message.includes("nonce")).map(() => "WebsiteStructuredData nonce hydration mismatch");
        expect(nonceHydrationWarnings).toEqual([]);
    } finally {
        page.off("console", onConsole);
    }
});
