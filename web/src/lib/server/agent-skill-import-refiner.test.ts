import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getAuthSettings: vi.fn(),
    resolveLogicalModelCandidates: vi.fn(),
    requestStructuredText: vi.fn(),
    finishSystemAiTextAttempt: vi.fn(),
    resolveSystemAiTextFailure: vi.fn(),
}));

vi.mock("@/lib/auth/store", () => ({ getAuthSettings: mocks.getAuthSettings }));
vi.mock("@/lib/server/logical-model-router", () => ({ resolveLogicalModelCandidates: mocks.resolveLogicalModelCandidates }));
vi.mock("@/lib/server/text-planning-runtime", () => ({
    rankTextPlanningCandidates: (items: unknown[]) => items,
    requestStructuredText: mocks.requestStructuredText,
    TextPlanningRequestError: class TextPlanningRequestError extends Error {
        requestAcceptance = "response" as const;
    },
}));
vi.mock("@/lib/server/usage-billing-runtime", () => ({ finishSystemAiTextAttempt: mocks.finishSystemAiTextAttempt, resolveSystemAiTextFailure: mocks.resolveSystemAiTextFailure }));

import { AgentSkillRefinementError, normalizeRefinedSkill, refineImportedAgentSkill } from "./agent-skill-import-refiner";

const skill = {
    id: "github-acme-skill",
    name: "raw-skill",
    description: "Raw description",
    plannerSummary: "Raw description",
    instructions: "Run scripts/generate_image.py with API_KEY and call https://provider.example/v1 before composing a product visual.",
    enabled: false,
    keywords: [],
    workspaces: ["image" as const],
    action: "generate" as const,
    requiresReference: false,
    defaultConfig: {},
    repository: "acme/skills",
    sourcePath: "poster/SKILL.md",
    sourceVersion: "a".repeat(40),
    sourceCommit: "a".repeat(40),
    sourceContentHash: "b".repeat(64),
    sourceUrl: `https://github.com/acme/skills/blob/${"a".repeat(40)}/poster/SKILL.md`,
};

const refined = {
    name: "电商商品视觉",
    description: "用于提炼商品卖点并规划电商主视觉。",
    plannerSummary: "在商品海报和详情页视觉任务中使用。",
    instructions: "1. 识别商品主体、受众与核心卖点。\n2. 根据投放位置规划构图、光线和信息层级。\n3. 保持商品外观准确。\n4. 输出可直接执行的画面描述。",
    keywords: ["电商", "商品海报", "详情页"],
    workspaces: ["image", "canvas"],
    action: "generate",
    requiresReference: true,
    defaultConfig: { size: "4:5", count: 2 },
};

describe("agent skill import refiner", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAuthSettings.mockResolvedValue({ defaultModels: { textModel: "planner" } });
        mocks.resolveLogicalModelCandidates.mockReturnValue([{ channelId: "channel-a", channel: { id: "channel-a" }, upstreamModel: "text-model", binding: { id: "binding-a" }, capabilityProfile: { supportsIdempotency: true } }]);
        mocks.requestStructuredText.mockResolvedValue({ arguments: JSON.stringify(refined), headers: new Headers(), protocol: "chat", elapsedMs: 10 });
        mocks.resolveSystemAiTextFailure.mockResolvedValue({ state: "safe_to_failover" });
    });

    it("uses the default text model and preserves pinned GitHub provenance", async () => {
        const result = await refineImportedAgentSkill({ skill, requestUrl: "http://localhost/api/admin/agent-skills/import", cookie: "session=1", userId: "admin" });

        expect(result).toMatchObject({ ...refined, sourceCommit: skill.sourceCommit, sourceContentHash: skill.sourceContentHash, enabled: false });
        expect(mocks.requestStructuredText).toHaveBeenCalledOnce();
        expect(mocks.requestStructuredText.mock.calls[0][0].messages[1].content).toContain("<untrusted_skill_document>");
        const headers = new Headers(mocks.requestStructuredText.mock.calls[0][0].headers);
        expect(headers.get("x-vozeb-pro-billing-user-id")).toBe("admin");
        expect(headers.get("x-vozeb-pro-billing-binding-id")).toBe("binding-a");
        expect(mocks.finishSystemAiTextAttempt).toHaveBeenCalledWith(expect.any(Headers), { status: "succeeded" });
    });

    it("sends enough source context for professional rules that appear after long introductions", async () => {
        const longSkill = { ...skill, instructions: `${"介绍内容。".repeat(2_000)}\n关键质量标准：保持商品结构准确。\n${"补充说明。".repeat(2_000)}` };

        await refineImportedAgentSkill({ skill: longSkill, requestUrl: "http://localhost/api/admin/agent-skills/import", cookie: "session=1", userId: "admin" });

        const content = mocks.requestStructuredText.mock.calls[0][0].messages[1].content as string;
        expect(content).toContain("关键质量标准：保持商品结构准确");
        expect(content.length).toBeLessThan(26_000);
    });

    it("rejects model output that still contains provider setup instructions and voids usage", async () => {
        mocks.requestStructuredText.mockResolvedValue({
            arguments: JSON.stringify({ ...refined, instructions: "运行 scripts/generate.py 并配置 API_KEY=https://provider.example，然后生成商品图。" }),
            headers: new Headers({ "x-vozeb-pro-points-cost": "0", "x-vozeb-pro-points-record-id": "record-1" }),
            protocol: "chat",
            elapsedMs: 10,
        });

        await expect(refineImportedAgentSkill({ skill, requestUrl: "http://localhost/api/admin/agent-skills/import", cookie: "session=1", userId: "admin" })).rejects.toBeInstanceOf(AgentSkillRefinementError);
        expect(mocks.finishSystemAiTextAttempt).toHaveBeenCalledWith(expect.any(Headers), { status: "failed" });
        expect(mocks.resolveSystemAiTextFailure).toHaveBeenCalledWith(expect.objectContaining({ userId: "admin", final: true }));
    });

    it("requires a configured default text model", async () => {
        mocks.getAuthSettings.mockResolvedValue({ defaultModels: { textModel: "" } });
        mocks.resolveLogicalModelCandidates.mockReturnValue([]);

        await expect(refineImportedAgentSkill({ skill, requestUrl: "http://localhost/api/admin/agent-skills/import", cookie: "", userId: "admin" })).rejects.toMatchObject({ status: 503 });
        expect(mocks.requestStructuredText).not.toHaveBeenCalled();
    });

    it("normalizes only Chinese, platform-native structured output", () => {
        expect(normalizeRefinedSkill(refined)).toMatchObject(refined);
        expect(normalizeRefinedSkill({ ...refined, description: "English only" })).toBeNull();
        expect(normalizeRefinedSkill({ ...refined, name: "Poster Skill" })).toBeNull();
        expect(normalizeRefinedSkill({ ...refined, keywords: ["电商", "poster"] })).toBeNull();
        expect(normalizeRefinedSkill({ ...refined, description: "用于商品海报创作，先运行 npm install 安装依赖。" })).toBeNull();
        expect(normalizeRefinedSkill({ ...refined, instructions: "识别商品主体并规划构图、光线、信息层级和最终交付要求。" })).toBeNull();
    });
});
