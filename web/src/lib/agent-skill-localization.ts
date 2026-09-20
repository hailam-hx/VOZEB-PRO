import type { AgentSkillSummary } from "@/services/api/agent-skills";

const BUILT_IN_AGENT_SKILL_KEYS = {
    "ecommerce-image": "ecommerceImage",
    "yanai-natural-beauty": "naturalBeauty",
    "character-design": "characterDesign",
    "image-motion": "imageMotion",
    "drama-planning": "dramaPlanning",
} as const;

type BuiltInAgentSkillKey = (typeof BUILT_IN_AGENT_SKILL_KEYS)[keyof typeof BUILT_IN_AGENT_SKILL_KEYS];
export type BuiltInAgentSkillTranslationKey = `${BuiltInAgentSkillKey}.${"name" | "description"}`;

export function localizeBuiltInAgentSkills(skills: AgentSkillSummary[], translate: (key: BuiltInAgentSkillTranslationKey) => string): AgentSkillSummary[] {
    return skills.map((skill) => {
        const key = BUILT_IN_AGENT_SKILL_KEYS[skill.id as keyof typeof BUILT_IN_AGENT_SKILL_KEYS];
        return key ? { ...skill, name: translate(`${key}.name`), description: translate(`${key}.description`) } : skill;
    });
}
