import type { AppLocale } from "@/i18n/config";

import { helpArticles, type HelpArticle, type HelpArticleId } from "./help-content";

type ArticleSeed = {
    label: string;
    title: string;
    summary: string;
    routeLabel?: string;
    keywords: string[];
    outcomes: [string, string, string];
    prepare: string;
    execute: string;
    verify: string;
    troubleshoot: string;
};

type HelpText = {
    shared: {
        flowPrepare: string;
        flowConfigure: string;
        flowExecute: string;
        flowReview: string;
        stepPrepare: string;
        stepPrepareDescription: string;
        stepExecute: string;
        stepExecuteDescription: string;
        stepReview: string;
        stepReviewDescription: string;
        checklistRequirement: string;
        checklistReferences: string;
        checklistStatus: string;
        checklistResult: string;
        checklistRetry: string;
        tip: string;
        faqStart: string;
        faqStartAnswer: string;
        faqFailure: string;
        faqFailureAnswer: string;
    };
    articles: Record<HelpArticleId, ArticleSeed>;
};

const routes: Partial<Record<HelpArticleId, string>> = {
    start: "/create",
    agent: "/create",
    image: "/create",
    video: "/create",
    canvas: "/canvas",
    drama: "/drama",
    assets: "/assets",
    prompts: "/prompts",
    account: "/profile",
    rights: "/profile",
};

const localizedHelpText: Record<Exclude<AppLocale, "zh-CN">, HelpText> = {
    en: {
        shared: {
            flowPrepare: "Prepare",
            flowConfigure: "Configure",
            flowExecute: "Create",
            flowReview: "Review",
            stepPrepare: "Prepare the request",
            stepPrepareDescription: "Clarify the goal and gather everything needed before starting.",
            stepExecute: "Run the workflow",
            stepExecuteDescription: "Use the page controls and follow the visible task status.",
            stepReview: "Review and continue",
            stepReviewDescription: "Check the delivered content, then download, reuse, or safely retry it.",
            checklistRequirement: "State the intended use, format, and constraints",
            checklistReferences: "Add required references before submitting",
            checklistStatus: "Wait for a clear success or failure status",
            checklistResult: "Preview the complete result before downloading or publishing",
            checklistRetry: "Retry only the failed item or original failed round",
            tip: "Keep smart planning enabled when you are unsure which model or parameter to use.",
            faqStart: "Where should I begin?",
            faqStartAnswer: "Open the linked workspace, describe the final outcome, and follow the preparation checklist before submitting.",
            faqFailure: "What should I do if something fails?",
            faqFailureAnswer: "Read the visible task status, keep successful results, and retry only the failed item. Avoid submitting the same running task again.",
        },
        articles: {
            start: {
                label: "Quick start",
                title: "Create from a single idea",
                summary: "Start with Creative Agent, describe the outcome, add references, and let smart planning choose the right image, video, Canvas, or short-drama capability.",
                routeLabel: "Open Creative Agent",
                keywords: ["start", "beginner", "workflow", "download"],
                outcomes: ["Choose the right starting point", "Understand smart and manual execution", "Preview, download, and reuse results"],
                prepare: "Describe what to make, for whom, and where it will be used.",
                execute: "Add references and keep smart planning on unless you need a specific model.",
                verify: "Open the result, inspect details, then download or reference it in the next round.",
                troubleshoot: "If a task fails, retry from its original failed round instead of submitting a duplicate.",
            },
            agent: {
                label: "Creative Agent",
                title: "Go from requirement to delivery with Agent",
                summary: "Use one conversation for natural requests, multiple deliverables, references, Skills, models, and persistent server-side history.",
                routeLabel: "Open Agent workspace",
                keywords: ["agent", "skill", "model", "history", "attachment"],
                outcomes: ["Choose Skills and smart planning", "Manage conversations and history", "Iterate from generated results"],
                prepare: "Describe the goal, audience, deliverables, consistency rules, and completion criteria.",
                execute: "Select a Skill only when needed; add references and use manual models only for deliberate comparisons.",
                verify: "Review the public model and parameter summary beside each delivered result.",
                troubleshoot: "Resume the original conversation and retry failed media in place so context and stable IDs are preserved.",
            },
            image: {
                label: "Image creation",
                title: "Generate, refine, and reuse images",
                summary: "Create or edit images with references, exact dimensions, quality, quantity, and reusable results.",
                routeLabel: "Open Creative Agent",
                keywords: ["image", "ratio", "quality", "reference", "download"],
                outcomes: ["Write an effective image request", "Control size and consistency", "Inspect and reuse delivered images"],
                prepare: "Describe the subject, composition, style, lighting, text, and anything that must remain unchanged.",
                execute: "Upload clear character, product, logo, or style references and set exact dimensions when required.",
                verify: "Inspect faces, text, edges, proportions, and every result in a multi-image batch.",
                troubleshoot: "Retry only failed slots; keep successful images and reference the best one for the next revision.",
            },
            video: {
                label: "Video creation",
                title: "Create video from text or images",
                summary: "Define action, camera movement, duration, aspect ratio, audio, and first/last-frame references in one workflow.",
                routeLabel: "Open Creative Agent",
                keywords: ["video", "first frame", "duration", "audio", "camera"],
                outcomes: ["Prepare valid video references", "Control motion and duration", "Safely retry failed video tasks"],
                prepare: "Separate subject action, camera movement, pacing, lighting, and prohibited changes.",
                execute: "Choose reference, first-frame, or first-and-last-frame mode and provide every required image before sending.",
                verify: "Play the full video, check continuity and sound, then download or reference the result.",
                troubleshoot: "Video tasks take longer than images; wait for the final state and retry only the original failed round.",
            },
            canvas: {
                label: "My Canvas",
                title: "Connect a complete workflow with nodes",
                summary: "Organize text, image, video, audio, and panorama nodes in a persistent project and collaborate with Canvas Agent.",
                routeLabel: "Open My Canvas",
                keywords: ["canvas", "node", "connection", "panorama", "agent"],
                outcomes: ["Create and connect nodes", "Use Canvas Agent safely", "Restore and continue projects"],
                prepare: "Create a project and add the text or media nodes needed for the workflow.",
                execute: "Connect references to generation nodes or ask Canvas Agent to perform explicit project operations.",
                verify: "Open generated media, inspect connections, and confirm the project has saved before leaving.",
                troubleshoot: "Reopen the project to reconnect running tasks; do not recreate a task that is still active.",
            },
            drama: {
                label: "Short-drama projects",
                title: "Move from story outline to deliverable episodes",
                summary: "Manage project assets, episodes, scripts, review, storyboards, shots, audio, and final generation in one production workspace.",
                routeLabel: "Open short-drama projects",
                keywords: ["drama", "episode", "script", "storyboard", "shot"],
                outcomes: ["Understand project and episode scope", "Complete production stages in order", "Identify and retry blocked shots"],
                prepare: "Create project-level characters, scenes, props, and source assets before episode production.",
                execute: "Progress through script, content review, storyboard, and shot generation using real stage data.",
                verify: "Check each shot's prompt, references, video, voice, and composition status before delivery.",
                troubleshoot: "Use the shown blocking reason and retry the exact failed shot instead of restarting the entire project.",
            },
            assets: {
                label: "My assets",
                title: "Organize and reuse creative media",
                summary: "Find account-owned images, videos, and audio, preview them at their real ratio, and reference them in new work.",
                routeLabel: "Open My assets",
                keywords: ["asset", "image", "video", "audio", "delete"],
                outcomes: ["Find assets quickly", "Reuse assets with stable IDs", "Delete only unreferenced media"],
                prepare: "Use search, type, source, and time filters to locate the correct account asset.",
                execute: "Preview the media and reference it through the workspace picker rather than copying temporary URLs.",
                verify: "Confirm the selected asset and source before using, downloading, or deleting it.",
                troubleshoot: "If deletion is blocked, remove valid project references first; the service protects files still in use.",
            },
            prompts: {
                label: "Prompts",
                title: "Find, save, and reuse prompts",
                summary: "Manage personal prompts and browse the public library without changing their saved technical category values.",
                routeLabel: "Open prompt library",
                keywords: ["prompt", "library", "category", "copy", "insert"],
                outcomes: ["Find suitable prompts", "Save personal prompt records", "Insert prompts into a creation request"],
                prepare: "Search by the desired subject, style, medium, or production goal.",
                execute: "Copy or insert a prompt, then edit it to match the current subject and references.",
                verify: "Confirm that the public draft contains only the text you intend to send.",
                troubleshoot: "If the library does not load, retry the request; do not create duplicate personal entries.",
            },
            account: {
                label: "Account and purchases",
                title: "Manage top-ups, credits, and orders",
                summary: "Review profile details, top-up orders, settled and held credit balances, usage, and secure account settings.",
                routeLabel: "Open Profile",
                keywords: ["account", "top-up", "credits", "order", "payment"],
                outcomes: ["Understand balances and usage", "Top up credits through checkout", "Track order and payment status"],
                prepare: "Review the preset or custom VND amount, server quote, promotion, coupon, and amount due before paying.",
                execute: "Complete payment through the selected channel and return to the original order for status updates.",
                verify: "Check order status, credited balance, ledger history, and usage records after confirmation.",
                troubleshoot: "Do not create duplicate orders for a pending payment; keep the order number when contacting support.",
            },
            rights: {
                label: "Privacy and user rights",
                title: "Manage personal data, content, and your account",
                summary: "Read the Terms and Privacy Policy, export account data, request deletion, and report public content.",
                routeLabel: "Open Profile",
                keywords: ["privacy", "terms", "export", "delete", "report"],
                outcomes: ["Find the applicable policies", "Export data or request account deletion", "Submit verifiable reports and appeals"],
                prepare: "Review the Terms and Privacy Policy and avoid unnecessary sensitive data in public prompts.",
                execute: "Use Profile to export data or submit and withdraw an account-deletion request.",
                verify: "Track request, order, publication, report, or appeal status from the relevant page.",
                troubleshoot: "Media still referenced by projects remains protected until those references are removed.",
            },
            troubleshooting: {
                label: "Troubleshooting",
                title: "Resolve loading, generation, and display issues",
                summary: "Distinguish page loading, planning, submission, generation, media, and payment problems before retrying.",
                keywords: ["problem", "loading", "failure", "model", "preview"],
                outcomes: ["Identify the failing stage", "Know when a retry is safe", "Avoid duplicate generation or payment"],
                prepare: "Confirm network, sign-in status, the current account, and the page's visible error message.",
                execute: "Use the page's own refresh or retry action and keep active tasks open or reconnect them.",
                verify: "Confirm the task is successful and the media is ready before previewing or downloading.",
                troubleshoot: "Retry failed items in place; create a new round only when the requirement has actually changed.",
            },
        },
    },
    vi: {
        shared: {
            flowPrepare: "Chuẩn bị",
            flowConfigure: "Thiết lập",
            flowExecute: "Thực hiện",
            flowReview: "Kiểm tra",
            stepPrepare: "Chuẩn bị yêu cầu",
            stepPrepareDescription: "Làm rõ mục tiêu và tập hợp đủ nội dung cần thiết trước khi bắt đầu.",
            stepExecute: "Thực hiện quy trình",
            stepExecuteDescription: "Dùng các control trên trang và theo dõi trạng thái tác vụ được hiển thị.",
            stepReview: "Kiểm tra và tiếp tục",
            stepReviewDescription: "Kiểm tra nội dung đã giao rồi tải xuống, tái sử dụng hoặc thử lại an toàn.",
            checklistRequirement: "Nêu rõ mục đích, định dạng và các ràng buộc",
            checklistReferences: "Thêm đủ tài liệu tham chiếu trước khi gửi",
            checklistStatus: "Chờ trạng thái thành công hoặc thất bại rõ ràng",
            checklistResult: "Xem toàn bộ kết quả trước khi tải xuống hoặc xuất bản",
            checklistRetry: "Chỉ thử lại mục hoặc lượt ban đầu đã thất bại",
            tip: "Giữ lập kế hoạch thông minh khi chưa chắc nên dùng mô hình hoặc tham số nào.",
            faqStart: "Tôi nên bắt đầu từ đâu?",
            faqStartAnswer: "Mở khu vực làm việc được liên kết, mô tả kết quả cuối cùng và hoàn tất danh sách chuẩn bị trước khi gửi.",
            faqFailure: "Tôi nên làm gì khi có lỗi?",
            faqFailureAnswer: "Đọc trạng thái tác vụ, giữ lại kết quả thành công và chỉ thử lại mục thất bại. Không gửi lại một tác vụ vẫn đang chạy.",
        },
        articles: {
            start: {
                label: "Bắt đầu nhanh",
                title: "Sáng tạo từ một ý tưởng",
                summary: "Bắt đầu với Agent sáng tạo, mô tả kết quả, thêm tham chiếu và để lập kế hoạch thông minh chọn năng lực hình ảnh, video, Canvas hoặc phim ngắn phù hợp.",
                routeLabel: "Mở Agent sáng tạo",
                keywords: ["bắt đầu", "người mới", "quy trình", "tải xuống"],
                outcomes: ["Chọn đúng điểm bắt đầu", "Hiểu thực thi thông minh và thủ công", "Xem, tải và tái sử dụng kết quả"],
                prepare: "Mô tả cần làm gì, dành cho ai và sẽ dùng ở đâu.",
                execute: "Thêm tham chiếu và giữ lập kế hoạch thông minh, trừ khi cần một mô hình cụ thể.",
                verify: "Mở kết quả, kiểm tra chi tiết rồi tải xuống hoặc tham chiếu ở lượt tiếp theo.",
                troubleshoot: "Nếu tác vụ lỗi, thử lại từ chính lượt thất bại thay vì gửi một bản trùng.",
            },
            agent: {
                label: "Agent sáng tạo",
                title: "Đi từ yêu cầu đến bàn giao với Agent",
                summary: "Dùng một cuộc trò chuyện cho yêu cầu tự nhiên, nhiều đầu ra, tham chiếu, Skill, mô hình và lịch sử lưu trên máy chủ.",
                routeLabel: "Mở khu vực Agent",
                keywords: ["agent", "skill", "mô hình", "lịch sử", "đính kèm"],
                outcomes: ["Chọn Skill và lập kế hoạch", "Quản lý cuộc trò chuyện", "Tiếp tục từ kết quả đã tạo"],
                prepare: "Mô tả mục tiêu, người xem, đầu ra, quy tắc nhất quán và tiêu chí hoàn thành.",
                execute: "Chỉ chọn Skill khi cần; thêm tham chiếu và chỉ dùng mô hình thủ công khi muốn so sánh có chủ đích.",
                verify: "Kiểm tra tóm tắt mô hình và tham số công khai cạnh từng kết quả.",
                troubleshoot: "Mở lại cuộc trò chuyện gốc và thử lại media ngay tại lượt lỗi để giữ ngữ cảnh và ID ổn định.",
            },
            image: {
                label: "Tạo hình ảnh",
                title: "Tạo, tinh chỉnh và tái sử dụng hình ảnh",
                summary: "Tạo hoặc chỉnh sửa ảnh bằng tham chiếu, kích thước chính xác, chất lượng, số lượng và kết quả có thể tái sử dụng.",
                routeLabel: "Mở Agent sáng tạo",
                keywords: ["hình ảnh", "tỷ lệ", "chất lượng", "tham chiếu", "tải xuống"],
                outcomes: ["Viết yêu cầu hình ảnh hiệu quả", "Kiểm soát kích thước và nhất quán", "Kiểm tra và tái sử dụng ảnh"],
                prepare: "Mô tả chủ thể, bố cục, phong cách, ánh sáng, chữ và những gì phải giữ nguyên.",
                execute: "Tải ảnh nhân vật, sản phẩm, logo hoặc phong cách rõ ràng và đặt kích thước chính xác khi cần.",
                verify: "Kiểm tra khuôn mặt, chữ, cạnh, tỷ lệ và mọi kết quả trong lô nhiều ảnh.",
                troubleshoot: "Chỉ thử lại ô bị lỗi; giữ ảnh thành công và tham chiếu ảnh tốt nhất cho lần sửa tiếp theo.",
            },
            video: {
                label: "Tạo video",
                title: "Tạo video từ văn bản hoặc hình ảnh",
                summary: "Xác định chuyển động, máy quay, thời lượng, tỷ lệ, âm thanh và tham chiếu khung đầu/cuối trong một quy trình.",
                routeLabel: "Mở Agent sáng tạo",
                keywords: ["video", "khung đầu", "thời lượng", "âm thanh", "máy quay"],
                outcomes: ["Chuẩn bị tham chiếu video hợp lệ", "Kiểm soát chuyển động và thời lượng", "Thử lại tác vụ video an toàn"],
                prepare: "Tách chuyển động chủ thể, chuyển động máy quay, nhịp, ánh sáng và thay đổi bị cấm.",
                execute: "Chọn chế độ tham chiếu, khung đầu hoặc khung đầu-cuối và cung cấp đủ ảnh bắt buộc trước khi gửi.",
                verify: "Phát toàn bộ video, kiểm tra tính liên tục và âm thanh rồi tải hoặc tham chiếu kết quả.",
                troubleshoot: "Video thường lâu hơn ảnh; hãy chờ trạng thái cuối và chỉ thử lại lượt ban đầu đã thất bại.",
            },
            canvas: {
                label: "Canvas của tôi",
                title: "Kết nối quy trình hoàn chỉnh bằng node",
                summary: "Tổ chức node văn bản, hình ảnh, video, âm thanh và panorama trong dự án lưu lâu dài, đồng thời cộng tác với Canvas Agent.",
                routeLabel: "Mở Canvas của tôi",
                keywords: ["canvas", "node", "kết nối", "panorama", "agent"],
                outcomes: ["Tạo và nối node", "Dùng Canvas Agent an toàn", "Khôi phục và tiếp tục dự án"],
                prepare: "Tạo dự án và thêm các node văn bản hoặc media cần cho quy trình.",
                execute: "Nối tham chiếu vào node tạo hoặc yêu cầu Canvas Agent thực hiện thao tác dự án rõ ràng.",
                verify: "Mở media đã tạo, kiểm tra kết nối và xác nhận dự án đã lưu trước khi rời trang.",
                troubleshoot: "Mở lại dự án để kết nối lại tác vụ đang chạy; không tạo lại tác vụ vẫn còn hoạt động.",
            },
            drama: {
                label: "Dự án phim ngắn",
                title: "Đi từ cốt truyện đến tập phim có thể bàn giao",
                summary: "Quản lý tài sản dự án, tập, kịch bản, duyệt, storyboard, cảnh quay, âm thanh và tạo cuối trong một không gian sản xuất.",
                routeLabel: "Mở dự án phim ngắn",
                keywords: ["phim ngắn", "tập", "kịch bản", "storyboard", "cảnh quay"],
                outcomes: ["Hiểu phạm vi dự án và tập", "Hoàn thành các giai đoạn theo thứ tự", "Xác định và thử lại cảnh bị chặn"],
                prepare: "Tạo nhân vật, bối cảnh, đạo cụ và tài liệu nguồn cấp dự án trước khi sản xuất tập.",
                execute: "Đi qua kịch bản, duyệt nội dung, storyboard và tạo cảnh bằng dữ liệu giai đoạn thật.",
                verify: "Kiểm tra prompt, tham chiếu, video, giọng đọc và trạng thái ghép của từng cảnh.",
                troubleshoot: "Dựa vào lý do chặn được hiển thị và thử lại đúng cảnh thất bại thay vì khởi động lại cả dự án.",
            },
            assets: {
                label: "Tài sản của tôi",
                title: "Sắp xếp và tái sử dụng media sáng tạo",
                summary: "Tìm hình ảnh, video và âm thanh thuộc tài khoản, xem đúng tỷ lệ thật và tham chiếu vào công việc mới.",
                routeLabel: "Mở Tài sản của tôi",
                keywords: ["tài sản", "hình ảnh", "video", "âm thanh", "xóa"],
                outcomes: ["Tìm tài sản nhanh", "Tái sử dụng bằng ID ổn định", "Chỉ xóa media không còn tham chiếu"],
                prepare: "Dùng bộ lọc tìm kiếm, loại, nguồn và thời gian để tìm đúng tài sản.",
                execute: "Xem media và tham chiếu qua bộ chọn trong khu vực làm việc thay vì sao chép URL tạm.",
                verify: "Xác nhận tài sản và nguồn trước khi dùng, tải hoặc xóa.",
                troubleshoot: "Nếu bị chặn xóa, hãy gỡ các tham chiếu dự án hợp lệ trước; dịch vụ bảo vệ tệp còn được dùng.",
            },
            prompts: {
                label: "Prompt",
                title: "Tìm, lưu và tái sử dụng prompt",
                summary: "Quản lý prompt cá nhân và duyệt thư viện công khai mà không thay đổi giá trị danh mục kỹ thuật đã lưu.",
                routeLabel: "Mở thư viện prompt",
                keywords: ["prompt", "thư viện", "danh mục", "sao chép", "chèn"],
                outcomes: ["Tìm prompt phù hợp", "Lưu prompt cá nhân", "Chèn prompt vào yêu cầu"],
                prepare: "Tìm theo chủ thể, phong cách, loại media hoặc mục tiêu sản xuất.",
                execute: "Sao chép hoặc chèn prompt rồi sửa cho phù hợp với chủ thể và tham chiếu hiện tại.",
                verify: "Xác nhận bản nháp công khai chỉ chứa nội dung bạn muốn gửi.",
                troubleshoot: "Nếu thư viện không tải, hãy thử lại yêu cầu; không tạo các bản ghi cá nhân trùng nhau.",
            },
            account: {
                label: "Tài khoản và mua hàng",
                title: "Quản lý gói, điểm và đơn hàng",
                summary: "Xem hồ sơ, gói, phiếu giảm giá, đơn hàng, số dư điểm, mức sử dụng và thiết lập bảo mật.",
                routeLabel: "Mở Hồ sơ",
                keywords: ["tài khoản", "gói", "điểm", "đơn hàng", "phiếu giảm giá"],
                outcomes: ["Hiểu số dư và mức sử dụng", "Mua gói qua thanh toán", "Theo dõi trạng thái đơn"],
                prepare: "Kiểm tra sản phẩm, quyền lợi, thời hạn, số lượng, phiếu giảm giá và số tiền phải trả.",
                execute: "Thanh toán qua kênh đã chọn và quay lại đơn gốc để cập nhật trạng thái.",
                verify: "Kiểm tra trạng thái đơn, quyền lợi, lịch sử số dư và mức sử dụng sau xác nhận.",
                troubleshoot: "Không tạo đơn trùng khi thanh toán đang chờ; giữ mã đơn khi liên hệ hỗ trợ.",
            },
            rights: {
                label: "Quyền riêng tư và quyền người dùng",
                title: "Quản lý dữ liệu cá nhân, nội dung và tài khoản",
                summary: "Đọc Điều khoản và Chính sách quyền riêng tư, xuất dữ liệu, yêu cầu xóa tài khoản và báo cáo nội dung công khai.",
                routeLabel: "Mở Hồ sơ",
                keywords: ["quyền riêng tư", "điều khoản", "xuất", "xóa", "báo cáo"],
                outcomes: ["Tìm chính sách áp dụng", "Xuất dữ liệu hoặc yêu cầu xóa", "Gửi báo cáo và khiếu nại có thể xác minh"],
                prepare: "Đọc Điều khoản, Chính sách quyền riêng tư và tránh dữ liệu nhạy cảm không cần thiết trong prompt công khai.",
                execute: "Dùng Hồ sơ để xuất dữ liệu hoặc gửi và rút yêu cầu xóa tài khoản.",
                verify: "Theo dõi trạng thái yêu cầu, đơn, bản xuất bản, báo cáo hoặc khiếu nại tại trang tương ứng.",
                troubleshoot: "Media còn được dự án tham chiếu sẽ được bảo vệ đến khi các tham chiếu bị gỡ.",
            },
            troubleshooting: {
                label: "Khắc phục sự cố",
                title: "Xử lý lỗi tải, tạo và hiển thị",
                summary: "Phân biệt lỗi tải trang, lập kế hoạch, gửi, tạo, media và thanh toán trước khi thử lại.",
                keywords: ["sự cố", "tải", "thất bại", "mô hình", "xem trước"],
                outcomes: ["Xác định giai đoạn lỗi", "Biết khi nào thử lại an toàn", "Tránh tạo hoặc thanh toán trùng"],
                prepare: "Xác nhận mạng, trạng thái đăng nhập, tài khoản hiện tại và thông báo lỗi trên trang.",
                execute: "Dùng thao tác làm mới hoặc thử lại của trang và giữ tác vụ hoạt động mở hoặc kết nối lại.",
                verify: "Xác nhận tác vụ thành công và media sẵn sàng trước khi xem hoặc tải.",
                troubleshoot: "Thử lại mục lỗi ngay tại chỗ; chỉ tạo lượt mới khi yêu cầu thực sự thay đổi.",
            },
        },
    },
};

export function getHelpArticles(locale: AppLocale): HelpArticle[] {
    if (locale === "zh-CN") return helpArticles;
    const { shared, articles } = localizedHelpText[locale];
    return (Object.keys(articles) as HelpArticleId[]).map((id) => {
        const article = articles[id];
        const route = routes[id];
        return {
            id,
            label: article.label,
            title: article.title,
            summary: article.summary,
            route: route && article.routeLabel ? { href: route, label: article.routeLabel } : undefined,
            keywords: article.keywords,
            outcomes: article.outcomes,
            flow: [
                { title: shared.flowPrepare, detail: article.prepare },
                { title: shared.flowConfigure, detail: article.execute },
                { title: shared.flowExecute, detail: article.verify },
                { title: shared.flowReview, detail: article.troubleshoot },
            ],
            steps: [
                { title: shared.stepPrepare, description: `${shared.stepPrepareDescription} ${article.prepare}`, checklist: [shared.checklistRequirement, shared.checklistReferences], tip: shared.tip },
                { title: shared.stepExecute, description: `${shared.stepExecuteDescription} ${article.execute}`, checklist: [shared.checklistStatus, article.verify] },
                { title: shared.stepReview, description: `${shared.stepReviewDescription} ${article.troubleshoot}`, checklist: [shared.checklistResult, shared.checklistRetry] },
            ],
            faqs: [
                { question: shared.faqStart, answer: shared.faqStartAnswer },
                { question: shared.faqFailure, answer: `${shared.faqFailureAnswer} ${article.troubleshoot}` },
            ],
        };
    });
}

export function findLocalizedHelpArticle(articles: HelpArticle[], id: string | null | undefined) {
    return articles.find((article) => article.id === id);
}

export function searchLocalizedHelpArticles(articles: HelpArticle[], query: string, locale: AppLocale) {
    const normalized = query.trim().toLocaleLowerCase(locale);
    if (!normalized) return articles;
    return articles.filter((article) => articleSearchText(article).includes(normalized));
}

function articleSearchText(article: HelpArticle) {
    return [
        article.label,
        article.title,
        article.summary,
        ...article.keywords,
        ...article.outcomes,
        ...article.flow.flatMap((step) => [step.title, step.detail]),
        ...article.steps.flatMap((step) => [step.title, step.description, ...step.checklist, step.tip || ""]),
        ...article.faqs.flatMap((faq) => [faq.question, faq.answer]),
    ]
        .join(" ")
        .toLocaleLowerCase();
}
