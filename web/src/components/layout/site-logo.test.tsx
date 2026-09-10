// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SiteLogo } from "./site-logo";

afterEach(cleanup);

describe("SiteLogo", () => {
    it("renders the configured backend logo without leaking the current page referrer", () => {
        const markup = renderToStaticMarkup(<SiteLogo logoUrl="https://cdn.example.com/brand.svg" className="size-8" />);

        expect(markup).toContain('src="https://cdn.example.com/brand.svg"');
        expect(markup).toContain('referrerPolicy="no-referrer"');
        expect(markup).toContain('class="shrink-0 object-contain size-8"');
        expect(markup).not.toContain("mask:");
    });

    it("keeps the bundled mark as a safe loading fallback", () => {
        const markup = renderToStaticMarkup(<SiteLogo logoUrl="/hx-favicon.png" className="size-8" />);

        expect(markup).toContain('src="/hx-favicon.png"');
        expect(markup).toContain('class="shrink-0 object-contain size-8"');
        expect(markup).not.toContain("mask:");
    });

    it("renders the bundled PNG as an image when no custom logo is configured", () => {
        const markup = renderToStaticMarkup(<SiteLogo logoUrl="" className="size-8" />);

        expect(markup).toContain('src="/hx-favicon.png"');
        expect(markup).not.toContain("mask:");
    });

    it("falls back to the bundled PNG after a configured logo fails to load", () => {
        const { container } = render(<SiteLogo logoUrl="https://cdn.example.com/missing.png" className="size-8" />);

        fireEvent.error(container.querySelector("img")!);

        expect(container.querySelector('img[src="/hx-favicon.png"]')).toBeTruthy();
    });
});
