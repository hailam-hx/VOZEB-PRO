/** @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AdminGenerationChannel } from "@/lib/admin-generation-operations";
import { GenerationChannelStatus } from "./generation-channel-status";

function channel(status: AdminGenerationChannel["runtimeHealth"]["status"]): AdminGenerationChannel {
    return {
        id: "channel-one",
        name: "主渠道",
        capability: "text",
        logicalModelId: "writer",
        logicalModelName: "文本模型",
        upstreamModel: "vendor-model",
        enabled: true,
        runtimeHealth: {
            status,
            consecutiveFailures: status === "closed" ? 0 : 3,
            lastProviderErrorType: status === "closed" ? undefined : "upstream_error",
            lastProviderErrorCode: status === "closed" ? undefined : "overloaded",
            lastProviderStatus: status === "closed" ? undefined : 503,
        },
        plannerRuntimeHealth: { status: "closed", consecutiveFailures: 0 },
    };
}

describe("GenerationChannelStatus provider health", () => {
    it("labels a closed circuit as Healthy", () => {
        const view = render(<GenerationChannelStatus channels={[channel("closed")]} loading={false} />);

        expect(view.getAllByText("Healthy")).toHaveLength(2);
        expect(view.getByText("TextTask")).toBeTruthy();
        expect(view.getByText("Planner")).toBeTruthy();
    });

    it("shows the safe provider error type, code, and status", () => {
        const view = render(<GenerationChannelStatus channels={[channel("open")]} loading={false} />);

        expect(view.getByText(/type upstream_error/)).toBeTruthy();
        expect(view.getByText(/code overloaded/)).toBeTruthy();
        expect(view.getByText(/HTTP 503/)).toBeTruthy();
    });
});
