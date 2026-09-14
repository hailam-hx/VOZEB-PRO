import type { CreativeSurface } from "@/lib/creative-runtime-contract";
import { extractImageSizeFromPrompt } from "@/lib/image-size";
import { isAppLocale, type AppLocale } from "@/i18n/config";

export function agentRequirementAcknowledgement(prompt: string, surface: CreativeSurface, hasReferences = false, responseLocale?: AppLocale) {
    const normalized = prompt.trim();
    const size = extractImageSizeFromPrompt(normalized);
    const kind = /(?:视频|短片|动画|运镜|图生视频)/u.test(normalized) ? "视频" : /(?:图片|图像|海报|封面|主视觉|生图|照片)/u.test(normalized) ? "图片" : /(?:音频|配音|声音|旁白|语音)/u.test(normalized) ? "音频" : "创作需求";
    const locale = isAppLocale(responseLocale) ? responseLocale : "zh-CN";
    if (locale === "vi") {
        if (surface === "canvas") return hasReferences ? "Đã nhận. Tôi sẽ xử lý yêu cầu dựa trên nội dung đang chọn trên Canvas." : "Đã nhận. Tôi sẽ xử lý yêu cầu dựa trên Canvas hiện tại.";
        if (surface === "drama") return hasReferences ? "Đã nhận. Tôi sẽ tiếp tục sáng tạo dựa trên dự án phim ngắn và tài liệu tham chiếu hiện tại." : "Đã nhận. Tôi sẽ tiếp tục sáng tạo trong dự án phim ngắn hiện tại.";
        if (hasReferences) return "Đã nhận. Tôi sẽ xử lý yêu cầu dựa trên tài liệu tham chiếu hiện tại.";
        if (size && kind === "图片") return `Đã nhận. Tôi sẽ tạo hình ảnh theo kích thước ${size}.`;
        return "Đã nhận. Tôi đang xử lý yêu cầu của bạn.";
    }
    if (locale === "en") {
        if (surface === "canvas") return hasReferences ? "Got it. I’ll work from the selected Canvas content." : "Got it. I’ll work from the current Canvas.";
        if (surface === "drama") return hasReferences ? "Got it. I’ll continue from the current short-drama project and references." : "Got it. I’ll continue in the current short-drama project.";
        if (hasReferences) return "Got it. I’ll work from the current references.";
        if (size && kind === "图片") return `Got it. I’ll create the image at ${size}.`;
        return "Got it. I’m working on your request.";
    }
    if (surface === "canvas") return hasReferences ? `收到，我会基于当前选中素材处理这次${kind}。` : `收到，我会结合当前画布处理这次${kind}。`;
    if (surface === "drama") return hasReferences ? "收到，我会结合当前短剧项目与参考素材继续创作。" : "收到，我会结合当前短剧项目继续创作。";
    if (hasReferences) return `收到，我会根据当前参考素材完成这次${kind}。`;
    if (size && kind === "图片") return `收到，我会按 ${size} 尺寸完成这次图片创作。`;
    return `收到，我会按你的要求处理这次${kind}。`;
}
