import { describe, expect, it } from "vitest";

import { creativeGenerationWaitingMessageKey, formatCreativeWaitingTime } from "./creative-generation-waiting";

describe("creative generation waiting", () => {
    it("uses the real task phase before elapsed-time comfort copy", () => {
        expect(creativeGenerationWaitingMessageKey({ mode: "image", runStatus: "planning", progressText: "正在理解需求并选择合适的创作能力", elapsedSeconds: 180 })).toBe("waitingImagePlanning");
        expect(creativeGenerationWaitingMessageKey({ mode: "text", runStatus: "planning", progressText: "正在理解需求并选择合适的创作能力", elapsedSeconds: 180 })).toBe("waitingTextPlanning");
        expect(creativeGenerationWaitingMessageKey({ mode: "video", runStatus: "planning", progressText: "正在理解需求并选择合适的创作能力", elapsedSeconds: 180 })).toBe("waitingVideoPlanning");
        expect(creativeGenerationWaitingMessageKey({ mode: "video", runStatus: "running", progressText: "连接暂时中断，正在确认后台任务状态", elapsedSeconds: 180 })).toBe("waitingConnectionUnstable");
        expect(creativeGenerationWaitingMessageKey({ mode: "image", runStatus: "running", progressText: "检查完成，正在整理结果", elapsedSeconds: 180 })).toBe("waitingFinishing");
    });

    it("adapts the comfort copy by media type and natural elapsed minutes", () => {
        expect(creativeGenerationWaitingMessageKey({ mode: "image", runStatus: "running", progressText: "正在处理创作任务", elapsedSeconds: 20 })).toBe("waitingImageInitial");
        expect(creativeGenerationWaitingMessageKey({ mode: "video", runStatus: "running", progressText: "正在处理创作任务", elapsedSeconds: 20 })).toBe("waitingVideoInitial");
        expect(creativeGenerationWaitingMessageKey({ mode: "video", runStatus: "running", progressText: "仍在上游处理中", elapsedSeconds: 60 })).toBe("waitingVideoLong");
        expect(creativeGenerationWaitingMessageKey({ mode: "video", runStatus: "running", progressText: "仍在上游处理中", elapsedSeconds: 120 })).toBe("waitingVideoVeryLong");
        expect(creativeGenerationWaitingMessageKey({ mode: "video", runStatus: "running", progressText: "仍在上游处理中", elapsedSeconds: 180 })).toBe("waitingVideoVeryLong");
    });

    it("formats the actual elapsed time without an artificial upper limit", () => {
        expect(formatCreativeWaitingTime(42)).toBe("42秒");
        expect(formatCreativeWaitingTime(72)).toBe("1分钟12秒");
        expect(formatCreativeWaitingTime(3_661)).toBe("1小时1分钟1秒");
        expect(formatCreativeWaitingTime(72, "en")).toBe("1 min 12 sec");
        expect(formatCreativeWaitingTime(72, "vi")).toBe("1 phút 12 giây");
    });
});
