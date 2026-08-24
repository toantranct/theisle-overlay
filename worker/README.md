# theisle-overlay-api

Analytics, feedback và crash report cho TheIsle Overlay. Chạy trên Cloudflare
Workers free tier.

```
/                    dashboard.html   ← STATIC ASSET, không tốn request
POST /v1/ping        Analytics Engine + 1 UPSERT D1
POST /v1/feedback    D1
POST /v1/crash       D1, gộp theo fingerprint
GET  /admin/data     JSON cho dashboard (Bearer token)
cron 02:10 UTC       rollup AE → D1, xoá dữ liệu quá hạn
```

## Ba quyết định định hình phần còn lại

**Static asset là miễn phí và không giới hạn.** Request tới một file trong
`public/` không chạy code Worker và không tính vào quota 100k/ngày. Dashboard
nằm ở đó vì lý do đó. Đừng đặt `run_worker_first` — nó biến các request này
thành có tính phí.

**Analytics Engine giữ event thô, D1 chỉ giữ sổ thiết bị.** D1 tính *mỗi index
có cột bị ghi là thêm một dòng ghi nữa*, nên một bảng event 3 index tốn 4 dòng
ghi mỗi event và vỡ trần 100k/ngày ở khoảng 25k DAU. AE cho 100k data point/
ngày và tự hết hạn sau 3 tháng.

**Câu UPSERT trong `ping.ts` có dòng `WHERE device.last_day < excluded.last_day`.**
Đó là thứ giữ ngân sách ghi ở đúng 1 dòng/thiết bị/ngày. Mặt trái: mọi lần ping
sau lần đầu trong ngày bị bỏ qua hoàn toàn, nên **không cột đếm nào được sống
trong bảng `device`** — `x = x + excluded.x` sẽ mất phần lớn số đếm. Khối lượng
đo bằng AE.

## Cài đặt lần đầu

```bash
cd worker
npm ci

# 1. Tạo D1 rồi dán database_id vào wrangler.jsonc
npx wrangler d1 create isle
npx wrangler d1 execute isle --remote --file=migrations/0001_init.sql

# 2. Secret (đặt tay, không qua CI)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npx wrangler secret put ATTEST_MASTER    # giá trị vừa sinh ra
npx wrangler secret put ADMIN_TOKEN      # mật khẩu dashboard

# 3. Token đọc Analytics Engine (cần cho biểu đồ tính năng và cho cron)
npx wrangler secret put AE_QUERY_TOKEN   # API token, quyền Account Analytics Read
npx wrangler secret put AE_ACCOUNT_ID

npx wrangler deploy
```

Sau đó thêm secret vào GitHub repo: `CLOUDFLARE_API_TOKEN` (scope *Edit
Cloudflare Workers*), `CLOUDFLARE_ACCOUNT_ID`, và **`TELEMETRY_MASTER` phải
bằng đúng `ATTEST_MASTER`** — release workflow dẫn xuất khoá của client từ nó.
Lệch nhau là mọi request bị 401, im lặng.

Cuối cùng: cập nhật `API_BASES` trong `src-tauri/src/telemetry/client.rs` thành
URL workers.dev thật.

## Phát triển cục bộ

```bash
cp .dev.vars.example .dev.vars     # rồi điền ATTEST_MASTER + ADMIN_TOKEN
npx wrangler d1 execute isle --local --file=migrations/0001_init.sql
npx wrangler dev
```

Gửi request đã ký:

```bash
node scripts/sign.mjs /v1/ping '{"client_id":"11111111-2222-4333-8444-555555555555","launches":1}'
node scripts/sign.mjs --bad  /v1/ping '{...}'   # chữ ký hỏng  -> 401
node scripts/sign.mjs --skew /v1/ping '{...}'   # lệch giờ     -> 401
node scripts/sign.mjs /v1/crash '@payload.json' # body có backslash
```

Chạy cron tay: `curl http://127.0.0.1:8787/cdn-cgi/local/scheduled`

Test phía Rust ký thật và Worker verify thật (bài test duy nhất chứng minh hai
bên đồng ý về chuỗi canonical):

```bash
KVER=$(node -e "const c=require('crypto'),fs=require('fs');const m=fs.readFileSync('.dev.vars','utf8').match(/ATTEST_MASTER=(\w+)/)[1];console.log(Buffer.from(c.hkdfSync('sha256',Buffer.from(m,'hex'),Buffer.from('isle-attest-v1'),Buffer.from('app:1.4.3'),32)).toString('hex'))")
cd ../src-tauri
OV_API_BASE=http://127.0.0.1:8787 OV_TELEMETRY_KEY=$KVER \
  cargo test --lib live_ping_against_local_worker -- --ignored
```

## Thêm một tính năng cần đo

`FEATURE_SLOTS` xuất hiện ở ba chỗ và phải khớp thứ tự: `src/features.ts`,
`src-tauri/src/telemetry/counters.rs`, và union `Feature` trong
`src/lib/api.ts`. **Chỉ được thêm vào cuối** — chèn giữa hay đổi thứ tự làm
toàn bộ lịch sử bị diễn giải sai. Tối đa 18 slot (20 `doubles` trừ 2 ô đầu cho
`launches` và `session_minutes`). Test `slots_match_worker` trong Rust sẽ fail
nếu hai danh sách lệch nhau.

## Ngân sách free tier

| | Free/ngày | Ta dùng |
|---|---|---|
| Worker request | 100.000 | 1 / lần mở app |
| Static assets | không giới hạn | dashboard |
| D1 dòng ghi | 100.000 | 1 / thiết bị / ngày |
| AE data point | 100.000 | 1 / lần mở app |

Trần thực tế khoảng **60k DAU** (giả sử 1,5 lần mở/người/ngày). Vượt rồi thì
Workers Paid $5/tháng bao tới khoảng 150k DAU. Vượt quota trả về lỗi 1027 /
HTTP 429, không tự động tính tiền.
