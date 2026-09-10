# Thiết kế đổi toàn bộ thương hiệu sang HOTX AI

Ngày: 2026-09-10  
Trạng thái: Đã được người dùng xác nhận

## Mục tiêu

Đổi toàn bộ thương hiệu sản phẩm hiển thị từ VOZEB PRO hoặc VOZEB sang HOTX AI trên ứng dụng web, trang SEO đa ngôn ngữ, tài liệu, email và nội dung hệ thống. Logo mới dùng tài nguyên do người dùng cung cấp tại `web/public/hx-favicon.png`.

Mã nguồn chỉ giữ tên HOTX AI và logo này làm nhận diện dự phòng an toàn. Nội dung có thể cấu hình trong 后台 không được điền sẵn bằng nội dung mặc định; giá trị thực tế phải đến từ `app_settings.site` hoặc file provider sau khi quản trị viên lưu.

Việc đổi thương hiệu không làm thay đổi các định danh kỹ thuật đang được dùng làm contract lưu trữ, cấu hình hoặc triển khai.

## Phạm vi thương hiệu hiển thị

- Tên mặc định của website, tiêu đề cửa sổ, metadata, Open Graph, Twitter metadata, structured data và web manifest.
- Header, footer, đăng nhập, khu vực người dùng, quản trị, trang chia sẻ, avatar trợ lý, trạng thái rỗng và nội dung cài đặt ban đầu.
- Nội dung SEO tiếng Việt, tiếng Anh và tiếng Trung giản thể cho Home, sáu landing page, Terms và Privacy.
- Tiêu đề, mô tả, từ khóa và nội dung pháp lý có nhắc tới tên sản phẩm.
- Email giao dịch, tên người gửi mặc định, prompt hệ thống, prompt tối ưu hóa và thông báo tạo bởi hệ thống có nhắc tới thương hiệu.
- README, tài liệu kỹ thuật, tài liệu vận hành, hướng dẫn đóng góp, changelog và ảnh/tài nguyên cộng đồng liên quan tới thương hiệu cũ.
- Giá trị nhận diện trong bản sao lưu hoặc payload công khai khi đó là tên sản phẩm hiển thị.
- Unit test, integration test và Playwright fixture/assertion đang kiểm tra tên hoặc logo mặc định cũ.

## Logo và favicon

`web/public/hx-favicon.png` là nguồn logo tích hợp mặc định duy nhất. Tệp có kích thước 1254 × 1254, định dạng PNG RGBA và có nền trong suốt.

- `DEFAULT_SITE_SETTINGS.title`, `logoUrl` và `iconUrl` lần lượt dùng `HOTX AI`, `/hx-favicon.png` và `/hx-favicon.png` làm nhận diện dự phòng tối thiểu.
- Component `SiteLogo` hiển thị logo raster bằng ảnh `object-contain`, không dùng SVG mask hoặc tô màu logo theo theme.
- Favicon động, Apple icon, web manifest, ảnh metadata, header/footer, đăng nhập, quản trị và avatar trợ lý đều dùng cùng nguồn mặc định.
- Website tài liệu dùng bản sao cùng nội dung trong thư mục public của docs vì hai ứng dụng được build và deploy độc lập.
- Khả năng tải logo/icon tùy chỉnh trong trang quản trị được giữ nguyên. Khi không có cấu hình tùy chỉnh, mọi vị trí phải quay về logo HOTX AI.
- Các SVG thương hiệu cũ chỉ bị xóa sau khi không còn consumer thực tế.

## Ba友情链接

Xóa ba liên kết mặc định hiện tại:

1. VOZEB / `www.vozeb.com`.
2. Nhóm QQ mã nguồn mở VOZEB.
3. Linux.do.

Danh sách mặc định trở thành mảng rỗng. Nội dung README/docs, hằng số URL nhóm QQ, QR code và liên kết hỗ trợ VOZEB không còn mục đích sử dụng sẽ được xóa. Chức năng quản trị友情链接 và khả năng thêm liên kết mới vẫn được giữ nguyên; footer chỉ hiển thị cột này khi quản trị viên cấu hình ít nhất một liên kết hợp lệ đang bật.

Đối với cấu hình cục bộ đang chạy, ba mục hiện có sẽ được xóa qua luồng PATCH quản trị sẵn có và xác minh sau refresh. Không thêm migration hoặc nhánh tương thích dài hạn.

## Ranh giới định danh kỹ thuật

Các định danh sau được giữ nguyên để tránh phá vỡ contract kỹ thuật:

- Biến môi trường có tiền tố `VOZEB_PRO_*`.
- Tên bảng, trigger, khóa, cookie, storage key hoặc namespace kỹ thuật có `vozeb_pro`/`VOZEB_PRO`.
- Tên Docker image, service, volume hoặc package/repository slug cần tương thích với cấu hình hiện tại.
- Đường dẫn repository `csyqlz/VOZEB-PRO` khi tài liệu cần liên kết tới repository thực tế.

Các định danh này không được dùng làm tên sản phẩm hiển thị trong UI hoặc nội dung công khai mới.

## Dữ liệu và cấu hình quản trị

- Schema `SiteSettings` và cơ chế quản trị logo/title/SEO không thay đổi.
- Chỉ title, logo và icon có giá trị nhận diện dự phòng HOTX AI. Các trường SEO của cả ba locale, footer copyright, Terms/Privacy URL và version,友情链接, social label/URL, trạng thái social và mail sender name đều mặc định rỗng hoặc tắt.
- Các SMTP provider/host/port kỹ thuật hiện có không thuộc nội dung thương hiệu và có thể giữ nguyên để form mail hoạt động; `fromName` không được điền sẵn.
- Form 后台 dùng placeholder hướng dẫn trung tính, không hiển thị hoặc tự lưu nội dung marketing mặc định. Dòng “留空后使用该语言的内置默认值” phải được bỏ; trạng thái trống được hiển thị là chưa cấu hình.
- Khi SEO title trống, metadata chỉ dùng `site.title` làm nhận diện tối thiểu; description và keywords vẫn trống/không phát sinh. Fallback này không được ghi ngược vào settings.
- Khi URL Terms/Privacy trong settings trống, route công khai `/terms` và `/privacy` vẫn tồn tại và auth UI có thể điều hướng tới route locale tương ứng; các URL này không được ghi ngược thành giá trị cấu hình mặc định.
- Cấu hình được lưu qua `app_settings.site` JSONB hoặc file provider hiện có.
- Không thêm bảng, cột, migration hay logic tương thích với giá trị thương hiệu cũ.
- Trang quản trị vẫn cho phép thay tên, logo, icon, SEO và友情链接 trong tương lai.
- Môi trường hiện tại được lưu rõ HOTX AI title/logo/icon, SEO ba locale, footer copyright, Terms/Privacy URL/version và danh sách友情链接 rỗng qua API quản trị hiện có. Đây là dữ liệu quản trị, không phải default trong code.

## Quy tắc thay thế

Không dùng thay thế chuỗi mù trên toàn repository. Mỗi occurrence được phân loại trước khi sửa:

- Nội dung người dùng nhìn thấy: đổi sang HOTX AI.
- Nội dung nội bộ tạo ra văn bản công khai hoặc email: đổi sang HOTX AI.
- Tên lịch sử trong changelog/docs nhưng vẫn mô tả sản phẩm: đổi hoặc viết lại để không quảng bá thương hiệu cũ.
- Định danh kỹ thuật thuộc danh sách giữ nguyên: không đổi.
- Tài nguyên và liên kết VOZEB đã bị loại khỏi sản phẩm: xóa nếu không còn tham chiếu.

## Kiểm thử và nghiệm thu

- Unit test xác nhận default title là `HOTX AI`, logo và icon mặc định là `/hx-favicon.png`; SEO, copyright, policy settings, social settings, mail sender và友情链接 mặc định rỗng/tắt.
- Test `SiteLogo`, favicon route, manifest và metadata xác nhận không còn phụ thuộc `/logo.svg` hoặc `/icon.svg` mặc định.
- Test SEO ba locale dùng cấu hình fixture đã lưu, xác nhận title, description, Open Graph, Twitter và structured data sử dụng HOTX AI; test không dựa vào nội dung SEO hard-code.
- Test settings round-trip xác nhận logo/title/SEO/footer/policy đã cấu hình và danh sách友情链接 rỗng được persist, đọc lại ngay và không xuất hiện lại sau refresh.
- Playwright kiểm tra các vị trí nhận diện chính ở desktop, 390px và 430px; logo không méo, không bị mask sai và không gây tràn ngang.
- Quét UTF-8 và quét repository xác nhận không còn `VOZEB PRO`/`VOZEB` trong nội dung hiển thị, ngoại trừ whitelist định danh kỹ thuật và URL repository đã duyệt.
- Chạy test liên quan trong quá trình phát triển, sau đó chạy `pnpm run check:release` và toàn bộ `pnpm run e2e` theo `AGENTS.md` trước khi báo hoàn tất.

## Ngoài phạm vi

- Không đổi các namespace kỹ thuật, tên repository hoặc biến môi trường đã được xác nhận giữ nguyên.
- Không thiết kế lại hình ảnh do người dùng cung cấp hoặc tự sinh biến thể thương hiệu mới.
- Không xóa khả năng quản trị logo, icon hoặc友情链接.
- Không nâng phiên bản Next.js, `next-intl` hoặc dependency không liên quan.
