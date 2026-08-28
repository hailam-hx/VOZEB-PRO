# Thiết kế loại bỏ `needs_review`

Ngày: 2026-08-28  
Trạng thái: Đã xác nhận phạm vi trong hội thoại, chờ duyệt đặc tả

## Mục tiêu

Loại bỏ hoàn toàn cơ chế quản trị `接管待确认任务` và trạng thái thực thi `needs_review`. Khi hệ thống không thể xác nhận kết quả tạo upstream, task phải kết thúc thất bại ngay, không tự tạo lại request, giải phóng điểm tạm giữ và không tạo bản ghi tiêu hao.

## Phạm vi

- Text, image, video và audio task runtime.
- Generation Worker, scheduler, task store và recovery service.
- Billing hold và quyết toán task tạo media.
- Trang 后台 → 生成运维, API quản trị và service tiếp quản thủ công.
- Schema PostgreSQL và toàn bộ TypeScript type liên quan.
- Unit, service, route và worker tests liên quan.

Agent Run chỉ nhận kết quả thất bại từ task con theo cơ chế hiện có; không bổ sung trạng thái thay thế mới cho Agent.

## Hành vi mới

### Kết quả upstream không xác định

Các trường hợp trước đây trả về `needs_review`, bao gồm thiếu task ID, kết quả submit không xác định, query path thiếu hoặc không hợp lệ, và Worker thiếu handler, sẽ được xử lý như sau:

1. Không gửi lại request tạo media và không đổi binding/channel.
2. Ghi lý do thất bại cụ thể vào task.
3. Chuyển task nghiệp vụ sang trạng thái `error` và execution phase sang `completed`.
4. Đóng generation task để Worker không tiếp tục nhận lại.
5. Giải phóng billing hold đang hoạt động.
6. Không tạo consume record và không trừ điểm thực tế.

Quy tắc này chấp nhận rủi ro upstream có thể đã nhận request nhưng không trả về bằng chứng truy vấn. Hệ thống ưu tiên kết thúc rõ ràng và không giữ điểm vô thời hạn; không tự retry để tránh tạo trùng.

### Giao diện quản trị

- Xóa biểu tượng khiên, tooltip và modal `接管待确认任务` trên desktop/mobile.
- Xóa các hành động `录入任务 ID`, `录入结果地址` và `确认未创建`.
- Task queue chỉ còn trạng thái thành công, thất bại, hủy, đang chạy hoặc tạm dừng theo contract hiện có.
- Không giữ endpoint quản trị tương thích cho chức năng đã xóa.

### Billing

- Thành công: quyết toán hold và tạo consume record như hiện tại.
- Thất bại do kết quả upstream không xác định: release hold, không tạo consume record.
- Hủy sau khi upstream đã được xác nhận nhận request: giữ nguyên quy tắc quyết toán hiện có, không bị thay đổi bởi đặc tả này.

## Thay đổi cấu trúc

- Xóa `needs_review` khỏi `GenerationTaskExecutionPhase`, parser/validator và CHECK constraint trong schema nguồn.
- Xóa `canReview` khỏi DTO `AdminGenerationTask`.
- Xóa route `/api/admin/generation-operations/[type]/[id]/review` và generation task review service.
- Xóa reason helper chỉ phục vụ trạng thái `needs_review` nếu không còn consumer.
- Thay các nhánh recovery/runtime trả `needs_review` bằng đường kết thúc thất bại dùng helper thất bại hiện có của từng loại task.
- Thay các nhánh billing trả `needs_review` bằng kết quả release/failure rõ ràng phù hợp với contract gọi hiện tại.

## Dữ liệu

Dự án chưa phát hành nên không thêm migration hoặc lớp tương thích cho record cũ. Schema và code được chuẩn hóa trực tiếp theo state machine mới. Môi trường chứa dữ liệu thử nghiệm cũ cần được khởi tạo lại theo quy trình phát triển hiện có nếu còn record `needs_review`.

## Kiểm thử

- Test RED chứng minh UI/DTO/API tiếp quản vẫn tồn tại trước khi xóa.
- Test runtime cho text, image, video và audio xác nhận tình huống không xác định kết thúc thất bại, không trả `needs_review`.
- Test recovery/worker xác nhận task không được lên lịch lại và không bị nhận lại.
- Test billing xác nhận hold được release và consume record không được tạo.
- Test schema/type xác nhận `needs_review` không còn là execution phase hợp lệ.
- Chạy test liên quan, typecheck, lint/format; sau đó chạy toàn bộ quality gate theo `AGENTS.md` trước khi báo hoàn tất.

## Ngoài phạm vi

- Không thay đổi giao thức provider hoặc bổ sung retry/failover mới.
- Không tự sửa dữ liệu production hoặc viết logic tương thích cho record cũ.
- Không thay đổi quy tắc quyết toán đối với task thành công hay task hủy sau khi upstream đã nhận request.
