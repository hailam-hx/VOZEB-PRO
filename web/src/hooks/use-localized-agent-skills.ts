"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { localizeBuiltInAgentSkills } from "@/lib/agent-skill-localization";
import type { AgentSkillSummary } from "@/services/api/agent-skills";

export function useLocalizedAgentSkills(skills: AgentSkillSummary[]) {
    const t = useTranslations("create.builtInSkills");
    return useMemo(() => localizeBuiltInAgentSkills(skills, (key) => t(key)), [skills, t]);
}
