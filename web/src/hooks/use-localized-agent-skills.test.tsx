// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import viMessages from "@/i18n/messages/vi.json";
import type { AgentSkillSummary } from "@/services/api/agent-skills";
import { useLocalizedAgentSkills } from "./use-localized-agent-skills";

const skills: AgentSkillSummary[] = [
    { id: "ecommerce-image", name: "电商生图", description: "原始描述" },
    { id: "custom-skill", name: "Skill riêng", description: "Mô tả riêng" },
];

function SkillNames() {
    const localized = useLocalizedAgentSkills(skills);
    return (
        <div>
            {localized.map((skill) => (
                <span key={skill.id}>{skill.name}</span>
            ))}
        </div>
    );
}

describe("useLocalizedAgentSkills", () => {
    it("uses the active next-intl locale for built-in skills and preserves custom names", () => {
        render(
            <NextIntlClientProvider locale="vi" messages={viMessages}>
                <SkillNames />
            </NextIntlClientProvider>,
        );

        expect(screen.getByText("Ảnh thương mại")).toBeTruthy();
        expect(screen.getByText("Skill riêng")).toBeTruthy();
        expect(screen.queryByText("电商生图")).toBeNull();
    });
});
