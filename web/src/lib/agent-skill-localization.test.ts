import { describe, expect, it } from "vitest";

import en from "@/i18n/messages/en.json";
import vi from "@/i18n/messages/vi.json";
import zhCN from "@/i18n/messages/zh-CN.json";
import type { AgentSkillSummary } from "@/services/api/agent-skills";
import { localizeBuiltInAgentSkills, type BuiltInAgentSkillTranslationKey } from "./agent-skill-localization";

const skills: AgentSkillSummary[] = [
    { id: "ecommerce-image", name: "电商生图", description: "原始电商描述" },
    { id: "yanai-natural-beauty", name: "自然美颜精修", description: "原始美颜描述" },
    { id: "character-design", name: "角色设定", description: "原始角色描述" },
    { id: "image-motion", name: "图片动效", description: "原始动效描述" },
    { id: "drama-planning", name: "短剧策划", description: "原始短剧描述" },
    { id: "custom-skill", name: "Tên quản trị", description: "Mô tả quản trị" },
];

const cases = [
    {
        locale: "vi",
        messages: vi,
        names: ["Ảnh thương mại", "Chỉnh sửa chân dung tự nhiên", "Thiết kế nhân vật", "Ảnh chuyển động", "Lập kế hoạch phim ngắn"],
    },
    {
        locale: "en",
        messages: en,
        names: ["E-commerce Images", "Natural Portrait Retouching", "Character Design", "Image Animation", "Short Drama Planning"],
    },
    {
        locale: "zh-CN",
        messages: zhCN,
        names: ["电商生图", "自然美颜精修", "角色设定", "图片动效", "短剧策划"],
    },
] as const;

describe("localizeBuiltInAgentSkills", () => {
    it.each(cases)("localizes the five built-in skills for $locale without changing custom skills", ({ messages, names }) => {
        const original = structuredClone(skills);
        const translations = messages.create.builtInSkills;
        const localized = localizeBuiltInAgentSkills(skills, (key: BuiltInAgentSkillTranslationKey) => {
            const [skill, field] = key.split(".") as [keyof typeof translations, "name" | "description"];
            return translations[skill][field];
        });

        expect(localized.slice(0, 5).map((skill) => skill.name)).toEqual(names);
        expect(localized.slice(0, 5).every((skill) => skill.description !== "" && !skill.description.startsWith("原始"))).toBe(true);
        expect(localized[5]).toBe(skills[5]);
        expect(localized[5]).toEqual({ id: "custom-skill", name: "Tên quản trị", description: "Mô tả quản trị" });
        expect(skills).toEqual(original);
    });
});
