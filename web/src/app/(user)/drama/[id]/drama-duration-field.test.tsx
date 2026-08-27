// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DramaDurationField } from "./drama-duration-field";

const parameters = (overrides: Record<string, unknown>) => ({
    referenceInputs: [],
    aspectRatios: [],
    pixelSizes: [],
    supportsCustomSize: false,
    qualities: [],
    resolutions: [],
    durationSeconds: [],
    videoReferenceModes: [],
    voices: [],
    formats: [],
    ...overrides,
});

afterEach(cleanup);

describe("DramaDurationField", () => {
    it("keeps an old unsupported discrete duration visible and marks it invalid", () => {
        render(<DramaDurationField ariaLabel="镜头时长" value={7} parameters={parameters({ durationMode: "discrete", durationSeconds: [5, 10] }) as never} onChange={vi.fn()} />);

        expect(screen.getByRole("combobox", { name: "镜头时长" }).getAttribute("aria-invalid")).toBe("true");
        expect(screen.getByText("7 秒（当前不支持）")).toBeTruthy();
    });

    it("submits the original in-range decimal and rejects an out-of-range edit", async () => {
        const onChange = vi.fn();
        render(<DramaDurationField ariaLabel="镜头时长" value={3.75} parameters={parameters({ durationMode: "range", durationRange: { min: 1.5, max: 6.5 } }) as never} onChange={onChange} />);
        const input = screen.getByRole("spinbutton", { name: "镜头时长" });

        fireEvent.change(input, { target: { value: "4.25" } });
        expect(onChange).toHaveBeenLastCalledWith(4.25);
        fireEvent.change(input, { target: { value: "6.51" } });
        expect(onChange).not.toHaveBeenCalledWith(6.51);
        await userEvent.setup().hover(input.closest<HTMLElement>("[data-capability-tooltip]") || input);
    });

    it("allows a custom shot duration alongside configured discrete duration options", () => {
        const onChange = vi.fn();
        render(<DramaDurationField ariaLabel="镜头时长" value={7} parameters={parameters({ durationMode: "discrete", durationSeconds: [4, 15], supportsCustomDuration: true, customDurationRange: { min: 3, max: 20 } }) as never} onChange={onChange} />);
        const input = screen.getByRole("spinbutton", { name: "镜头时长" });

        expect((input as HTMLInputElement).disabled).toBe(false);
        expect(input.getAttribute("aria-invalid")).toBe("false");
        fireEvent.change(input, { target: { value: "8.5" } });
        expect(onChange).toHaveBeenCalledWith(8.5);
        fireEvent.change(input, { target: { value: "20.1" } });
        expect(onChange).not.toHaveBeenCalledWith(20.1);
    });
});
