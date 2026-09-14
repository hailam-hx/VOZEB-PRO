import { describe, expect, it } from "vitest";

import { agentRequirementAcknowledgement } from "./agent-requirement-acknowledgement";

describe("agentRequirementAcknowledgement", () => {
    it("localizes temporary acknowledgement copy", () => {
        expect(agentRequirementAcknowledgement("hello", "chat", false, "en")).toBe("Got it. I’m working on your request.");
        expect(agentRequirementAcknowledgement("xin chào", "chat", false, "vi")).toBe("Đã nhận. Tôi đang xử lý yêu cầu của bạn.");
    });
});
