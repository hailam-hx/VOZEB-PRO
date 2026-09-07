import type { CreateAgentMode } from "@/lib/create-agent-prompt";

export const SEO_LANDING_SLUGS = ["ai-image-generator", "ai-video-generator", "ai-voice-generator", "voice-cloning", "ai-short-drama", "ai-agent"] as const;

export type SeoLandingSlug = (typeof SEO_LANDING_SLUGS)[number];

export type SeoLandingCta = { kind: "create"; mode: CreateAgentMode; label: string } | { kind: "workspace"; href: "/voices" | "/drama"; label: string };

type SeoLandingCard = {
    title: string;
    description: string;
};

type SeoLandingFaq = {
    question: string;
    answer: string;
};

type SeoLandingVisual = {
    src: string;
    alt: string;
    width: number;
    height: number;
};

type SeoLandingPrompt = {
    label: string;
    placeholder: string;
    examples: string[];
};

export type SeoLandingDefinition = {
    slug: SeoLandingSlug;
    eyebrow: string;
    primaryKeyword: string;
    secondaryKeywords: string[];
    title: string;
    h1: string;
    description: string;
    heroNote: string;
    showcaseTitle: string;
    showcaseDescription: string;
    useCasesTitle: string;
    useCasesDescription: string;
    useCases: SeoLandingCard[];
    stepsTitle: string;
    stepsDescription: string;
    steps: SeoLandingCard[];
    capabilitiesTitle: string;
    capabilitiesDescription: string;
    capabilities: SeoLandingCard[];
    faqs: SeoLandingFaq[];
    visual: SeoLandingVisual;
    prompt?: SeoLandingPrompt;
    cta: SeoLandingCta;
    finalCtaTitle: string;
    finalCtaDescription: string;
    related: SeoLandingSlug[];
};

export const SEO_LANDING_DEFINITIONS = {
    "ai-image-generator": {
        slug: "ai-image-generator",
        eyebrow: "TRÌNH TẠO ẢNH AI",
        primaryKeyword: "tạo ảnh AI",
        secondaryKeywords: ["trình tạo ảnh AI", "tạo ảnh từ văn bản", "tạo ảnh AI online", "AI image generator"],
        title: "Tạo ảnh AI online từ văn bản và ảnh | HOTX AI",
        h1: "Tạo ảnh AI từ ý tưởng và ảnh tham chiếu",
        description: "Tạo ảnh AI từ mô tả tiếng Việt hoặc ảnh tham chiếu. Chọn tỷ lệ, chất lượng và để HOTX AI gợi ý mô hình phù hợp cho nội dung marketing.",
        heroNote: "Phù hợp cho creator, đội marketing và shop cần thử nhanh nhiều hướng hình ảnh trong cùng một quy trình.",
        showcaseTitle: "Từ brief tiếng Việt đến hình ảnh có thể tiếp tục tinh chỉnh",
        showcaseDescription: "Mô tả mục tiêu, thêm ảnh tham chiếu khi cần và theo dõi kết quả trong cùng một cuộc hội thoại sáng tạo.",
        useCasesTitle: "Tạo hình ảnh cho nhiều điểm chạm nội dung",
        useCasesDescription: "Bắt đầu từ mục tiêu sử dụng thay vì phải tự đoán mô hình hay cấu hình kỹ thuật.",
        useCases: [
            { title: "Ảnh sản phẩm", description: "Thử bối cảnh, ánh sáng và cách trình bày sản phẩm cho gian hàng hoặc chiến dịch." },
            { title: "Quảng cáo mạng xã hội", description: "Tạo concept hình ảnh theo thông điệp, đối tượng và định dạng của từng kênh." },
            { title: "Key visual", description: "Phát triển hướng hình ảnh chủ đạo cho landing page, banner và nội dung ra mắt." },
            { title: "Minh họa nội dung", description: "Chuyển ý tưởng, bài viết hoặc kịch bản thành hình minh họa đồng nhất hơn." },
        ],
        stepsTitle: "Quy trình tạo ảnh AI rõ ràng",
        stepsDescription: "Bạn đưa ra mục tiêu; HOTX AI hỗ trợ tổ chức phần còn lại của tác vụ.",
        steps: [
            { title: "Viết mô tả", description: "Nêu chủ thể, bối cảnh, phong cách và nơi bạn dự định sử dụng hình ảnh." },
            { title: "Thêm ảnh tham chiếu", description: "Gắn hình ảnh có quyền sử dụng khi cần giữ bố cục, sản phẩm hoặc định hướng thị giác." },
            { title: "Chọn ưu tiên", description: "Chọn tỷ lệ và chất lượng trong phạm vi năng lực mà mô hình đang khả dụng hỗ trợ." },
            { title: "Tạo và tiếp tục", description: "Xem kết quả, tải xuống, trích dẫn lại hoặc tiếp tục trao đổi trong cùng tác vụ." },
        ],
        capabilitiesTitle: "Năng lực bám sát cấu hình thực tế",
        capabilitiesDescription: "Các lựa chọn hiển thị phụ thuộc vào hồ sơ năng lực của mô hình đang hoạt động, không phải thông số quảng cáo cố định.",
        capabilities: [
            { title: "Văn bản thành ảnh", description: "Nhận brief tiếng Việt và chuyển thành yêu cầu tạo ảnh có cấu trúc." },
            { title: "Ảnh tham chiếu", description: "Kết hợp tài liệu hình ảnh do bạn cung cấp khi mô hình phù hợp hỗ trợ." },
            { title: "Tỷ lệ và chất lượng", description: "Chỉ đưa ra những lựa chọn tương thích với năng lực đã được cấu hình." },
            { title: "Lịch sử sáng tạo", description: "Lưu kết quả theo cuộc hội thoại để dễ tiếp tục, tải xuống hoặc thử lại khi có lỗi." },
        ],
        faqs: [
            { question: "Tôi có thể viết prompt bằng tiếng Việt không?", answer: "Có. Bạn có thể mô tả mục tiêu bằng tiếng Việt; hệ thống sẽ hỗ trợ lập kế hoạch và chọn quy trình phù hợp trước khi tạo ảnh." },
            { question: "Có thể dùng ảnh sản phẩm làm tham chiếu không?", answer: "Có, nếu bạn có quyền sử dụng ảnh đó. Khả năng xử lý tham chiếu cụ thể phụ thuộc vào mô hình đang khả dụng tại thời điểm tạo." },
            { question: "Tôi có cần tự chọn mô hình không?", answer: "Không bắt buộc. Chế độ lập kế hoạch có thể gợi ý mô hình và tham số tương thích; bạn vẫn có thể dùng lựa chọn được công khai trên giao diện." },
            { question: "Ảnh tạo xong có thể tải xuống không?", answer: "Kết quả hoàn tất có thao tác tải xuống và có thể được trích dẫn để tiếp tục tác vụ trong HOTX AI." },
        ],
        visual: { src: "/seo/hotx-create-workspace.webp", alt: "Giao diện tạo ảnh và quản lý kết quả trong HOTX AI", width: 1440, height: 900 },
        prompt: {
            label: "Mô tả hình ảnh bạn muốn tạo",
            placeholder: "Ví dụ: Ảnh sản phẩm serum trên nền đá sáng, ánh nắng sớm, phong cách tối giản cho quảng cáo mạng xã hội…",
            examples: ["Ảnh sản phẩm tối giản", "Key visual chiến dịch", "Minh họa bài viết"],
        },
        cta: { kind: "create", mode: "image", label: "Bắt đầu tạo ảnh AI" },
        finalCtaTitle: "Biến brief hình ảnh tiếp theo thành một tác vụ có thể thực hiện",
        finalCtaDescription: "Bắt đầu bằng một mô tả tiếng Việt; bạn có thể bổ sung tham chiếu và lựa chọn phù hợp trong workspace.",
        related: ["ai-video-generator", "ai-agent", "ai-voice-generator"],
    },
    "ai-video-generator": {
        slug: "ai-video-generator",
        eyebrow: "TRÌNH TẠO VIDEO AI",
        primaryKeyword: "tạo video AI",
        secondaryKeywords: ["video AI từ văn bản", "ảnh thành video AI", "text to video", "image to video"],
        title: "Tạo video AI từ văn bản và hình ảnh | HOTX AI",
        h1: "Tạo video AI từ văn bản và hình ảnh",
        description: "Tạo video AI từ văn bản hoặc hình ảnh cho quảng cáo, TikTok và Reels. Chọn tỷ lệ, độ nét và thời lượng theo năng lực mô hình đang khả dụng.",
        heroNote: "Tổ chức ý tưởng, hình tham chiếu và kết quả video trong một không gian sáng tạo thống nhất.",
        showcaseTitle: "Một workspace cho cả text-to-video và image-to-video",
        showcaseDescription: "Từ một brief ngắn, bạn có thể bổ sung khung hình, chọn ưu tiên đầu ra và tiếp tục làm việc với kết quả.",
        useCasesTitle: "Video cho chiến dịch và nội dung ngắn",
        useCasesDescription: "Thiết kế tác vụ theo mục tiêu phân phối thực tế của đội nội dung.",
        useCases: [
            { title: "Video quảng cáo", description: "Khởi tạo cảnh quay cho sản phẩm, ưu đãi hoặc thông điệp chiến dịch." },
            { title: "TikTok và Reels", description: "Phát triển chuyển động ngắn theo tỷ lệ và thời lượng mà mô hình hỗ trợ." },
            { title: "Ảnh thành video", description: "Dùng hình ảnh có quyền sử dụng làm điểm bắt đầu cho chuyển động hoặc bối cảnh." },
            { title: "Concept chuyển động", description: "Thử nhịp độ, góc máy và diễn tiến trước khi đưa vào quy trình sản xuất rộng hơn." },
        ],
        stepsTitle: "Tạo video AI theo từng quyết định cần thiết",
        stepsDescription: "Tập trung vào nội dung và mục tiêu; giao diện chỉ mở những tham số thực sự được hỗ trợ.",
        steps: [
            { title: "Mô tả cảnh quay", description: "Nêu chủ thể, hành động, góc máy, không khí và kênh dự kiến đăng tải." },
            { title: "Chọn cách tham chiếu", description: "Dùng văn bản, ảnh thường, khung đầu hoặc khung đầu–cuối khi năng lực tương ứng khả dụng." },
            { title: "Đặt ưu tiên đầu ra", description: "Chọn tỷ lệ, độ nét và thời lượng từ các giá trị được cấu hình cho mô hình." },
            { title: "Theo dõi kết quả", description: "Xem trạng thái, phát video hoàn tất, tải xuống hoặc thử lại tác vụ thất bại." },
        ],
        capabilitiesTitle: "Kiểm soát dựa trên năng lực video đang hoạt động",
        capabilitiesDescription: "HOTX AI không mặc định hứa một độ nét hay thời lượng cố định cho mọi mô hình.",
        capabilities: [
            { title: "Text-to-video", description: "Tạo tác vụ video từ mô tả chuyển động và ngữ cảnh bằng văn bản." },
            { title: "Image-to-video", description: "Sử dụng ảnh tham chiếu khi mô hình được chọn hỗ trợ phương thức này." },
            { title: "Khung đầu và khung cuối", description: "Gán vai trò ảnh rõ ràng cho quy trình cần kiểm soát điểm bắt đầu và kết thúc." },
            { title: "Tỷ lệ, độ nét, thời lượng", description: "Tùy chọn cụ thể được lọc theo hồ sơ năng lực công khai của mô hình." },
        ],
        faqs: [
            { question: "HOTX AI hỗ trợ video từ văn bản hay từ ảnh?", answer: "Hệ thống hỗ trợ cả hai hướng khi có mô hình tương thích. Tùy chọn khả dụng được hiển thị theo cấu hình thực tế." },
            { question: "Tôi có thể đặt khung đầu và khung cuối không?", answer: "Có thể khi mô hình hỗ trợ. Hai ảnh phải được bạn chọn rõ vai trò và không dùng cùng một ảnh cho cả hai vị trí." },
            { question: "Có thể chọn tỷ lệ cho TikTok hoặc Reels không?", answer: "Bạn có thể chọn tỷ lệ trong danh sách mà mô hình đang hoạt động hỗ trợ; nếu chưa được cấu hình, giao diện giữ lựa chọn tự động." },
            { question: "Nếu tác vụ video thất bại thì sao?", answer: "Tác vụ thất bại có thể được thử lại theo đúng bản ghi và cuộc hội thoại ban đầu, giúp giữ nguyên ngữ cảnh làm việc." },
        ],
        visual: { src: "/seo/hotx-create-workspace.webp", alt: "Giao diện tạo video từ mô tả và hình ảnh trong HOTX AI", width: 1440, height: 900 },
        prompt: {
            label: "Mô tả video bạn muốn tạo",
            placeholder: "Ví dụ: Cảnh cận sản phẩm trên bàn, camera tiến chậm, ánh sáng ấm, nhịp phù hợp video quảng cáo dọc…",
            examples: ["Video quảng cáo dọc", "Ảnh sản phẩm chuyển động", "Concept cho Reels"],
        },
        cta: { kind: "create", mode: "video", label: "Bắt đầu tạo video AI" },
        finalCtaTitle: "Đưa ý tưởng video vào đúng quy trình từ bước đầu tiên",
        finalCtaDescription: "Mô tả cảnh quay hoặc bắt đầu với một hình ảnh; HOTX AI sẽ mở các lựa chọn phù hợp với năng lực đang có.",
        related: ["ai-image-generator", "ai-short-drama", "ai-agent"],
    },
    "ai-voice-generator": {
        slug: "ai-voice-generator",
        eyebrow: "TRÌNH TẠO GIỌNG NÓI AI",
        primaryKeyword: "tạo giọng nói AI",
        secondaryKeywords: ["chuyển văn bản thành giọng nói", "text to speech tiếng Việt", "lồng tiếng AI"],
        title: "Tạo giọng nói AI từ văn bản | HOTX AI",
        h1: "Tạo giọng nói AI tự nhiên từ văn bản",
        description: "Chuyển văn bản thành giọng nói AI cho video, quảng cáo, podcast và đào tạo. Chọn giọng, định dạng, nghe kết quả và tải tệp trên HOTX AI.",
        heroNote: "Soạn nội dung, chọn hồ sơ giọng phù hợp và quản lý tệp âm thanh ngay trong luồng sáng tạo.",
        showcaseTitle: "Từ kịch bản chữ đến tệp giọng đọc có thể sử dụng",
        showcaseDescription: "Tập trung vào nội dung cần truyền đạt, sau đó chọn giọng và định dạng trong phạm vi đang được hỗ trợ.",
        useCasesTitle: "Giọng đọc cho những nội dung cần xuất bản đều đặn",
        useCasesDescription: "Một luồng làm việc chung cho nội dung marketing, giáo dục và truyền thông.",
        useCases: [
            { title: "Voice-over video", description: "Tạo lời dẫn cho video giới thiệu, hướng dẫn hoặc nội dung mạng xã hội." },
            { title: "Quảng cáo", description: "Chuyển thông điệp chiến dịch thành bản đọc để thử nhịp và cách diễn đạt." },
            { title: "Podcast", description: "Tạo các đoạn dẫn, bản nháp âm thanh hoặc nội dung theo kịch bản đã chuẩn bị." },
            { title: "Đào tạo", description: "Tạo giọng đọc cho tài liệu hướng dẫn và nội dung học tập nội bộ." },
        ],
        stepsTitle: "Chuyển văn bản thành giọng nói trong bốn bước",
        stepsDescription: "Nội dung, giọng đọc và đầu ra được quản lý trong cùng một tác vụ.",
        steps: [
            { title: "Nhập kịch bản", description: "Dán hoặc viết nội dung cần đọc, có thể dùng tiếng Việt và chỉnh sửa trước khi gửi." },
            { title: "Chọn giọng", description: "Chọn hồ sơ giọng đang khả dụng hoặc giọng tùy chỉnh mà bạn có quyền sử dụng." },
            { title: "Chọn định dạng", description: "Chỉ định đầu ra từ các định dạng đã được cấu hình cho năng lực âm thanh." },
            { title: "Nghe và tải", description: "Phát thử kết quả hoàn tất, tải tệp hoặc tiếp tục tác vụ khi cần điều chỉnh nội dung." },
        ],
        capabilitiesTitle: "Các lựa chọn âm thanh được công khai minh bạch",
        capabilitiesDescription: "Giọng và định dạng khả dụng có thể thay đổi theo cấu hình vận hành, nên giao diện chỉ hiển thị lựa chọn dùng được.",
        capabilities: [
            { title: "Văn bản thành giọng nói", description: "Chuyển kịch bản thành tác vụ audio trong workspace đa phương tiện." },
            { title: "Hồ sơ giọng", description: "Chọn giọng hệ thống hoặc hồ sơ giọng tùy chỉnh được phép sử dụng." },
            { title: "Định dạng đầu ra", description: "Chọn định dạng từ năng lực được quản trị viên cấu hình cho mô hình." },
            { title: "Phát và tải tệp", description: "Nghe trực tiếp kết quả sẵn sàng và tải tệp cho quy trình biên tập tiếp theo." },
        ],
        faqs: [
            { question: "Tôi có thể tạo giọng đọc tiếng Việt không?", answer: "Bạn có thể nhập kịch bản tiếng Việt. Chất giọng và ngôn ngữ đầu ra cụ thể phụ thuộc vào hồ sơ giọng và mô hình đang khả dụng." },
            { question: "Có thể nghe thử trước khi tải không?", answer: "Có. Kết quả audio hoàn tất có trình phát để nghe lại trước khi bạn tải tệp." },
            { question: "Tôi có thể dùng giọng đã nhân bản không?", answer: "Có thể dùng hồ sơ giọng của bạn cho tác vụ audio khi hồ sơ đã xử lý xong và bạn có quyền sử dụng mẫu nguồn." },
            { question: "Hệ thống hỗ trợ định dạng âm thanh nào?", answer: "Giao diện hiển thị những định dạng được mô hình đang chọn hỗ trợ. HOTX AI không áp một danh sách cố định cho mọi cấu hình." },
        ],
        visual: { src: "/seo/hotx-create-workspace.webp", alt: "Giao diện tạo và quản lý giọng nói AI trong HOTX AI", width: 1440, height: 900 },
        prompt: {
            label: "Nhập nội dung bạn muốn chuyển thành giọng nói",
            placeholder: "Ví dụ: Chào mừng bạn đến với bản tin tuần này. Hôm nay chúng ta sẽ cùng xem ba xu hướng nổi bật…",
            examples: ["Lời dẫn quảng cáo", "Mở đầu podcast", "Bài học ngắn"],
        },
        cta: { kind: "create", mode: "audio", label: "Bắt đầu tạo giọng nói" },
        finalCtaTitle: "Tạo bản đọc đầu tiên từ chính kịch bản của bạn",
        finalCtaDescription: "Nhập nội dung tiếng Việt, sau đó chọn giọng và định dạng đang được hỗ trợ trong workspace.",
        related: ["voice-cloning", "ai-video-generator", "ai-agent"],
    },
    "voice-cloning": {
        slug: "voice-cloning",
        eyebrow: "NHÂN BẢN GIỌNG NÓI CÓ SỰ ĐỒNG Ý",
        primaryKeyword: "nhân bản giọng nói AI",
        secondaryKeywords: ["sao chép giọng nói", "clone voice", "tạo giọng nói của tôi"],
        title: "Nhân bản giọng nói AI có sự đồng ý | HOTX AI",
        h1: "Nhân bản giọng nói AI từ mẫu thu của bạn",
        description: "Nhân bản giọng nói AI từ mẫu thu mà bạn có quyền sử dụng. Tạo, quản lý, nghe thử và dùng hồ sơ giọng nói cho nội dung được cho phép.",
        heroNote: "Chỉ tải mẫu của chính bạn hoặc nội dung mà bạn đã được chủ thể giọng nói cho phép sử dụng.",
        showcaseTitle: "Hồ sơ giọng được quản lý riêng trước khi đưa vào tác vụ audio",
        showcaseDescription: "Workspace cho biết trạng thái xử lý và cung cấp các thao tác cần thiết để bạn kiểm soát hồ sơ giọng của mình.",
        useCasesTitle: "Duy trì chất giọng nhất quán cho nội dung được cho phép",
        useCasesDescription: "Hồ sơ giọng tùy chỉnh phù hợp với quy trình có sự đồng ý rõ ràng và nhu cầu sử dụng lặp lại.",
        useCases: [
            { title: "Kênh nội dung cá nhân", description: "Duy trì chất giọng của chính bạn trong các nội dung đã chuẩn bị trước." },
            { title: "Đào tạo nội bộ", description: "Tạo lời đọc nhất quán cho tài liệu mà tổ chức có quyền sản xuất." },
            { title: "Thương hiệu được ủy quyền", description: "Quản lý hồ sơ giọng của người đại diện khi đã có sự đồng ý phù hợp." },
            { title: "Tiếp tục tác vụ audio", description: "Chọn hồ sơ đã sẵn sàng làm giọng đầu vào cho nội dung mới." },
        ],
        stepsTitle: "Quy trình nhân bản giọng nói có kiểm soát",
        stepsDescription: "Mẫu nguồn, xác nhận quyền và hồ sơ kết quả được tách thành các bước rõ ràng.",
        steps: [
            { title: "Chuẩn bị mẫu thu", description: "Chọn tệp âm thanh rõ tiếng mà bạn có quyền dùng cho mục đích tạo hồ sơ giọng." },
            { title: "Xác nhận quyền sử dụng", description: "Xác nhận mẫu thuộc về bạn hoặc đã được chủ thể giọng nói cho phép." },
            { title: "Theo dõi xử lý", description: "Hồ sơ hiển thị trạng thái để bạn biết khi nào giọng đã sẵn sàng để nghe thử." },
            { title: "Quản lý và sử dụng", description: "Nghe thử, đổi tên, xóa hoặc chọn hồ sơ cho một tác vụ tạo giọng nói." },
        ],
        capabilitiesTitle: "Các thao tác thật trong workspace giọng nói",
        capabilitiesDescription: "Landing page dẫn vào khu vực quản lý hiện có, không mô phỏng việc nhân bản ngay trên trang giới thiệu.",
        capabilities: [
            { title: "Tải mẫu âm thanh", description: "Gửi mẫu nguồn từ khu vực quản lý hồ sơ giọng sau khi đăng nhập." },
            { title: "Xác nhận sự đồng ý", description: "Yêu cầu xác nhận quyền sử dụng trước khi tạo hồ sơ giọng." },
            { title: "Trạng thái và nghe thử", description: "Theo dõi quá trình xử lý và phát thử hồ sơ khi đã sẵn sàng." },
            { title: "Đổi tên và xóa", description: "Quản lý tên hiển thị hoặc xóa hồ sơ không còn cần thiết." },
        ],
        faqs: [
            { question: "Tôi có thể nhân bản giọng của người khác không?", answer: "Chỉ khi bạn có sự đồng ý và quyền sử dụng phù hợp từ chủ thể giọng nói. Không tải lên mẫu thu trái phép hoặc dùng để mạo danh." },
            { question: "Hồ sơ giọng có dùng ngay sau khi tải lên không?", answer: "Hồ sơ cần được xử lý. Workspace hiển thị trạng thái để bạn biết khi nào có thể nghe thử và sử dụng." },
            { question: "Tôi có thể xóa hồ sơ giọng không?", answer: "Có. Khu vực quản lý hỗ trợ đổi tên và xóa hồ sơ giọng của tài khoản." },
            { question: "Hồ sơ giọng được dùng ở đâu?", answer: "Hồ sơ sẵn sàng có thể được chọn trong tác vụ tạo âm thanh khi năng lực đang hoạt động hỗ trợ lựa chọn đó." },
        ],
        visual: { src: "/seo/hotx-voice-workspace.webp", alt: "Khu vực quản lý hồ sơ giọng nói trong HOTX AI", width: 1280, height: 720 },
        cta: { kind: "workspace", href: "/voices", label: "Nhân bản giọng nói của tôi" },
        finalCtaTitle: "Tạo hồ sơ từ mẫu giọng bạn có quyền sử dụng",
        finalCtaDescription: "Đăng nhập để tải mẫu, xác nhận quyền sử dụng và quản lý hồ sơ giọng trong workspace riêng.",
        related: ["ai-voice-generator", "ai-agent", "ai-video-generator"],
    },
    "ai-short-drama": {
        slug: "ai-short-drama",
        eyebrow: "WORKSPACE PHIM NGẮN AI",
        primaryKeyword: "tạo phim ngắn AI",
        secondaryKeywords: ["làm phim bằng AI", "tạo kịch bản AI", "phân cảnh AI", "AI short drama"],
        title: "Tạo phim ngắn AI từ kịch bản đến cảnh quay | HOTX AI",
        h1: "Tạo phim ngắn AI theo quy trình sản xuất hoàn chỉnh",
        description: "Tạo phim ngắn AI theo dự án: phát triển kịch bản, duyệt nội dung, tạo phân cảnh, quản lý tài sản và sản xuất từng cảnh quay.",
        heroNote: "Tách dự án, tập phim, tài sản và từng giai đoạn sản xuất để đội ngũ theo dõi công việc rõ ràng hơn.",
        showcaseTitle: "Không gian sản xuất từ kịch bản đến từng cảnh quay",
        showcaseDescription: "Các bước biên tập và tạo media được đặt trong cùng ngữ cảnh dự án, thay vì nằm rời rạc ở nhiều công cụ.",
        useCasesTitle: "Phù hợp với dự án kể chuyện có nhiều lớp nội dung",
        useCasesDescription: "Xây dựng nguồn sự thật chung cho nhân vật, bối cảnh và tiến độ từng tập.",
        useCases: [
            { title: "Series nội dung ngắn", description: "Tổ chức nhiều tập trong cùng dự án và theo dõi trạng thái sản xuất của từng tập." },
            { title: "Kịch bản thương hiệu", description: "Phát triển câu chuyện có nhân vật, cảnh và tài sản cần dùng lại xuyên suốt." },
            { title: "Storyboard trước sản xuất", description: "Duyệt cấu trúc cảnh và phân đoạn trước khi tạo từng shot." },
            { title: "Sản xuất theo nhóm", description: "Tách bước viết, duyệt, phân cảnh và tạo media để phối hợp rõ ràng hơn." },
        ],
        stepsTitle: "Một luồng sản xuất có điểm kiểm soát",
        stepsDescription: "Mỗi giai đoạn dựa trên dữ liệu thật của dự án và hiển thị nguyên nhân khi chưa thể tiếp tục.",
        steps: [
            { title: "Xây dựng tài sản dự án", description: "Quản lý nhân vật, bối cảnh, đạo cụ, manh mối và nguồn tham chiếu dùng cho toàn dự án." },
            { title: "Phát triển kịch bản", description: "Tổ chức tập phim, cảnh và nội dung kịch bản trong khu vực biên tập tập trung." },
            { title: "Duyệt và phân cảnh", description: "Kiểm tra nội dung rồi chuyển kịch bản thành storyboard và danh sách shot có cấu trúc." },
            { title: "Tạo cảnh quay", description: "Theo dõi video, lồng tiếng, tổng hợp và thử lại chính xác những phần thất bại." },
        ],
        capabilitiesTitle: "Các thành phần thật của workspace phim ngắn",
        capabilitiesDescription: "Trạng thái giai đoạn được suy ra từ kịch bản, duyệt, storyboard và kết quả tạo media của dự án.",
        capabilities: [
            { title: "Tài sản cấp dự án", description: "Nhân vật, bối cảnh và đạo cụ được quản lý chung, không bị giới hạn trong một tập." },
            { title: "Tập phim và kịch bản", description: "Tổ chức cấu trúc nội dung theo tập, cảnh và phiên bản làm việc." },
            { title: "Duyệt và storyboard", description: "Tạo điểm kiểm tra trước khi chuyển nội dung thành shot cần sản xuất." },
            { title: "Video, lồng tiếng và tổng hợp", description: "Hiển thị tiến độ và lỗi theo từng mục để xử lý đúng phần đang bị chặn." },
        ],
        faqs: [
            { question: "Workspace phim ngắn có chỉ tạo một video không?", answer: "Không. Đây là không gian theo dự án, hỗ trợ tổ chức nhiều tập, tài sản chung, kịch bản, storyboard và từng cảnh quay." },
            { question: "Tài sản nhân vật có thuộc riêng một tập không?", answer: "Không. Nhân vật, bối cảnh, đạo cụ và manh mối thuộc toàn dự án; mỗi tập có thể tham chiếu những tài sản liên quan." },
            { question: "Có bước duyệt nội dung trước khi tạo cảnh không?", answer: "Có. Luồng sản xuất tách giai đoạn kịch bản, duyệt nội dung, phân cảnh và tạo cảnh quay." },
            { question: "Nếu một cảnh quay thất bại thì xử lý thế nào?", answer: "Workspace hiển thị mục thất bại và nguyên nhân chặn để thử lại đúng shot hoặc bước liên quan, không cần tạo lại toàn bộ dự án." },
        ],
        visual: { src: "/seo/hotx-drama-workspace.webp", alt: "Workspace kịch bản, phân cảnh và cảnh quay phim ngắn trong HOTX AI", width: 1440, height: 900 },
        cta: { kind: "workspace", href: "/drama", label: "Bắt đầu dự án phim ngắn" },
        finalCtaTitle: "Đưa câu chuyện vào một quy trình sản xuất có cấu trúc",
        finalCtaDescription: "Tạo dự án để bắt đầu quản lý tài sản, tập phim, kịch bản và các giai đoạn sản xuất tiếp theo.",
        related: ["ai-video-generator", "ai-image-generator", "ai-agent"],
    },
    "ai-agent": {
        slug: "ai-agent",
        eyebrow: "AI AGENT ĐA PHƯƠNG TIỆN",
        primaryKeyword: "AI Agent",
        secondaryKeywords: ["AI Agent sáng tạo nội dung", "trợ lý AI đa phương tiện", "tự động hóa sáng tạo"],
        title: "AI Agent sáng tạo nội dung đa phương tiện | HOTX AI",
        h1: "Một AI Agent cho toàn bộ quy trình sáng tạo",
        description: "Mô tả mục tiêu bằng tiếng Việt; AI Agent hỗ trợ chọn quy trình, mô hình và tham số để tạo hình ảnh, video và âm thanh trong một nơi.",
        heroNote: "Bắt đầu bằng mục tiêu đầu ra; Agent hỗ trợ nối brief, lựa chọn năng lực và kết quả thành một cuộc hội thoại liên tục.",
        showcaseTitle: "Một điểm bắt đầu cho hình ảnh, video và âm thanh",
        showcaseDescription: "AI Agent tiếp nhận brief, lập kế hoạch nội bộ và đưa tác vụ đến năng lực phù hợp mà không phơi bày chi tiết vận hành không cần thiết.",
        useCasesTitle: "Giảm số lần chuyển ngữ cảnh trong quy trình sáng tạo",
        useCasesDescription: "Dành cho công việc bắt đầu từ mục tiêu nhưng có thể cần nhiều loại media khác nhau.",
        useCases: [
            { title: "Brief chiến dịch", description: "Chuyển mục tiêu marketing thành các đầu việc hình ảnh, video hoặc âm thanh liên quan." },
            { title: "Nội dung đa kênh", description: "Giữ yêu cầu và kết quả theo cùng cuộc hội thoại khi phát triển nhiều định dạng." },
            { title: "Thử hướng sáng tạo", description: "Khởi tạo phương án, xem kết quả rồi bổ sung yêu cầu mà không mất bối cảnh." },
            { title: "Tiếp tục tác vụ", description: "Mở lại hội thoại, theo dõi tiến độ và thử lại đúng vòng tạo thất bại." },
        ],
        stepsTitle: "Từ mục tiêu đến tác vụ media có thể theo dõi",
        stepsDescription: "Phần lập kế hoạch diễn ra nội bộ; bạn chỉ cần làm việc với yêu cầu và kết quả công khai.",
        steps: [
            { title: "Gửi brief", description: "Mô tả mục tiêu, đối tượng, kênh sử dụng và tài liệu tham chiếu bằng tiếng Việt." },
            { title: "Agent lập kế hoạch", description: "Hệ thống xác định loại tác vụ, lựa chọn năng lực và tham số tương thích ở phía sau." },
            { title: "Tạo media", description: "Tác vụ được chuyển đến quy trình hình ảnh, video hoặc âm thanh phù hợp." },
            { title: "Tiếp tục trong hội thoại", description: "Xem kết quả, tải xuống, trích dẫn hoặc thử lại đúng vòng làm việc khi cần." },
        ],
        capabilitiesTitle: "Agent điều phối trên năng lực đang có",
        capabilitiesDescription: "Lựa chọn cuối cùng vẫn bị giới hạn bởi mô hình và tham số mà quản trị viên đã cấu hình thực tế.",
        capabilities: [
            { title: "Tiếp nhận brief tiếng Việt", description: "Hiểu mục tiêu đầu ra và ngữ cảnh sử dụng trước khi chọn tác vụ." },
            { title: "Lựa chọn năng lực phù hợp", description: "Ghép yêu cầu với mô hình và tham số có hồ sơ năng lực tương thích." },
            { title: "Tạo media đa phương thức", description: "Điều phối tác vụ hình ảnh, video và âm thanh từ cùng một điểm bắt đầu." },
            { title: "Hội thoại và thử lại", description: "Lưu ngữ cảnh theo cuộc hội thoại, tiếp tục tác vụ và thử lại vòng thất bại." },
        ],
        faqs: [
            { question: "AI Agent có tự chọn mô hình không?", answer: "Agent có thể hỗ trợ chọn mô hình và tham số phù hợp từ danh mục được cấu hình. Lựa chọn chỉ dựa trên năng lực thực tế đang khả dụng." },
            { question: "Tôi có thể yêu cầu cả ảnh, video và âm thanh không?", answer: "Có thể bắt đầu các loại tác vụ này trong cùng workspace. Mỗi kết quả được tạo theo năng lực và tham số tương thích của loại media đó." },
            { question: "Agent có hiển thị prompt nội bộ không?", answer: "Không. Kế hoạch, lý do chọn mô hình và chỉ dẫn thực thi nội bộ không được hiển thị; giao diện tập trung vào yêu cầu công khai và kết quả." },
            { question: "Có thể tiếp tục sau khi đóng trang không?", answer: "Hội thoại và tác vụ được gắn với tài khoản để bạn có thể mở lại, theo dõi trạng thái và tiếp tục khi phù hợp." },
        ],
        visual: { src: "/seo/hotx-create-workspace.webp", alt: "Giao diện AI Agent đa phương tiện và kết quả sáng tạo trong HOTX AI", width: 1440, height: 900 },
        prompt: {
            label: "Bạn muốn tạo nội dung gì?",
            placeholder: "Ví dụ: Lên ý tưởng cho chiến dịch ra mắt sản phẩm, tạo key visual và một video ngắn cho mạng xã hội…",
            examples: ["Lập brief chiến dịch", "Tạo bộ nội dung đa kênh", "Phát triển ý tưởng sản phẩm"],
        },
        cta: { kind: "create", mode: "agent", label: "Bắt đầu với AI Agent" },
        finalCtaTitle: "Bắt đầu từ mục tiêu, không phải từ danh sách công cụ",
        finalCtaDescription: "Gửi brief bằng tiếng Việt để AI Agent hỗ trợ đưa công việc đến đúng quy trình sáng tạo.",
        related: ["ai-image-generator", "ai-video-generator", "ai-voice-generator"],
    },
} as const satisfies Record<SeoLandingSlug, SeoLandingDefinition>;

export function isSeoLandingSlug(value: string): value is SeoLandingSlug {
    return (SEO_LANDING_SLUGS as readonly string[]).includes(value);
}

export function getSeoLandingDefinition(value: string): SeoLandingDefinition | undefined {
    return isSeoLandingSlug(value) ? SEO_LANDING_DEFINITIONS[value] : undefined;
}
