# Thiết kế phương án tích hợp cổng thanh toán ZaloPay vào VOZEB-PRO

**Phiên bản:** 1.0  
**Ngày:** 2026-09-03  
**Dự án:** VOZEB-PRO custom  
**Phạm vi tài liệu:** Thiết kế kiến trúc và contract tích hợp ZaloPay. Tài liệu này **không phải implementation plan** và không quy định thứ tự thực hiện công việc.

---

## 1. Mục tiêu

Tích hợp ZaloPay vào hệ thống nạp tiền hiện có của VOZEB-PRO theo mô hình payment provider chính thức, ngang hàng với các provider đang có như Stripe, Alipay, WeChat và PayPly.

Mục tiêu chính:

- Cho phép người dùng chọn ZaloPay khi nạp tiền.
- Tạo giao dịch ZaloPay từ một `top_up_order` đã được hệ thống xác định số tiền.
- Hỗ trợ redirect sang ZaloPay Payment Gateway.
- Có thể tận dụng dữ liệu QR do ZaloPay trả về nếu giao diện cần hiển thị QR.
- Xác nhận thanh toán bằng callback server-to-server.
- Có cơ chế Query Order để phục hồi khi callback bị mất hoặc đến chậm.
- Tái sử dụng cơ chế settlement hiện tại để cộng积分/credits.
- Giữ nguyên cơ chế PAYG, pricing snapshot, wallet và ledger hiện tại.
- Bảo đảm idempotency: cùng một khoản thanh toán chỉ được cộng积分 một lần.
- Không tin trạng thái thanh toán từ frontend hoặc redirect URL.

---

## 2. Ngoài phạm vi

Phiên bản thiết kế này không yêu cầu:

- Xây lại hệ thống billing.
- Xây ví tiền mới.
- Thay đổi cơ chế PAYG.
- Thay đổi công thức quy đổi VND → giá trị nạp → credits.
- Dùng redirect URL làm nguồn xác nhận thanh toán.
- Tự động partial refund ở phiên bản đầu tiên.
- Lập kế hoạch triển khai chi tiết theo task/commit.
- Quy định Codex phải sửa file nào trước file nào.

Refund tự động có thể triển khai ở giai đoạn mở rộng sau khi payment flow ổn định.

---

## 3. Kiến trúc billing hiện tại liên quan

Source hiện tại đã có các thành phần chính:

```text
User
  │
  ▼
Top-up Quote
  │
  ▼
Top-up Order
  │
  ▼
Payment Checkout Service
  │
  ▼
Payment Provider
  │
  ▼
Payment Webhook
  │
  ▼
TopUpPaymentEvent
  │
  ▼
Settlement
  │
  ├── top_up_payment_events
  ├── top_up_payments
  ├── top_up_orders
  ├── point_records
  └── users.settled_balance
```

Các module quan trọng trong source hiện tại gồm:

```text
web/src/lib/payment-config-types.ts
web/src/lib/payment-provider.ts

web/src/lib/server/payment-config-store.ts
web/src/lib/server/payment-checkout-types.ts
web/src/lib/server/payment-checkout-service.ts
web/src/lib/server/payment-checkout-providers.ts
web/src/lib/server/payment-webhook-adapters.ts

web/src/lib/server/top-up-commerce-service.ts
web/src/lib/server/top-up-payment.ts
web/src/lib/server/top-up-webhook-service.ts
web/src/lib/server/top-up-postgres-settlement.ts

web/src/app/api/billing/top-ups/orders/[id]/checkout/route.ts
web/src/app/api/billing/webhooks/[provider]/route.ts

web/src/app/(user)/billing/checkout/checkout-client.tsx
web/src/app/(user)/billing/billing-result-page.tsx
```

Thiết kế ZaloPay phải đi qua các abstraction này thay vì tạo một billing subsystem độc lập.

---

## 4. Nguyên tắc kiến trúc

### 4.1. ZaloPay là một Payment Provider

Provider ID mới:

```text
zalopay
```

Mở rộng logical provider type:

```ts
type PaymentProviderId =
  | "stripe"
  | "alipay"
  | "wechat"
  | "payply"
  | "zalopay"
  | "manual";
```

ZaloPay không được bypass:

```text
Payment Checkout Service
Payment Webhook Adapter
TopUpPaymentEvent
Settlement
```

---

### 4.2. Database là nguồn dữ liệu authoritative

Các dữ liệu sau phải lấy từ local order snapshot:

- số tiền phải trả;
- currency;
- user;
- số credits được cấp;
- pricing version;
- FX version;
- promotion;
- coupon;
- order status.

Không lấy các dữ liệu này từ frontend.

Không lấy `creditAmount` từ callback ZaloPay.

---

### 4.3. Callback hoặc server-side Query mới được phép xác nhận thanh toán

Không dùng:

```text
redirect query parameter
frontend state
browser success page
client-submitted status
```

để chuyển order thành `paid`.

Nguồn xác nhận hợp lệ:

```text
A. ZaloPay callback đã verify chữ ký

hoặc

B. Kết quả Query Order do backend gọi trực tiếp tới ZaloPay
```

Sau khi xác minh, dữ liệu vẫn phải đi qua settlement hiện tại.

---

## 5. Kiến trúc tích hợp đề xuất

```text
┌────────────────────────────────────────────────────┐
│                    VOZEB-PRO                       │
│                                                    │
│  Top-up Order                                      │
│       │                                            │
│       ▼                                            │
│  Payment Checkout Service                          │
│       │                                            │
│       ▼                                            │
│  ZaloPay Provider Adapter                          │
│       │                                            │
└───────┼────────────────────────────────────────────┘
        │
        │ Create Order + HMAC Key1
        ▼
┌──────────────────────────┐
│         ZaloPay          │
│                          │
│  Payment Gateway         │
│  Wallet / QR / Methods   │
└───────┬───────────┬──────┘
        │           │
 Redirect          Callback
        │           │
        ▼           ▼
 Browser       VOZEB webhook
                    │
                    │ Verify Key2
                    ▼
             ZaloPay Webhook Adapter
                    │
                    ▼
              TopUpPaymentEvent
                    │
                    ▼
          processTopUpPaymentEvent()
                    │
                    ▼
          PostgreSQL Settlement
                    │
       ┌────────────┼──────────────┐
       ▼            ▼              ▼
     Order       Payment         Credits
```

Bổ sung recovery path:

```text
Pending Local Order
       │
       ▼
Query ZaloPay Order
       │
       ▼
Verified success?
       │
       ▼
TopUpPaymentEvent
       │
       ▼
Same Settlement
```

Callback và Query Order phải hội tụ về cùng một settlement path.

---

## 6. Currency và amount

Source hiện tại đã có constraint:

```text
payment_kind = fiat
currency = VND
currency_exponent = 0
```

Vì vậy ZaloPay phù hợp trực tiếp với VND integer amount.

Mapping:

```text
VOZEB-PRO payableNativeAmount
             │
             ▼
       ZaloPay amount
```

Ví dụ:

```text
payableNativeAmount = "250000"
ZaloPay amount       = 250000
currency             = VND
currency exponent    = 0
```

Không thực hiện thêm conversion ở payment provider.

Provider phải dùng đúng amount đã được quote/order snapshot xác nhận.

---

## 7. Mapping dữ liệu VOZEB-PRO ↔ ZaloPay

| VOZEB-PRO | ZaloPay | Ghi chú |
|---|---|---|
| `provider` | `zalopay` | Provider ID nội bộ |
| `order.id` | `embed_data.vozebProOrderId` | Liên kết callback/query với local order |
| `order.orderNo` | `embed_data.vozebProOrderNo` | Dùng kiểm tra chéo |
| `providerOrderId` | `app_trans_id` | ID giao dịch phía merchant/ZaloPay |
| `providerPaymentId` | `zp_trans_id` | ID giao dịch ZaloPay sau thanh toán |
| `payableNativeAmount` | `amount` | VND integer |
| `currency` | VND | Cố định cho Top-up V1 |
| `currencyExponent` | 0 | VND |
| checkout URL | `order_url` | Redirect URL |
| checkout QR | `qr_code` | Có thể dùng cho desktop |
| paid time | `server_time` | Chuẩn hóa sang ISO timestamp |

---

## 8. Thiết kế `app_trans_id`

ZaloPay yêu cầu `app_trans_id` bắt đầu bằng ngày theo định dạng `yymmdd`.

Thiết kế phải:

- sinh ở backend;
- dùng timezone `Asia/Ho_Chi_Minh`;
- không phụ thuộc timezone của container/host;
- bảo đảm unique;
- bảo đảm không vượt giới hạn của ZaloPay;
- có thể truy vết về local order.

Dạng khuyến nghị:

```text
yymmdd_<compact-local-reference>
```

Ví dụ logic:

```text
260903_VZ8F3A91C24B7
```

Local `order.id` và `order.orderNo` đầy đủ vẫn được lưu trong `embed_data`, vì vậy `app_trans_id` không cần chứa toàn bộ UUID.

---

## 9. Thiết kế Create Order

Khi user checkout:

```text
POST /api/billing/top-ups/orders/{id}/checkout
```

flow:

```text
Load local order
    │
    ├── verify owner
    ├── verify status
    ├── verify provider enabled
    ├── verify payment configuration
    └── read authoritative amount
    │
    ▼
Create ZaloPay Order
    │
    ▼
Persist providerOrderId = app_trans_id
    │
    ▼
Return checkout result
```

Các field ZaloPay chính:

```text
app_id
app_user
app_trans_id
app_time
amount
description
embed_data
item
callback_url
bank_code / preferred payment settings nếu sử dụng
mac
```

---

## 10. Thiết kế chữ ký Create Order

Create Order sử dụng ZaloPay Key1.

Canonical MAC data phải được tạo đúng theo contract ZaloPay.

Về kiến trúc:

```text
Order data
   │
   ▼
Canonical signing string
   │
   ▼
HMAC-SHA256(Key1)
   │
   ▼
mac
```

Key1:

- chỉ được đọc ở server;
- phải được đánh dấu secret trong Payment Config;
- không được log;
- không được gửi xuống client;
- không được lưu trong `top_up_orders`.

Nên dùng helper riêng, ví dụ về trách nhiệm:

```text
signZaloPayCreateOrder(...)
```

Không rải logic HMAC trực tiếp trong route.

---

## 11. Thiết kế `embed_data`

`embed_data` dùng để mang reference phục vụ reconciliation.

Khuyến nghị:

```json
{
  "redirecturl": "https://<domain>/billing/success?orderId=<local-order-id>",
  "vozebProOrderId": "<local-order-id>",
  "vozebProOrderNo": "<local-order-no>"
}
```

Không đặt vào `embed_data`:

```text
creditAmount
userBalance
pricing formula
coupon discount authority
customer FX authority
final payment status
```

Các giá trị này phải được backend lấy từ DB.

---

## 12. Thiết kế Checkout Result

Abstraction checkout hiện tại nên tiếp tục được sử dụng.

Kết quả ZaloPay nên map về contract generic:

```ts
{
  provider: "zalopay",
  kind: "redirect",
  url: "<order_url>",
  qrContent: "<qr_code-if-available>",
  providerOrderId: "<app_trans_id>",
  orderId: "<local-order-id>",
  orderNo: "<local-order-no>"
}
```

### Desktop

Có thể hiển thị:

```text
┌────────────────────────────┐
│          QR Code           │
│                            │
│          ▓▓▓▓▓             │
│          ▓ QR ▓            │
│          ▓▓▓▓▓             │
│                            │
│  [ Mở cổng thanh toán ]    │
└────────────────────────────┘
```

### Mobile

Ưu tiên nút redirect:

```text
[ Thanh toán bằng ZaloPay ]
```

Không cần tạo nhiều internal provider như:

```text
zalopay-wallet
zalopay-vietqr
zalopay-card
```

trừ khi sau này business requirement cần tách riêng từng phương thức.

---

## 13. Callback endpoint

Endpoint đề xuất tiếp tục theo routing generic:

```text
POST /api/billing/webhooks/zalopay
```

Không tạo một route callback nằm ngoài payment webhook subsystem nếu không có lý do kiến trúc đặc biệt.

Flow:

```text
Receive raw callback
     │
     ▼
Parse outer payload
     │
     ├── data
     ├── mac
     └── type
     │
     ▼
Verify HMAC with Key2
     │
     ▼
Parse callback.data
     │
     ▼
Extract local references
     │
     ▼
Normalize TopUpPaymentEvent
     │
     ▼
processTopUpPaymentEvent()
```

---

## 14. Callback signature verification

Callback sử dụng Key2.

Nguyên tắc quan trọng:

```text
expectedMac =
  HMAC-SHA256(
    Key2,
    original callback.data string
  )
```

Phải verify trên nguyên chuỗi `data` nhận từ ZaloPay.

Không làm:

```text
JSON.parse(data)
JSON.stringify(parsedData)
HMAC(...)
```

vì việc serialize lại có thể thay đổi byte representation và làm sai contract signature.

Nên dùng timing-safe comparison khi so sánh MAC.

Key2:

- chỉ tồn tại server-side;
- secret;
- không log;
- không gửi xuống browser.

---

## 15. Normalize callback thành `TopUpPaymentEvent`

Adapter ZaloPay nên đưa callback về event generic của billing subsystem.

Ví dụ logical event:

```ts
{
  eventId: "<zp_trans_id>",
  eventType: "zalopay.payment.succeeded",

  provider: "zalopay",

  orderId: "<embed_data.vozebProOrderId>",
  orderNo: "<embed_data.vozebProOrderNo>",

  status: "succeeded",

  providerTradeId: "<app_trans_id>",
  providerPaymentId: "<zp_trans_id>",

  amount: {
    kind: "fiat",
    currency: "VND",
    amountMinor: "<amount>",
    minorUnitExponent: 0
  },

  paidAt: "<server_time normalized>",
  signatureValid: true
}
```

Tên field thực tế phải tuân theo type hiện có của `TopUpPaymentEvent`.

ZaloPay adapter không được tự cập nhật balance.

---

## 16. Settlement

Sau callback/query success:

```text
ZaloPay event
     │
     ▼
TopUpPaymentEvent
     │
     ▼
processTopUpPaymentEvent()
     │
     ▼
PostgreSQL settlement
```

Settlement hiện tại tiếp tục là authority duy nhất cho việc:

```text
insert top_up_payment_events
insert top_up_payments
update top_up_orders
insert point_records
update users.settled_balance
redeem promotion/coupon state nếu áp dụng
```

ZaloPay-specific code không được gọi trực tiếp:

```text
UPDATE users SET settled_balance = ...
```

---

## 17. Idempotency

ZaloPay có thể callback nhiều lần.

Query Order cũng có thể phát hiện success trước callback.

Thiết kế phải bảo đảm:

```text
Callback Success
        │
        ▼
 Settlement
        │
        ▼
 Credits granted once

Query Success later
        │
        ▼
 Duplicate detected
        │
        ▼
 No second credit
```

và ngược lại:

```text
Query Success
        │
        ▼
 Settlement
        │
        ▼
 Credits granted once

Callback later
        │
        ▼
 Duplicate detected
```

Khuyến nghị identity ổn định:

```text
providerPaymentId = zp_trans_id
```

`zp_trans_id` phải được coi là provider payment identity chính.

Không tạo một `providerPaymentId` khác nhau giữa Query và Callback cho cùng một payment.

---

## 18. Webhook ACK contract

Route webhook hiện tại trả response generic dạng:

```json
{
  "code": 0,
  "data": {},
  "msg": ""
}
```

ZaloPay callback có response contract riêng.

Vì vậy webhook layer cần hỗ trợ **provider-aware acknowledgement**.

Thiết kế nên cho phép adapter/provider định nghĩa:

```text
formatWebhookSuccessResponse()
formatWebhookFailureResponse()
```

Đối với ZaloPay:

Success:

```json
{
  "return_code": 1,
  "return_message": "success"
}
```

Invalid callback / MAC:

```json
{
  "return_code": 2,
  "return_message": "<message>"
}
```

Không nên hard-code ZaloPay ACK rải rác ở nhiều nơi.

Mục tiêu dài hạn là mỗi payment provider có thể tuân thủ callback response contract riêng.

---

## 19. Redirect không phải payment confirmation

Redirect:

```text
ZaloPay
   │
   ▼
/billing/success?orderId=...
```

chỉ phục vụ UX.

Trang success:

```text
không tự chuyển order → paid
không tự cộng credits
không tin query parameters của redirect
```

Trang này chỉ nên đọc trạng thái local order.

Logic:

```text
Redirect
    │
    ▼
Billing Result Page
    │
    ▼
Read local order
    │
    ├── paid     → Success
    ├── pending  → Waiting / Sync option
    ├── canceled → Canceled
    └── failed   → Failure
```

---

## 20. Query Order fallback

Phải có server-side Query Order để xử lý trường hợp:

```text
ZaloPay đã thu tiền
       +
callback bị timeout / mất / đến trễ
```

Thiết kế endpoint nội bộ:

```text
POST /api/billing/top-ups/orders/{id}/sync
```

hoặc một service tương đương nếu không muốn expose route công khai.

Flow:

```text
Load local order
     │
     ├── provider == zalopay
     ├── local status still eligible
     └── providerOrderId exists
     │
     ▼
Query ZaloPay using app_trans_id
     │
     ▼
Verify response
     │
     ├── not paid → keep pending
     └── paid
          │
          ▼
    Normalize same payment
          │
          ▼
    TopUpPaymentEvent
          │
          ▼
    Same settlement
```

Query Order không được có một settlement implementation riêng.

---

## 21. Sync từ Billing Result Page

Nếu local order vẫn `pending`, giao diện có thể hỗ trợ:

```text
[ Kiểm tra lại ]
```

Hành động này nên:

```text
request backend sync
       │
       ▼
backend Query ZaloPay
       │
       ▼
read latest local status
```

Không để frontend gọi trực tiếp ZaloPay API.

Có thể hỗ trợ polling/retry có giới hạn trên trang success, nhưng backend vẫn là nơi query provider.

---

## 22. Thiết kế Cancel

Source hiện tại có local cancellation.

Điểm cần bảo vệ:

```text
Local order canceled
        +
ZaloPay order vẫn còn khả năng thanh toán
        =
nguy cơ user trả tiền nhưng settlement từ chối
```

Vì vậy ZaloPay cần provider-aware cancellation policy.

### Thiết kế khuyến nghị

Trước khi local order chuyển sang `canceled`:

```text
Load ZaloPay state
      │
      ├── already paid
      │      └── không cancel local; chuyển sang reconciliation/settlement
      │
      ├── cancellable
      │      └── cancel provider → cancel local
      │
      └── unknown
             └── không được coi local cancel là final một cách mù quáng
```

Nếu phiên bản đầu chưa hỗ trợ provider cancellation an toàn, có thể chọn policy:

```text
Sau khi checkout ZaloPay đã được tạo,
không cho user hard-cancel local order;
để order pending cho tới expiration/reconciliation.
```

Không được để local cancel tạo ra tình trạng "paid externally but permanently uncreditable".

---

## 23. Refund

Refund không phải điều kiện bắt buộc cho ZaloPay Payment V1.

### V1

```text
Payment              Supported
Callback             Supported
Query Order          Supported
Settlement           Supported
Credits              Supported
Cancel safety        Required
Automatic refund     Not required
```

### Future extension

Refund architecture phải đi qua subsystem refund hiện có:

```text
Refund Request
     │
     ▼
Credit Recovery Hold
     │
     ▼
ZaloPay Refund API
     │
     ▼
Query Refund Status
     │
     ▼
Provider Refund Confirmed
     │
     ▼
Recover / reverse credits
```

Không reverse credits trước khi provider refund đạt trạng thái authoritative phù hợp.

---

## 24. Payment Config

Admin billing config nên thêm provider:

```text
ZaloPay
```

Các field khuyến nghị:

| Field | Loại | Required | Secret | Ghi chú |
|---|---|---:|---:|---|
| `environment` | select | yes | no | Sandbox / Production |
| `appId` | text | yes | no | ZaloPay App ID |
| `key1` | secret | yes | yes | Create/Query signing key theo contract |
| `key2` | secret | yes | yes | Callback verification key |
| `callbackUrl` | URL | optional | no | mặc định `/api/billing/webhooks/zalopay` |
| `redirectUrl` | URL | optional | no | mặc định `/billing/success` |
| `preferredPaymentMethods` | text/select | optional | no | chỉ khi business cần giới hạn phương thức |
| `apiBase` | URL | optional/advanced | no | override endpoint |
| `subAppId` | text | optional | no | chỉ dùng khi merchant contract yêu cầu |

UI không hiển thị lại secret sau khi save.

Secret phải tuân theo cơ chế mask/encryption/config storage hiện có.

---

## 25. Environment

Thiết kế cần hỗ trợ tối thiểu:

```text
Sandbox
Production
```

Default API base nên do `environment` quyết định.

Advanced `apiBase` chỉ dùng để override khi thật sự cần.

Không để production key chạy nhầm sandbox hoặc ngược lại.

Recommended invariant:

```text
environment + appId + key1 + key2
```

được coi là một config set.

---

## 26. Provider module boundary

Khuyến nghị tạo module chuyên biệt để tránh làm `payment-checkout-providers.ts` và `payment-webhook-adapters.ts` ngày càng lớn.

Ví dụ:

```text
web/src/lib/server/zalopay-payment-provider.ts
```

Trách nhiệm logical:

```text
createZaloPayOrder()
queryZaloPayOrder()
cancelZaloPayOrder()

buildZaloPayAppTransId()

signZaloPayCreateOrder()
signZaloPayQuery()
verifyZaloPayCallback()

parseZaloPayCallback()
normalizeZaloPayPayment()
```

Generic checkout/webhook modules chỉ điều phối provider.

---

## 27. Database impact

### Payment V1

Theo cấu trúc hiện tại, thiết kế không yêu cầu migration mới chỉ để hỗ trợ ZaloPay.

Các field generic hiện có đủ cho:

```text
top_up_orders.provider
top_up_orders.provider_order_id
top_up_orders.provider_payment_id

top_up_payments.provider
top_up_payments.provider_event_id
top_up_payments.provider_trade_id
top_up_payments.provider_payment_id
top_up_payments.raw_payload

top_up_payment_events
```

Mapping:

```text
provider            = zalopay
provider_order_id   = app_trans_id
provider_payment_id = zp_trans_id
```

Chỉ thêm migration nếu Codex khi inspect source phát hiện một invariant thực tế chưa thể biểu diễn bằng schema hiện tại.

Không tạo column ZaloPay-specific nếu generic field đã đáp ứng được.

---

## 28. State model

Local top-up state vẫn là state machine authority.

ZaloPay status phải được map vào local states, không đưa raw ZaloPay state xuyên suốt application.

Logical flow:

```text
created/pending
      │
      ├───────────────┐
      │               │
      ▼               ▼
   checkout        canceled
      │
      ▼
 external payment
      │
      ├───────────────┐
      │               │
      ▼               ▼
   succeeded       pending/failed
      │
      ▼
 settlement
      │
      ▼
     paid
```

`paid` chỉ được ghi sau khi payment event đã vượt qua validation và settlement.

---

## 29. Security invariants

Các invariant bắt buộc:

### Frontend

```text
Frontend không biết Key1.
Frontend không biết Key2.
Frontend không quyết định amount.
Frontend không quyết định credits.
Frontend không quyết định payment success.
```

### Checkout

```text
amount = local authoritative order amount
currency = VND
provider = local selected provider
```

### Callback

```text
verify Key2
verify callback app identity nếu contract có field tương ứng
verify local order reference
verify provider
verify amount
verify currency
verify payment identity
verify duplicate
```

### Query

```text
chỉ backend gọi ZaloPay
không tin app_trans_id tùy ý từ client
app_trans_id phải lấy từ local order/provider state
```

### Logging

Không log:

```text
Key1
Key2
full authorization secrets
raw sensitive payment configuration
```

Có thể log:

```text
local order ID
orderNo
app_trans_id
zp_trans_id
provider
amount
normalized state
correlation ID
```

---

## 30. Reconciliation

ZaloPay phải tương thích với billing reconciliation hiện có.

Định danh tối thiểu nên có:

```text
local order id
local orderNo
app_trans_id
zp_trans_id
amount
paid timestamp
```

Mục tiêu:

```text
Local order
    ↕
ZaloPay merchant transaction
    ↕
ZaloPay payment transaction
```

có thể truy vết hai chiều.

Nếu callback bị miss, Query Order phải khôi phục được payment.

Nếu provider report và DB khác nhau, không tự ý cộng credits ngoài settlement.

---

## 31. Error model

Các lỗi nên được phân loại ở payment-provider boundary.

### Configuration Error

Ví dụ:

```text
missing appId
missing Key1
missing Key2
invalid environment
```

### Checkout Error

Ví dụ:

```text
ZaloPay create order rejected
network timeout
invalid response
```

### Callback Error

Ví dụ:

```text
invalid MAC
invalid data
unknown local order
amount mismatch
provider mismatch
duplicate/conflicting payment identity
```

### Query Error

Ví dụ:

```text
network timeout
order not found
provider response inconsistent
```

### Settlement Error

Tiếp tục dùng error/invariant của billing subsystem hiện tại.

Không biến lỗi payment thành credit grant fallback.

---

## 32. Observability

Nên có structured logs/events cho:

```text
zalopay.checkout.created
zalopay.checkout.failed

zalopay.callback.received
zalopay.callback.verified
zalopay.callback.rejected

zalopay.query.started
zalopay.query.pending
zalopay.query.succeeded
zalopay.query.failed

zalopay.payment.normalized
zalopay.payment.settled
zalopay.payment.duplicate

zalopay.cancel.started
zalopay.cancel.completed
zalopay.cancel.failed
```

Không đưa secret vào logs.

Nên có correlation theo:

```text
orderId
orderNo
appTransId
zpTransId
```

---

## 33. UI/UX

### Billing Provider Selection

Thêm:

```text
ZaloPay
```

vào danh sách provider khả dụng khi:

```text
enabled = true
checkoutReady = true
```

### Checkout

Hiển thị:

```text
Số tiền nạp
Số tiền phải trả
Credits dự kiến nhận
Payment provider = ZaloPay

[ Thanh toán bằng ZaloPay ]
```

Nếu có `qrContent`, desktop có thể hiển thị QR.

### Success Page

Success page phải phản ánh local DB state:

```text
Đang xác nhận thanh toán...
Thanh toán thành công
Thanh toán chưa hoàn tất
Thanh toán đã hủy
Có lỗi khi xác nhận giao dịch
```

Có thể có:

```text
[ Kiểm tra lại ]
```

để gọi backend sync.

---

## 34. i18n

Cần giữ chuẩn i18n hiện tại cho:

```text
zh
en
vi
```

Các message nên bao phủ:

```text
ZaloPay
Thanh toán bằng ZaloPay
Quét mã để thanh toán
Mở cổng thanh toán
Đang xác nhận thanh toán
Kiểm tra lại
Không thể tạo đơn ZaloPay
Không thể xác nhận giao dịch
Thanh toán đã được ghi nhận
```

Không hard-code toàn bộ message mới trong component.

---

## 35. Khả năng tương thích với source hiện tại

Thiết kế tận dụng trực tiếp:

```text
PaymentProviderId
PAYMENT_PROVIDER_DEFINITIONS
PaymentRuntimeConfig

createPaymentCheckoutForOrder()
provider checkout abstraction

payment webhook routing
payment webhook adapters

processTopUpWebhook()
processTopUpPaymentEvent()

PostgresTopUpPaymentStore / settlement

billing result page
payment checkout UI
```

Các điểm kiến trúc cần mở rộng rõ ràng:

```text
1. PaymentProviderId nhận zalopay.
2. Payment config nhận appId/Key1/Key2/environment.
3. Checkout provider nhận create ZaloPay order.
4. Webhook adapter nhận ZaloPay callback.
5. Webhook response hỗ trợ provider-specific ACK.
6. Có Query Order recovery path.
7. Cancel trở thành provider-aware đối với ZaloPay.
```

---

## 36. File/module impact dự kiến

Đây là **impact map**, không phải implementation plan.

Những khu vực nhiều khả năng liên quan:

```text
web/src/lib/payment-config-types.ts
web/src/lib/payment-provider.ts

web/src/lib/server/payment-config-store.ts
web/src/lib/server/payment-checkout-providers.ts
web/src/lib/server/payment-webhook-adapters.ts
web/src/lib/server/top-up-webhook-service.ts
web/src/lib/server/top-up-commerce-service.ts

web/src/app/api/billing/webhooks/[provider]/route.ts
web/src/app/api/billing/top-ups/orders/[id]/checkout/route.ts

web/src/services/api/billing.ts

web/src/app/(user)/billing/checkout/checkout-client.tsx
web/src/app/(user)/billing/billing-result-page.tsx

web/src/app/admin/billing/...

i18n resources
related *.test.ts
```

Module mới được khuyến nghị:

```text
web/src/lib/server/zalopay-payment-provider.ts
```

Query recovery có thể cần route/service mới, ví dụ:

```text
web/src/app/api/billing/top-ups/orders/[id]/sync/route.ts
```

Tên chính xác phải do Codex xác nhận sau khi inspect repo.

---

## 37. Test contract ở mức thiết kế

Implementation được coi là phù hợp thiết kế khi các invariant sau đạt được:

| Scenario | Expected |
|---|---|
| Tạo order ZaloPay sandbox | Nhận checkout URL hợp lệ |
| ZaloPay trả QR | Generic checkout có thể giữ `qrContent` |
| Callback Key2 hợp lệ | Có thể settle order |
| Callback Key2 sai | Không settle |
| Callback amount khác DB | Không settle |
| Callback local order sai | Không settle |
| Callback lặp lại | Chỉ cấp credits một lần |
| Query thành công trước callback | Chỉ cấp credits một lần |
| Callback đến sau Query | Không cấp lần hai |
| Redirect success giả | Không cấp credits |
| User đóng browser sau payment | Callback vẫn có thể settle |
| Callback bị mất | Query Order có thể recover |
| Local cancel + external paid | Không để mất tiền nhưng không có đường reconciliation |
| Missing provider config | Checkout bị chặn an toàn |
| Secret config | Không lộ ra client/log |

---

## 38. Phạm vi release đề xuất ở mức kiến trúc

### ZaloPay Payment V1

Bao gồm capability:

```text
Provider config
Create Order
Redirect checkout
QR support nếu response có
Callback verification
ZaloPay-specific ACK
Query Order recovery
Settlement
Idempotency
Safe cancellation behavior
UI
i18n
Tests
```

### ZaloPay Payment V1.1 / Future

Có thể thêm:

```text
Automatic refund
Query Refund
Refund callback/status synchronization
More advanced payment method selection
Provider reconciliation automation
Operational dashboard metrics
```

---

## 39. Quyết định kiến trúc cuối cùng

Phương án được chọn:

> **Tích hợp ZaloPay Payment Gateway vào payment provider abstraction hiện có của VOZEB-PRO, sử dụng Create Order + server callback + Query Order fallback. Mọi thanh toán thành công phải được normalize thành `TopUpPaymentEvent` và đi qua settlement hiện tại trước khi cộng积分. Redirect chỉ phục vụ UX và tuyệt đối không phải nguồn xác nhận thanh toán.**

Các quyết định quan trọng:

```text
ZaloPay là provider, không phải billing subsystem mới.

VND amount lấy từ top_up_order authoritative snapshot.

providerOrderId = app_trans_id.

providerPaymentId = zp_trans_id.

Key1 dùng cho request signing theo contract ZaloPay.

Key2 dùng verify callback.

Callback và Query Order hội tụ về cùng settlement.

Không cần DB migration cho Payment V1 nếu generic fields hiện tại đủ.

Webhook ACK phải provider-aware.

Cancel phải tránh trạng thái external-paid/local-canceled.

Refund tự động không bắt buộc trong V1.
```

---

# 40. Cách giao tài liệu này cho Codex

Tài liệu này phải được dùng như **design source of truth**.

Không cần viết implementation plan thủ công trong tài liệu thiết kế.

Khi bắt đầu phát triển, đưa file này cho Codex và yêu cầu Codex:

```text
Đọc toàn bộ tài liệu thiết kế tích hợp ZaloPay này và inspect source code hiện tại của repository.

Trước tiên KHÔNG sửa code.

Hãy:
1. Đối chiếu từng quyết định kiến trúc trong tài liệu với implementation hiện tại.
2. Xác định các module/file thực tế cần thay đổi.
3. Phát hiện điểm nào trong thiết kế cần điều chỉnh do source thực tế.
4. Xác định có cần database migration hay không; ưu tiên không thêm schema nếu generic payment fields hiện tại đã đủ.
5. Lập implementation plan theo các phase nhỏ, mỗi phase có:
   - mục tiêu;
   - file/module ảnh hưởng;
   - thay đổi contract;
   - test cần thêm/sửa;
   - rủi ro;
   - dependency;
   - điều kiện hoàn thành.
6. Bảo đảm callback và Query Order dùng chung settlement path.
7. Bảo đảm redirect/frontend không thể tự xác nhận payment.
8. Bảo đảm idempotency giữa callback và Query Order.
9. Bảo đảm ZaloPay webhook ACK đúng contract.
10. Bảo đảm cancellation không tạo tình trạng external-paid nhưng local-canceled không thể xử lý.

Sau khi hoàn thành inspection, chỉ xuất implementation plan.
Chưa được implement cho tới khi plan được review.
```

Codex nên tự quyết định thứ tự sửa code dựa trên dependency graph của source hiện tại, thay vì tài liệu thiết kế hard-code thứ tự implementation.

---

## 41. Tài liệu ZaloPay chính thức tham khảo

- Payment Gateway overview:  
  `https://docs.zalopay.vn/vi/docs/guides/payment-acceptance/payment-gateway/intro/`

- Create Order:  
  `https://docs.zalopay.vn/docs/specs/order-create/`

- Callback:  
  `https://docs.zalopay.vn/vi/docs/specs/callback-api/`

- Query Order:  
  `https://docs.zalopay.vn/vi/docs/specs/order-query/`

- Refund:  
  `https://docs.zalopay.vn/docs/specs/order-refund/`

- ZaloPay API integration document:  
  `https://docs.zalopay.vn/downloads/api/ZaloPay-APIs-Integration-Document.pdf`

---

**End of document**
