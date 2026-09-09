// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { useLocale, useTimeZone, useTranslations } from "next-intl";
import { LocaleProvider, SeoLocaleProvider } from "./locale-provider";

const en = { label: "English workspace" };
const zh = { label: "中文工作区" };
const vi = { label: "Không gian làm việc" };

function Workspace() {
    const t = useTranslations();
    const locale = useLocale();
    const timeZone = useTimeZone();
    const [draft, setDraft] = useState("");
    return (
        <>
            <p lang={locale} data-timezone={timeZone}>
                {t("label")}
            </p>
            <input aria-label="Draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
        </>
    );
}

afterEach(cleanup);

describe("shared locale across the SEO boundary", () => {
    it("keeps SEO locale/messages in the root when the localized subtree unmounts", () => {
        const view = render(
            <LocaleProvider locale="en" messages={en} timeZone="UTC">
                <Workspace />
                <SeoLocaleProvider locale="en" messages={en}>
                    <span>SEO</span>
                </SeoLocaleProvider>
            </LocaleProvider>,
        );
        view.rerender(
            <LocaleProvider locale="en" messages={en} timeZone="UTC">
                <Workspace />
                <SeoLocaleProvider locale="zh-CN" messages={zh}>
                    <span>SEO</span>
                </SeoLocaleProvider>
            </LocaleProvider>,
        );
        expect(screen.getByText("中文工作区").lang).toBe("zh-CN");
        expect(screen.getByText("中文工作区").dataset.timezone).toBe("UTC");
        view.rerender(
            <LocaleProvider locale="en" messages={en} timeZone="UTC">
                <Workspace />
            </LocaleProvider>,
        );
        expect(screen.getByText("中文工作区").lang).toBe("zh-CN");
    });

    it.each(["en", "vi"] as const)("accepts a later %s server refresh without remounting private draft state", (locale) => {
        const view = render(
            <LocaleProvider locale="en" messages={en} timeZone="UTC">
                <Workspace />
                <SeoLocaleProvider locale="zh-CN" messages={zh}>
                    <span>SEO</span>
                </SeoLocaleProvider>
            </LocaleProvider>,
        );
        view.rerender(
            <LocaleProvider locale="en" messages={en} timeZone="UTC">
                <Workspace />
            </LocaleProvider>,
        );
        fireEvent.change(screen.getByRole("textbox", { name: "Draft" }), { target: { value: "Keep my draft" } });
        view.rerender(
            <LocaleProvider locale={locale} messages={{ ...(locale === "en" ? en : vi) }} timeZone="UTC">
                <Workspace />
            </LocaleProvider>,
        );
        expect(screen.getByText(locale === "en" ? "English workspace" : "Không gian làm việc").lang).toBe(locale);
        expect((screen.getByRole("textbox", { name: "Draft" }) as HTMLInputElement).value).toBe("Keep my draft");
    });
});
