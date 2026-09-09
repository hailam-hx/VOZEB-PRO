import type { AppLocale } from "@/i18n/config";
export const landingUi = {
    vi: {
        breadcrumb: "Đường dẫn trang",
        home: "Trang chủ",
        topics: "Chủ đề liên quan",
        workspace: "WORKSPACE THỰC TẾ",
        uses: "ỨNG DỤNG",
        steps: "CÁCH SỬ DỤNG",
        capabilities: "NĂNG LỰC THỰC TẾ",
        faq: "CÂU HỎI THƯỜNG GẶP",
        faqTitle: "Câu hỏi thường gặp về",
        related: "CÔNG CỤ LIÊN QUAN",
        relatedTitle: "Tiếp tục quy trình sáng tạo của bạn",
        explore: "Khám phá công cụ",
        start: "BẮT ĐẦU VỚI HOTX AI",
        brief: "Bắt đầu từ một brief",
        mode: "HOTX AI sẽ mở đúng chế độ sáng tạo",
        suggestions: "Gợi ý nhanh",
        edit: "Bạn có thể chỉnh sửa brief và thêm tài liệu tham chiếu sau khi vào workspace.",
        voiceTitle: "Quản lý hồ sơ giọng trong workspace riêng",
        voiceDescription: "Tải mẫu, xác nhận quyền sử dụng và theo dõi trạng thái sau khi đăng nhập.",
        dramaTitle: "Bắt đầu trong workspace sản xuất phim ngắn",
        dramaDescription: "Tạo dự án, tổ chức tài sản và phát triển từng tập trong cùng một quy trình.",
        consent: "Không sử dụng mẫu giọng nếu chưa có sự đồng ý phù hợp.",
    },
    en: {
        breadcrumb: "Breadcrumb",
        home: "Home",
        topics: "Related topics",
        workspace: "ACTUAL WORKSPACE",
        uses: "USE CASES",
        steps: "HOW TO USE",
        capabilities: "AVAILABLE CAPABILITIES",
        faq: "FREQUENTLY ASKED QUESTIONS",
        faqTitle: "Frequently asked questions about",
        related: "RELATED TOOLS",
        relatedTitle: "Continue your creative workflow",
        explore: "Explore the tool",
        start: "GET STARTED WITH HOTX AI",
        brief: "Start with a brief",
        mode: "HOTX AI opens the appropriate creation mode",
        suggestions: "Quick suggestions",
        edit: "You can edit the brief and add references after entering the workspace.",
        voiceTitle: "Manage voice profiles in your private workspace",
        voiceDescription: "Upload a sample, confirm permission and track status after signing in.",
        dramaTitle: "Start in the short film production workspace",
        dramaDescription: "Create projects, organize assets and develop each episode in one workflow.",
        consent: "Do not use voice samples without appropriate consent.",
    },
    "zh-CN": {
        breadcrumb: "页面路径",
        home: "首页",
        topics: "相关主题",
        workspace: "实际工作区",
        uses: "应用场景",
        steps: "使用步骤",
        capabilities: "实际能力",
        faq: "常见问题",
        faqTitle: "常见问题：",
        related: "相关工具",
        relatedTitle: "继续你的创作流程",
        explore: "了解工具",
        start: "开始使用 HOTX AI",
        brief: "从一份需求开始",
        mode: "HOTX AI 会打开适合的创作模式",
        suggestions: "快捷建议",
        edit: "进入工作区后可以编辑需求并添加参考资料。",
        voiceTitle: "在个人工作区中管理声音档案",
        voiceDescription: "登录后上传样本、确认使用权限并跟进状态。",
        dramaTitle: "进入短片制作工作区",
        dramaDescription: "在统一流程中创建项目、组织资产并发展每一集。",
        consent: "未获得适当同意时请勿使用声音样本。",
    },
} satisfies Record<
    AppLocale,
    Record<
        | "breadcrumb"
        | "home"
        | "topics"
        | "workspace"
        | "uses"
        | "steps"
        | "capabilities"
        | "faq"
        | "faqTitle"
        | "related"
        | "relatedTitle"
        | "explore"
        | "start"
        | "brief"
        | "mode"
        | "suggestions"
        | "edit"
        | "voiceTitle"
        | "voiceDescription"
        | "dramaTitle"
        | "dramaDescription"
        | "consent",
        string
    >
>;
